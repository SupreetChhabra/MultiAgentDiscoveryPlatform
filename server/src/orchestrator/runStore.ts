import fs from "node:fs";
import path from "node:path";
import type { PipelineState } from "../schemas/pipeline.js";
import { logger } from "../utils/logger.js";

/**
 * In-memory run store with disk checkpointing (TDD §6 / FR-4.4).
 *
 * Free hosting provides no persistent disk, so runs live in memory and each
 * pipeline step is *also* checkpointed to `logs/checkpoints/<runId>.json` for
 * crash recovery and debugging. Results stay retrievable via
 * `GET /api/runs/:id/report` even if the browser tab is closed (PRD §5).
 */

export type RunStatus = "created" | "running" | "done" | "error";

export interface Run {
  id: string;
  topic: string;
  state: PipelineState;
  status: RunStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const CHECKPOINT_DIR = path.resolve(process.cwd(), "logs", "checkpoints");
/** Cap retained runs so a long-lived free-tier instance cannot grow unbounded. */
const MAX_RUNS = Number(process.env.MAX_RUNS ?? 100);

export class RunStore {
  private runs = new Map<string, Run>();

  /** Register a new run in the `created` state. */
  create(id: string, topic: string, urls: string[] = []): Run {
    const now = Date.now();
    const run: Run = {
      id,
      topic,
      state: { topic, urls, steps: {} },
      status: "created",
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(id, run);
    this.evictOldest();
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  list(): Run[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Merge a partial update into a run and bump `updatedAt`. */
  update(id: string, patch: Partial<Omit<Run, "id" | "createdAt">>): Run | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    Object.assign(run, patch, { updatedAt: Date.now() });
    return run;
  }

  delete(id: string): boolean {
    return this.runs.delete(id);
  }

  /**
   * Persist the latest state to disk. Best-effort: a failure here must never
   * break the pipeline (the free tier may have a read-only FS).
   */
  async checkpoint(id: string, state: PipelineState): Promise<void> {
    try {
      await fs.promises.mkdir(CHECKPOINT_DIR, { recursive: true });
      const file = path.join(CHECKPOINT_DIR, `${id}.json`);
      await fs.promises.writeFile(file, JSON.stringify({ id, state, at: Date.now() }, null, 2), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug({ id, error: message }, "checkpoint.failed");
    }
  }

  /** Drop the oldest runs once the store exceeds `MAX_RUNS`. */
  private evictOldest(): void {
    while (this.runs.size > MAX_RUNS) {
      const oldest = [...this.runs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      this.runs.delete(oldest.id);
    }
  }
}

/** Process-wide singleton. */
export const runStore = new RunStore();

export default runStore;