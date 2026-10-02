import { z } from "zod";

/**
 * Shared pipeline state contracts (TDD §8).
 *
 * These schemas are the single source of truth for both the backend types and
 * the integrity checks applied to the agent registry on load (FR-1.4).
 */

export const StepStatusSchema = z.enum(["waiting", "running", "done", "error"]);

export const StepResultSchema = z.object({
  status: StepStatusSchema.default("waiting"),
  output: z.string().optional(),
  error: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.number().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export const PipelineStateSchema = z.object({
  topic: z.string(),
  /** User-supplied URLs used as search fallback (PRD §5). */
  urls: z.array(z.string()).default([]),
  steps: z.record(z.string(), StepResultSchema).default({}),
  report: z.string().optional(),
  feedback: z.string().optional(),
});

export type StepStatus = z.infer<typeof StepStatusSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type PipelineState = z.infer<typeof PipelineStateSchema>;

/** ── Agent capability registry (FR-1.1 / FR-1.4) ─────────────────────────── */

export const AgentCapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  provider: z.string().optional(),
  version: z.string().optional(),
});

export const AgentRegistrySchema = z.object({
  version: z.string().optional(),
  agents: z.array(AgentCapabilitySchema).min(1),
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type AgentRegistry = z.infer<typeof AgentRegistrySchema>;

/** ── Aggregated report object (FR-5.1 / FR-5.3) ──────────────────────────── */

export const ReportSectionSchema = z.object({
  agent: z.string(),
  step: z.string(),
  content: z.string(),
});

export const ReportSchema = z.object({
  runId: z.string(),
  topic: z.string(),
  generatedAt: z.string(),
  markdown: z.string(),
  sections: z.array(ReportSectionSchema).default([]),
  raw: z.record(z.string(), StepResultSchema).default({}),
});

export type ReportSection = z.infer<typeof ReportSectionSchema>;
export type Report = z.infer<typeof ReportSchema>;

/** The four canonical pipeline steps, in execution order. */
export const PIPELINE_STEPS = ["search", "reader", "writer", "critic"] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];