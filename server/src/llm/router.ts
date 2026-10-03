import OpenAI from "openai";
import {
  PROVIDERS,
  providerApiKey,
  providerBaseURL,
  providerModel,
  type ProviderConfig,
  type ProviderName,
} from "./providers.js";
import { logger } from "../utils/logger.js";

/** A chat message accepted by every provider (OpenAI-compatible shape). */
export type ChatMessageParam = OpenAI.Chat.ChatCompletionMessageParam;

export interface CallLLMOptions {
  /** Override the provider's default model. */
  model?: string;
  /** Sampling temperature (default 0.7). */
  temperature?: number;
  /** Try this provider first, then fall back through the normal chain. */
  preferProvider?: ProviderName;
  /** Optional max output tokens. */
  maxTokens?: number;
  /** Per-request timeout in ms (default 60s — see PRD §3.2). */
  timeoutMs?: number;
}

export interface LLMResult {
  content: string;
  provider: ProviderName;
  model: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Token budget used when a reasoning model returns empty content too cheaply. */
const RETRY_MAX_TOKENS = 4096;

/** In-memory per-provider daily request counters (FR-2.5 / TDD §3.3). */
const dailyCounters = new Map<ProviderName, { count: number; resetAt: number }>();

/**
 * Build the failover order. When `prefer` is supplied the chain starts with that
 * provider and then continues through the mandated default order — this lets the
 * Writer prefer Gemini and the Critic prefer Cerebras so their free-tier budgets
 * do not collide (TDD §7).
 */
export function getProviderOrder(prefer?: ProviderName): ProviderConfig[] {
  const base = [...PROVIDERS];
  if (!prefer) return base;
  const preferred = base.find((p) => p.name === prefer);
  if (!preferred) return base;
  return [preferred, ...base.filter((p) => p.name !== prefer)];
}

/** True when a provider's daily free-tier budget is exhausted. */
export function isRateLimited(provider: ProviderConfig, now = Date.now()): boolean {
  const counter = dailyCounters.get(provider.name);
  return Boolean(counter && counter.count >= provider.rpdLimit && now < counter.resetAt);
}

function recordUsage(name: ProviderName, now = Date.now()): void {
  const existing = dailyCounters.get(name);
  if (existing && now < existing.resetAt) {
    dailyCounters.set(name, { count: existing.count + 1, resetAt: existing.resetAt });
  } else {
    dailyCounters.set(name, { count: 1, resetAt: now + DAY_MS });
  }
}

/** Exposed for tests and for a future `/api/health` provider report. */
export function getRateLimitState(): Record<string, { count: number; resetAt: number }> {
  return Object.fromEntries(dailyCounters.entries());
}

/** Exposed for tests — clears all daily counters. */
export function resetRateLimitCounters(): void {
  dailyCounters.clear();
}

/**
 * Call the first healthy provider in the failover chain.
 *
 * Groq → Cerebras → Gemini → Ollama. A provider is skipped when it has no API
 * key, when its daily budget is exhausted, when it errors, or when it returns an
 * empty completion. Throws only when *every* provider fails (FR-2.5).
 */
export async function callLLM(
  messages: ChatMessageParam[],
  options: CallLLMOptions = {}
): Promise<LLMResult> {
  const errors: string[] = [];
  const order = getProviderOrder(options.preferProvider);

  for (const provider of order) {
    const apiKey = providerApiKey(provider);
    if (!apiKey) {
      // Distinguish "set but blank" from "not set" — empty .env placeholders
      // are a common source of silent failover.
      const raw = process.env[provider.apiKeyEnv];
      const reason = raw === "" ? "is empty" : "not set";
      errors.push(`${provider.name}: no API key (${provider.apiKeyEnv} ${reason})`);
      continue;
    }

    if (isRateLimited(provider)) {
      errors.push(`${provider.name}: daily limit reached`);
      continue;
    }

    const model = options.model ?? providerModel(provider);
    const temperature = options.temperature ?? 0.7;

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: providerBaseURL(provider),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: 0,
      });

      // Reasoning models (e.g. Groq's openai/gpt-oss-*) can spend the entire
      // max_tokens budget on hidden reasoning and return *empty* content. Retry
      // once with a larger budget before falling over to the next provider.
      let maxTokens = options.maxTokens;

      for (let pass = 0; ; pass++) {
        const response = await client.chat.completions.create({
          model,
          messages,
          temperature,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
        });

        const content = response.choices[0]?.message?.content ?? "";
        if (content.trim()) {
          recordUsage(provider.name);
          logger.debug({ provider: provider.name, model, chars: content.length }, "llm.call.ok");
          return { content, provider: provider.name, model };
        }

        const canRetry = pass === 0 && maxTokens !== undefined && maxTokens < RETRY_MAX_TOKENS;
        if (canRetry) {
          maxTokens = RETRY_MAX_TOKENS;
          logger.debug({ provider: provider.name, model, maxTokens }, "llm.call.empty_retry");
          continue;
        }

        errors.push(`${provider.name}: empty response`);
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${message}`);
      logger.warn({ provider: provider.name, model, error: message }, "llm.call.failed");
      continue;
    }
  }

  logger.error({ errors }, "llm.call.all_failed");
  throw new Error(`All providers failed:\n${errors.join("\n")}`);
}