import "./utils/env.js";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";

import { logger } from "./utils/logger.js";
import { loadedEnvFiles } from "./utils/env.js";
import researchRouter from "./routes/research.js";
import runsRouter from "./routes/runs.js";
import agentsRouter, { discoverHandler } from "./routes/agents.js";

/**
 * Express entrypoint (TDD §6.2 / Phase 13).
 *
 * Free-tier friendly:
 * - CORS restricted to `CLIENT_ORIGIN` (PRD §3.3).
 * - `GET /healthz` is a cheap liveness probe used to warm a sleeping backend.
 * - Optionally serves the built React app from `public/` (TDD deployment
 *   Option C — single Render service).
 */

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const app = express();
app.disable("x-powered-by");

// Accept the configured frontend origin (plus Vercel preview deploys).
const allowedOrigins = new Set(
  [CLIENT_ORIGIN, ...(process.env.CLIENT_ORIGINS?.split(",") ?? [])]
    .map((o) => o.trim())
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / curl (no Origin header) and known origins.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      if (origin.endsWith(".vercel.app")) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: false,
  })
);

app.use(express.json({ limit: "128kb" }));

// Lightweight request logging (never logs bodies or keys).
app.use((req, _res, next) => {
  logger.debug({ method: req.method, url: req.url }, "http.request");
  next();
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/healthz", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.use("/api/research", researchRouter);
app.use("/api/runs", runsRouter);
app.use("/api/agents", agentsRouter);
// PRD names this endpoint POST /api/discover.
app.post("/api/discover", discoverHandler);

// ── Optional: serve the built frontend (deployment Option C) ────────────────
const publicDir = path.resolve(process.cwd(), "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api|healthz).*/, (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  logger.info({ publicDir }, "static.frontend.enabled");
}

// ── 404 + error handling ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message }, "http.error");
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
  logger.info(
    { port: PORT, clientOrigin: CLIENT_ORIGIN, envFiles: loadedEnvFiles },
    "server.started"
  );
});

// Graceful shutdown so Render restarts are clean.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "server.stopping");
    server.close(() => process.exit(0));
  });
}

export { app, server };