import { Router } from "express";
import { runResearchPipeline } from "../orchestrator/pipeline.js";
import { runStore } from "../orchestrator/runStore.js";
import { buildReport } from "../orchestrator/report.js";
import { logger } from "../utils/logger.js";

/**
 * Run routes (TDD §6.2).
 *
 * - `GET /api/runs/:id/stream` → Server-Sent Events: `step` | `done` | `error`
 * - `GET /api/runs/:id/report` → aggregated report (`?format=md|json`)
 * - `GET /api/runs/:id`        → raw run snapshot
 */

const router = Router();
const KEEP_ALIVE_MS = 15_000; // also keeps Render free-tier proxies from idling out

function openSse(res: import("express").Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx/Render)
  });
  res.flushHeaders?.();
}

router.get("/:id/stream", async (req, res) => {
  const runId = req.params.id;
  const run = runStore.get(runId);

  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  openSse(res);
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // A finished run: replay the final state so a late/reconnecting client still
  // receives a `done` event instead of hanging.
  if (run.status === "done") {
    send("done", { state: run.state, report: buildReport(run.id, run.state) });
    return res.end();
  }

  // A run that is already being driven by another connection.
  if (run.status === "running") {
    send("error", { message: "Run is already in progress" });
    return res.end();
  }

  const ping = setInterval(() => res.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
  runStore.update(runId, { status: "running" });

  try {
    for await (const { step, state } of runResearchPipeline(run.topic, { urls: run.state.urls ?? [] })) {
      run.state = state;
      runStore.update(runId, { state, status: "running" });
      send("step", { step, state });
      await runStore.checkpoint(runId, state); // FR-4.4
    }

    runStore.update(runId, { status: "done", state: run.state });
    logger.info({ runId }, "run.done");
    send("done", { state: run.state, report: buildReport(runId, run.state) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runStore.update(runId, { status: "error", error: message });
    logger.error({ runId, error: message }, "run.failed");
    send("error", { message });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

router.get("/:id/report", (req, res) => {
  const run = runStore.get(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }

  const report = buildReport(run.id, run.state);

  // Metadata + URLs only, so the client can download the Markdown itself from
  // the live SSE state (works even if the backend later goes to sleep).
  if (req.query.meta === "1") {
    return res.json({
      runId: report.runId,
      topic: report.topic,
      generatedAt: report.generatedAt,
      sections: report.sections,
    });
  }

  if (req.query.format === "json") {
    return res.json(report);
  }

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="report-${run.id}.md"`);
  return res.send(report.markdown);
});

router.get("/:id", (req, res) => {
  const run = runStore.get(req.params.id);
  if (!run) {
    return res.status(404).json({ error: "Run not found" });
  }
  return res.json(run);
});

export default router;