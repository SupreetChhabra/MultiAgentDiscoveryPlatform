import type { PipelineState, StepResult, StepStatus } from "../schemas/pipeline.js";
import { PIPELINE_STEPS } from "../schemas/pipeline.js";
import { logger } from "../utils/logger.js";
import { runSearchAgent } from "../agents/searchAgent.js";
import { runReaderAgent } from "../agents/readerAgent.js";
import { runWriterAgent } from "../agents/writerChain.js";
import { runCriticAgent } from "../agents/criticChain.js";

/**
 * Core orchestrator (TDD §6.1).
 *
 * Implemented as an **async generator** that yields after every step transition.
 * The SSE route drives it and forwards each yield to the browser, which is what
 * makes the live step cards animate `waiting → running → done`.
 *
 * Guarantees:
 * - FR-2.4: a hard `MAX_STEPS` guard prevents runaway loops.
 * - §3.2:    a failing agent returns partial state with an `error` field instead
 *            of crashing the run.
 */

/** Hard cap on pipeline steps (PRD FR-2.4). Overridable via env for tests. */
export const MAX_STEPS = Number(process.env.MAX_PIPELINE_STEPS ?? 50);

/** Max characters of gathered research passed to the Writer (token safety). */
const MAX_RESEARCH_CHARS = 6000;

export interface PipelineEvent {
  step: string;
  state: PipelineState;
}

export interface PipelineOptions {
  /** User-supplied URLs to prefer as sources (PRD §5 manual fallback). */
  urls?: string[];
}

export function createInitialState(topic: string, urls: string[] = []): PipelineState {
  return { topic, urls, steps: {} };
}

function beginStep(state: PipelineState, step: string): void {
  state.steps[step] = { status: "running", startedAt: Date.now() };
}

function endStep(state: PipelineState, step: string, patch: Partial<StepResult> & { status: StepStatus }): void {
  const startedAt = state.steps[step]?.startedAt;
  const endedAt = Date.now();
  state.steps[step] = {
    ...state.steps[step],
    ...patch,
    endedAt,
    durationMs: startedAt ? endedAt - startedAt : undefined,
  };
}

/**
 * Run the four-agent research pipeline for `topic`.
 *
 * Callers MUST `for await` over the generator so every checkpoint is observed.
 */
export async function* runResearchPipeline(
  topic: string,
  options: PipelineOptions = {}
): AsyncGenerator<PipelineEvent> {
  const state = createInitialState(topic, options.urls ?? []);
  let stepCount = 0;

  const guard = (): void => {
    if (++stepCount > MAX_STEPS) {
      throw new Error(`Max step limit (${MAX_STEPS}) exceeded`);
    }
  };

  logger.info({ topic }, "pipeline.started");
  for (const step of PIPELINE_STEPS) {
    state.steps[step] = state.steps[step] ?? { status: "waiting" };
  }
  yield { step: PIPELINE_STEPS[0], state: structuredClone(state) };

  // ── Step 1: Search ────────────────────────────────────────────────────────
  {
    const step = "search";
    guard();
    beginStep(state, step);
    yield { step, state: structuredClone(state) };
    try {
      const result = await runSearchAgent(topic);
      endStep(state, step, { status: "done", output: result.output, provider: result.provider });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      endStep(state, step, { status: "error", error: message });
      yield { step, state: structuredClone(state) };
      return;
    }
    yield { step, state: structuredClone(state) };
  }

  // ── Step 2: Reader ────────────────────────────────────────────────────────
  {
    const step = "reader";
    guard();
    beginStep(state, step);
    yield { step, state: structuredClone(state) };
    try {
      const result = await runReaderAgent(state.steps.search?.output ?? "", state.urls ?? []);
      endStep(state, step, { status: "done", output: result.output, provider: result.provider });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      endStep(state, step, { status: "error", error: message });
      yield { step, state: structuredClone(state) };
      return;
    }
    yield { step, state: structuredClone(state) };
  }

  // ── Step 3: Writer ────────────────────────────────────────────────────────
  {
    const step = "writer";
    guard();
    beginStep(state, step);
    yield { step, state: structuredClone(state) };
    try {
      const research = [
        `# Search results\n${state.steps.search?.output ?? ""}`,
        `# Scraped content\n${state.steps.reader?.output ?? ""}`,
      ]
        .join("\n\n")
        .slice(0, MAX_RESEARCH_CHARS);
      const result = await runWriterAgent(topic, research);
      state.report = result.content;
      endStep(state, step, {
        status: "done",
        output: result.content,
        provider: result.provider,
        model: result.model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      endStep(state, step, { status: "error", error: message });
      yield { step, state: structuredClone(state) };
      return;
    }
    yield { step, state: structuredClone(state) };
  }

  // ── Step 4: Critic ────────────────────────────────────────────────────────
  {
    const step = "critic";
    guard();
    beginStep(state, step);
    yield { step, state: structuredClone(state) };
    try {
      const result = await runCriticAgent(state.report ?? "");
      state.feedback = result.content;
      endStep(state, step, {
        status: "done",
        output: result.content,
        provider: result.provider,
        model: result.model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      endStep(state, step, { status: "error", error: message });
      yield { step, state: structuredClone(state) };
      return;
    }
    yield { step, state: structuredClone(state) };
  }

  logger.info({ topic, durationMs: (state.steps.critic?.durationMs ?? 0) }, "pipeline.finished");
}

export default runResearchPipeline;