import pino, { type Logger } from "pino";
import fs from "node:fs";
import path from "node:path";

/**
 * Structured logger (FR-4.3).
 *
 * - Writes JSON lines to `logs/pipeline.log` in every environment.
 * - Prints pretty, colourised output to stdout in development.
 * - In production it prints JSON to stdout (Render captures it).
 * - In tests it stays completely silent to avoid worker-thread / file noise.
 *
 * Secrets are never logged: only provider *names* and model ids are recorded,
 * never API keys.
 */
const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

function createLogger(): Logger {
  if (isTest) {
    return pino({ level: "silent" });
  }

  const logFile = path.resolve(process.cwd(), "logs", "pipeline.log");
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
  } catch {
    /* directory already exists or is not writable — file stream will no-op */
  }

  type Streams = Parameters<typeof pino.multistream>[0];
  const streams: Streams = [
    {
      level,
      stream: pino.destination({ dest: logFile, sync: false }),
    },
  ];

  if (isProd) {
    streams.push({ level, stream: process.stdout });
  } else {
    streams.push({
      level,
      stream: pino.transport({
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
      }),
    });
  }

  return pino(
    { level, base: { service: "multi-agent-discovery" } },
    pino.multistream(streams, { dedupe: false })
  );
}

export const logger: Logger = createLogger();

export default logger;