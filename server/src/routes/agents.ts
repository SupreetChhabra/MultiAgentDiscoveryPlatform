import { Router, type Request, type Response } from "express";
import { loadRegistry, discoverAgents } from "../registry/discovery.js";
import { logger } from "../utils/logger.js";

/**
 * Agent registry & discovery routes (FR-1).
 *
 * - `GET  /api/agents`           → every registered agent capability (FR-1.2)
 * - `POST /api/agents/discover`  → best-matching agents for a task (FR-1.3)
 * - `POST /api/discover`         → alias of the above (PRD-named endpoint)
 */

const router = Router();
const MAX_TASK_LENGTH = 500;

router.get("/", (_req, res) => {
  try {
    const registry = loadRegistry();
    return res.json(registry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "agents.load.failed");
    return res.status(500).json({ error: `Failed to load agent registry: ${message}` });
  }
});

/** Shared handler for both `/api/agents/discover` and `/api/discover`. */
export async function discoverHandler(req: Request, res: Response) {
  const raw = req.body?.task;
  const task = typeof raw === "string" ? raw.trim() : "";

  if (!task) {
    return res.status(400).json({ error: "Task description is required" });
  }
  if (task.length > MAX_TASK_LENGTH) {
    return res.status(400).json({ error: `Task must be ${MAX_TASK_LENGTH} characters or fewer` });
  }

  try {
    const requested = Number(req.body?.topK ?? 3);
    const topK = Number.isFinite(requested) ? Math.min(Math.max(1, requested), 10) : 3;
    const { backend, matches } = await discoverAgents(task, topK);
    return res.json({ task, backend, matches });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "agents.discover.failed");
    return res.status(500).json({ error: `Discovery failed: ${message}` });
  }
}
router.post("/discover", discoverHandler);

export default router;