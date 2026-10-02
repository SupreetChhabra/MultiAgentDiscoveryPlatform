/**
 * Copies non-TypeScript assets (currently the agent registry) from `src/` into
 * `dist/` so the compiled server can load them at runtime. Runs after `tsc`.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pairs = [
  [path.join("src", "registry", "agents.json"), path.join("dist", "registry", "agents.json")],
];

for (const [from, to] of pairs) {
  const src = path.resolve(root, from);
  const dest = path.resolve(root, to);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-assets] skipped (missing): ${from}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[copy-assets] ${from} -> ${to}`);
}