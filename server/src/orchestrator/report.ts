import type { PipelineState, Report, ReportSection } from "../schemas/pipeline.js";

/**
 * Report aggregation (FR-5.1 / FR-5.3 / FR-5.2).
 *
 * Merges every agent output into one report object that can be exported as
 * Markdown or JSON, and records **provenance** — which agent produced which
 * section.
 */

/** Maps a pipeline step to the agent that owns it (provenance). */
export const STEP_AGENT: Record<string, string> = {
  search: "search-agent",
  reader: "reader-agent",
  writer: "writer-agent",
  critic: "critic-agent",
};

/** Fallback Markdown used when the Writer step did not produce a report. */
function buildFallbackMarkdown(state: PipelineState): string {
  const lines: string[] = [`# Research Report: ${state.topic}`, ""];
  lines.push(`_Generated ${new Date().toISOString()} — Writer step unavailable, raw findings shown below._`, "");

  const search = state.steps.search;
  const reader = state.steps.reader;

  if (search?.output) {
    lines.push("## Raw search results", "", search.output, "");
  }
  if (reader?.output) {
    lines.push("## Scraped content", "", reader.output, "");
  }

  lines.push("## Sources Provenance", "");
  for (const [step, result] of Object.entries(state.steps)) {
    lines.push(`- **${step}** → ${STEP_AGENT[step] ?? step}: \`${result.status}\``);
  }

  return lines.join("\n");
}

/** Build the aggregated, downloadable report for a run. */
export function buildReport(runId: string, state: PipelineState): Report {
  const sections: ReportSection[] = Object.entries(state.steps)
    .filter(([, result]) => Boolean(result.output))
    .map(([step, result]) => ({
      agent: STEP_AGENT[step] ?? step,
      step,
      content: result.output ?? "",
    }));

  const markdown = state.report?.trim() ? state.report : buildFallbackMarkdown(state);

  return {
    runId,
    topic: state.topic,
    generatedAt: new Date().toISOString(),
    markdown,
    sections,
    raw: state.steps,
  };
}

export default buildReport;