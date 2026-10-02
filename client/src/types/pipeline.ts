/**
 * Client-side mirror of the server's pipeline contracts (TDD §8).
 * Kept hand-written (not imported) so the client bundle stays independent of
 * the server workspace and of Zod.
 */

export type StepStatus = "waiting" | "running" | "done" | "error";

export interface StepResult {
  status: StepStatus;
  output?: string;
  error?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  startedAt?: number;
  endedAt?: number;
}

export interface PipelineState {
  topic: string;
  /** User-supplied source URLs (PRD §5 manual fallback). */
  urls?: string[];
  steps: Record<string, StepResult>;
  report?: string;
  feedback?: string;
}

/** Metadata returned by `GET /api/runs/:id/report?meta=1`. */
export interface ReportMeta {
  runId: string;
  topic: string;
  generatedAt: string;
  sections: ReportSection[];
}

export interface ReportSection {
  agent: string;
  step: string;
  content: string;
}

export interface Report {
  runId: string;
  topic: string;
  generatedAt: string;
  markdown: string;
  sections: ReportSection[];
  raw: Record<string, StepResult>;
}

/** Metadata used to render the four canonical step cards. */
export interface StepDescriptor {
  key: string;
  num: string;
  title: string;
  desc: string;
}

export const PIPELINE_STEPS: StepDescriptor[] = [
  { key: "search", num: "01", title: "Search", desc: "Find recent, reliable sources on the web" },
  { key: "reader", num: "02", title: "Reader", desc: "Scrape the most relevant page in depth" },
  { key: "writer", num: "03", title: "Writer", desc: "Draft the structured Markdown report" },
  { key: "critic", num: "04", title: "Critic", desc: "Score the report and suggest improvements" },
];