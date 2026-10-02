import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineState } from "../src/schemas/pipeline.js";

// Isolate the orchestrator from the real agents (no network / no API keys).
vi.mock("../src/agents/searchAgent.js", () => ({ runSearchAgent: vi.fn() }));
vi.mock("../src/agents/readerAgent.js", () => ({ runReaderAgent: vi.fn() }));
vi.mock("../src/agents/writerChain.js", () => ({ runWriterAgent: vi.fn() }));
vi.mock("../src/agents/criticChain.js", () => ({ runCriticAgent: vi.fn() }));

import { runResearchPipeline } from "../src/orchestrator/pipeline.js";
import { runSearchAgent } from "../src/agents/searchAgent.js";
import { runReaderAgent } from "../src/agents/readerAgent.js";
import { runWriterAgent } from "../src/agents/writerChain.js";
import { runCriticAgent } from "../src/agents/criticChain.js";

async function collect(topic: string): Promise<PipelineState> {
  let last: PipelineState | undefined;
  for await (const event of runResearchPipeline(topic)) {
    last = event.state;
  }
  if (!last) throw new Error("pipeline produced no events");
  return last;
}

function stubHappyPath(): void {
  vi.mocked(runSearchAgent).mockResolvedValue({
    query: "q",
    output: "Title: X\nURL: https://x.com\nSnippet: y",
    provider: "duckduckgo",
  });
  vi.mocked(runReaderAgent).mockResolvedValue({
    url: "https://x.com",
    output: "scraped content",
    provider: "local",
  });
  vi.mocked(runWriterAgent).mockResolvedValue({
    content: "# Report",
    provider: "gemini",
    model: "gemini-2.5-flash",
  });
  vi.mocked(runCriticAgent).mockResolvedValue({
    content: "8/10",
    provider: "cerebras",
    model: "llama3.3-70b",
  });
}

describe("orchestrator pipeline (TDD §6.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs all four steps and aggregates the report", async () => {
    stubHappyPath();

    const state = await collect("AI agents");

    expect(state.topic).toBe("AI agents");
    expect(state.steps.search.status).toBe("done");
    expect(state.steps.reader.status).toBe("done");
    expect(state.steps.writer.status).toBe("done");
    expect(state.steps.critic.status).toBe("done");

    expect(state.report).toBe("# Report");
    expect(state.feedback).toBe("8/10");
    expect(state.steps.writer.provider).toBe("gemini");
    expect(state.steps.critic.provider).toBe("cerebras");
    expect(state.steps.writer.durationMs).toBeTypeOf("number");
  });

  it("emits an initial event with every step waiting", async () => {
    stubHappyPath();
    const iterator = runResearchPipeline("t");
    const first = await iterator.next();
    const state = first.value?.state as PipelineState;
    expect(state.steps.search.status).toBe("waiting");
    expect(state.steps.critic.status).toBe("waiting");
    await iterator.return?.(undefined);
  });

  it("stops early and keeps partial results when the search step fails", async () => {
    vi.mocked(runSearchAgent).mockRejectedValue(new Error("search down"));

    const state = await collect("t");

    expect(state.steps.search.status).toBe("error");
    expect(state.steps.search.error).toContain("search down");
    expect(state.steps.reader.status).toBe("waiting");
    expect(runReaderAgent).not.toHaveBeenCalled();
  });

  it("passes user-supplied URLs to the reader (PRD §5)", async () => {
    stubHappyPath();

    for await (const _event of runResearchPipeline("t", { urls: ["https://manual.example/a"] })) {
      // drain
    }

    expect(runReaderAgent).toHaveBeenCalledWith(expect.any(String), ["https://manual.example/a"]);
  });

  it("preserves earlier results when the writer step fails (PRD §3.2)", async () => {
    vi.mocked(runSearchAgent).mockResolvedValue({ query: "q", output: "URL: https://x.com", provider: "duckduckgo" });
    vi.mocked(runReaderAgent).mockResolvedValue({ url: "https://x.com", output: "content", provider: "local" });
    vi.mocked(runWriterAgent).mockRejectedValue(new Error("no provider"));

    const state = await collect("t");

    expect(state.steps.search.status).toBe("done");
    expect(state.steps.reader.status).toBe("done");
    expect(state.steps.writer.status).toBe("error");
    expect(state.steps.critic.status).toBe("waiting");
    expect(state.report).toBeUndefined();
  });
});