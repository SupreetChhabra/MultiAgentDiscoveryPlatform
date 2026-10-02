import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` lets the mock factory reference a spy defined before hoisting.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
    constructor(_options: unknown) {}
  },
}));

import {
  callLLM,
  getProviderOrder,
  isRateLimited,
  resetRateLimitCounters,
} from "../src/llm/router.js";
import { PROVIDERS } from "../src/llm/providers.js";

const KEY_ENVS = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY"];

describe("llm router — failover chain (PRD FR-2.5)", () => {
  beforeEach(() => {
    resetRateLimitCounters();
    createMock.mockReset();
    for (const key of KEY_ENVS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of KEY_ENVS) delete process.env[key];
  });

  it("orders providers groq -> cerebras -> gemini -> ollama", () => {
    expect(getProviderOrder().map((p) => p.name)).toEqual(["groq", "cerebras", "gemini", "ollama"]);
  });

  it("puts the preferred provider first, then the default order", () => {
    expect(getProviderOrder("gemini").map((p) => p.name)).toEqual([
      "gemini",
      "groq",
      "cerebras",
      "ollama",
    ]);
    expect(getProviderOrder("cerebras").map((p) => p.name)).toEqual([
      "cerebras",
      "groq",
      "gemini",
      "ollama",
    ]);
  });

  it("uses the first provider that has an API key", async () => {
    process.env.GROQ_API_KEY = "test-key";
    createMock.mockResolvedValue({ choices: [{ message: { content: "hello" } }] });

    const result = await callLLM([{ role: "user", content: "hi" }]);
    expect(result.provider).toBe("groq");
    expect(result.content).toBe("hello");
  });

  it("fails over to the next provider when one errors", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.CEREBRAS_API_KEY = "c";

    createMock.mockImplementation((args: { model?: string }) => {
      if (args.model === "llama-3.3-70b-versatile") {
        return Promise.reject(new Error("429 rate limited"));
      }
      return Promise.resolve({ choices: [{ message: { content: "from cerebras" } }] });
    });

    const result = await callLLM([{ role: "user", content: "hi" }]);
    expect(result.provider).toBe("cerebras");
    expect(result.content).toBe("from cerebras");
  });

  it("skips providers without a key and reports them when all fail", async () => {
    createMock.mockRejectedValue(new Error("nope"));
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(/All providers failed/);
  });

  it("treats a fresh provider as not rate limited", () => {
    expect(isRateLimited(PROVIDERS[0])).toBe(false);
  });
});