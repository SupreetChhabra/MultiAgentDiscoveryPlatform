import { callLLM } from "../llm/router.js";

/**
 * CriticAgent (TDD §7.4).
 *
 * Prefers **Cerebras** (llama3.3-70b) — deliberately a *different* provider from
 * the Writer, so the two free-tier daily budgets never collide. Temperature 0.2
 * keeps the critique deterministic. Pure evaluation — no tools.
 */

export const CRITIC_AGENT_ID = "critic-agent";
export const CRITIC_PROVIDER = "cerebras";
export const CRITIC_TEMPERATURE = 0.2;
export const CRITIC_SYSTEM_PROMPT =
  "You are a rigorous research critic. Review the report and score it 1-10 on " +
  "accuracy, depth and clarity. Then list specific, actionable improvements.";

export interface CriticResult {
  content: string;
  provider: string;
  model: string;
}

/** Review the drafted report and return a scored critique. */
export async function runCriticAgent(report: string): Promise<CriticResult> {
  const result = await callLLM(
    [
      { role: "system", content: CRITIC_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Review this report and score it 1-10 on accuracy, depth and clarity. Suggest specific improvements.\n\n--- REPORT START ---\n${report}\n--- REPORT END ---`,
      },
    ],
    { preferProvider: CRITIC_PROVIDER, temperature: CRITIC_TEMPERATURE, maxTokens: 800 }
  );

  return { content: result.content, provider: result.provider, model: result.model };
}