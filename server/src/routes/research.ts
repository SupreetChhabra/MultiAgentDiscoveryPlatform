import { Router } from "express";
import { randomUUID } from "node:crypto";
import { runStore } from "../orchestrator/runStore.js";
import { logger } from "../utils/logger.js";

/**
 * POST /api/research (TDD §6.2).
 *
 * Creates a run for a topic and returns its id. The client then subscribes to
 * `GET /api/runs/:id/stream` to watch the pipeline progress.
 */

const router = Router();
const MAX_TOPIC_LENGTH = 300;
const MAX_URLS = 5;

router.post("/", (req, res) => {
  const raw = req.body?.topic;
  const topic = typeof raw === "string" ? raw.trim() : "";

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    return res.status(400).json({ error: `Topic must be ${MAX_TOPIC_LENGTH} characters or fewer` });
  }

  // Optional manual source URLs (PRD §5 — fallback when search quality is poor).
  const rawUrls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  const urls: string[] = rawUrls
    .filter((u: unknown): u is string => typeof u === "string")
    .map((u: string) => u.trim())
    .filter((u: string) => /^https?:\/\//i.test(u))
    .slice(0, MAX_URLS);

  const runId = randomUUID();
  runStore.create(runId, topic, urls);
  logger.info({ runId, topic, urls: urls.length }, "run.created");

  return res.status(201).json({ runId });
});

export default router;