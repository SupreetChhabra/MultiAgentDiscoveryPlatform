import { callLLM } from "../llm/router.js";

/**
 * WriterAgent (TDD §7.3).
 *
 * Prefers **Gemini** (gemini-2.5-flash, 1,500 RPD free) for maximum report
 * quality. `callLLM` still fails over to the rest of the chain if Gemini is
 * unavailable. Pure generation — no tools. Temperature 0.4 keeps it factual.
 */

export const WRITER_AGENT_ID = "writer-agent";
export const WRITER_PROVIDER = "gemini";
export const WRITER_TEMPERATURE = 0.4;
export const WRITER_SYSTEM_PROMPT =
  "You are an expert research writer. Produce a comprehensive, well-structured " +
  "Markdown report with a title, an executive summary, section headings, bullet " +
  "points and a closing 'Sources' list. Be factual and never invent citations.";

export interface WriterResult {
  content: string;
  provider: string;
  model: string;
}

/** Draft the Markdown report from the gathered research. */
export async function runWriterAgent(topic: string, research: string): Promise<WriterResult> {
  const result = await callLLM(
    [
      { role: "system", content: WRITER_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Write a comprehensive research report on "${topic}" using the following research.\n\n` +
          `--- RESEARCH START ---\n${research}\n--- RESEARCH END ---`,
      },
    ],
    { preferProvider: WRITER_PROVIDER, temperature: WRITER_TEMPERATURE, maxTokens: 2000 }
  );

  return { content: result.content, provider: result.provider, model: result.model };
}