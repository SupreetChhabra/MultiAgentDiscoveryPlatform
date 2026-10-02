import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

/**
 * Environment bootstrap — MUST be the first import in `index.ts`.
 *
 * The server is normally started with `cwd = server/` (npm workspaces, Render
 * rootDir), but developers often keep a single `.env` at the monorepo root.
 * Load both, closest-first, so either layout works. Existing variables always
 * win (dotenv never overrides), which keeps platform-provided secrets
 * authoritative in production.
 */
const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];

for (const file of candidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
  }
}

export const loadedEnvFiles = candidates.filter((file) => fs.existsSync(file));
export default loadedEnvFiles;