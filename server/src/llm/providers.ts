/**
 * LLM provider configuration.
 *
 * Every provider below exposes an OpenAI-compatible chat-completions endpoint,
 * so a single `openai` SDK instance with a custom `baseURL` talks to all of them.
 *
 * Failover order (as mandated by the PRD/TDD): groq → cerebras → gemini → ollama.
 */

export type ProviderName = "groq" | "cerebras" | "gemini" | "ollama";

export interface ProviderConfig {
  name: ProviderName;
  /** OpenAI-compatible base URL (may be overridden by an env var). */
  baseURL: string;
  /** Name of the environment variable holding the API key. */
  apiKeyEnv: string;
  /** Name of the environment variable that can override `defaultModel`. */
  modelEnv: string;
  /** Model used when a call does not request a specific one. */
  defaultModel: string;
  /** Requests-per-minute budget on the free tier (informational). */
  rpmLimit: number;
  /** Requests-per-day budget on the free tier (enforced in-memory). */
  rpdLimit: number;
  /** Ollama is keyless; everything else needs a real key. */
  requiresApiKey: boolean;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    // Groq retired the Llama chat models; gpt-oss is the current free default.
    defaultModel: "openai/gpt-oss-120b",
    rpmLimit: 30,
    rpdLimit: 14400,
    requiresApiKey: true,
  },
  {
    name: "cerebras",
    baseURL: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    modelEnv: "CEREBRAS_MODEL",
    defaultModel: "llama3.3-70b",
    rpmLimit: 30,
    rpdLimit: 14400,
    requiresApiKey: true,
  },
  {
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    rpmLimit: 15,
    rpdLimit: 1500,
    requiresApiKey: true,
  },
  {
    name: "ollama",
    baseURL: "http://localhost:11434/v1",
    apiKeyEnv: "OLLAMA_API_KEY", // dummy value; Ollama ignores it
    modelEnv: "OLLAMA_MODEL",
    defaultModel: "llama3.2",
    rpmLimit: 9999,
    rpdLimit: 9999,
    requiresApiKey: false,
  },
];

/** Resolve the API key for a provider (Ollama synthesises a dummy key). */
export function providerApiKey(provider: ProviderConfig): string | undefined {
  if (!provider.requiresApiKey) {
    return process.env[provider.apiKeyEnv] ?? "ollama";
  }
  return process.env[provider.apiKeyEnv];
}

/** Resolve the base URL for a provider (Ollama may be relocated via env). */
export function providerBaseURL(provider: ProviderConfig): string {
  if (provider.name === "ollama") {
    return process.env.OLLAMA_BASE_URL ?? provider.baseURL;
  }
  return provider.baseURL;
}

/**
 * Resolve the default model for a provider, honouring a per-provider env
 * override (e.g. `GROQ_MODEL`, `GEMINI_MODEL`).
 */
export function providerModel(provider: ProviderConfig): string {
  const override = process.env[provider.modelEnv]?.trim();
  return override || provider.defaultModel;
}