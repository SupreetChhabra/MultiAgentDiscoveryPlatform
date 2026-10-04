/**
 * Transcode the recorded .webm into GitHub-friendly MP4s + a poster frame.
 *
 * Output: docs/demo/researchmind-demo-preview.mp4  (under ~2 MB so GitHub renders
 *           an inline player: 1152x720, 15 fps, crf 42)
 *         docs/demo/researchmind-demo.mp4         (crisp master: 1152x720, 20 fps, crf 37)
 *         docs/demo/poster.png                    (frame near the end: report + caption)
 *
 * Env: FFMPEG_PATH (defaults to the local build at D:\Pega\1\…)
 * Usage: node scripts/transcode-video.mjs [input.webm]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FFMPEG =
  process.env.FFMPEG_PATH ??
  String.raw`D:\Pega\1\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe`;
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, "ffprobe.exe");
const VIDEO_DIR = path.join(ROOT, "videos");
const OUT_DIR = path.join(ROOT, "docs", "demo");
const OUT_MP4 = path.join(OUT_DIR, "researchmind-demo.mp4");
const OUT_PREVIEW = path.join(OUT_DIR, "researchmind-demo-preview.mp4");
const POSTER = path.join(OUT_DIR, "poster.png");

const fail = (msg) => {
  console.error(`[transcode] ERROR: ${msg}`);
  process.exit(1);
};

if (!fs.existsSync(FFMPEG)) fail(`ffmpeg not found at ${FFMPEG}`);

// Resolve input: explicit arg, else newest .webm in videos/
let input = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!input) {
  const webms = fs.existsSync(VIDEO_DIR)
    ? fs
        .readdirSync(VIDEO_DIR)
        .filter((f) => f.endsWith(".webm"))
        .map((f) => path.join(VIDEO_DIR, f))
    : [];
  if (!webms.length) fail("no .webm in videos/ — run `npm run record` first");
  webms.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  input = webms[0];
}
console.log(`[transcode] input : ${input}`);

const probeDuration = (file) => {
  const r = spawnSync(
    FFPROBE,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" }
  );
  return parseFloat((r.stdout ?? "").trim());
};

const dur = probeDuration(input);
if (!Number.isFinite(dur)) fail("ffprobe could not read input duration");
console.log(`[transcode] source duration: ${dur.toFixed(1)}s`);

fs.mkdirSync(OUT_DIR, { recursive: true });

// GitHub will not preview a video over ~2 MB (measured: 1.28 MB renders a player,
// 2.22 MB shows "we can't show files that are this big"), but a 114 s text-dense
// UI capture needs ~4 MB to keep small type crisp. So emit two files:
//   preview -> under the cap, plays inline on github.com (softer, 15 fps)
//   full    -> 20 fps, crisp; GitHub offers it as a download only
// Don't add "-tune animation": it disables deblocking and inflates the file ~25%.
const ENCODES = [
  { label: "preview", out: OUT_PREVIEW, fps: 15, crf: 42, capMB: 1.9 },
  { label: "full   ", out: OUT_MP4, fps: 20, crf: 37, capMB: Infinity },
];

for (const { label, out, fps, crf, capMB } of ENCODES) {
  console.log(`[transcode] encoding ${label} (1152×720 · ${fps} fps · crf ${crf} · yuv420p · faststart)…`);
  const enc = spawnSync(
    FFMPEG,
    ["-y", "-i", input, "-vf", `fps=${fps},scale=1152:720`, "-c:v", "libx264", "-crf", String(crf),
     "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", windowsHide: true }
  );
  if (enc.status !== 0) fail(`${label} encode failed:\n${(enc.stderr ?? "").slice(-800)}`);

  const mb = fs.statSync(out).size / 1024 / 1024;
  console.log(`[transcode] ${label}: ${mb.toFixed(2)} MB -> ${out}`);
  if (mb > capMB)
    console.log(`[transcode] WARNING: preview over ~2 MB means GitHub shows "can't show files this big" instead of a player — raise its crf`);
}

const posterAt = Math.max(1, dur - 1.5);
console.log(`[transcode] extracting poster @ ${posterAt.toFixed(1)}s…`);
const shot = spawnSync(
  FFMPEG,
  ["-y", "-ss", String(posterAt), "-i", OUT_MP4, "-frames:v", "1", POSTER],
  { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", windowsHide: true }
);
if (shot.status !== 0) fail(`poster extraction failed:\n${(shot.stderr ?? "").slice(-500)}`);

const verify = spawnSync(
  FFPROBE,
  ["-v", "error", "-select_streams", "v:0",
   "-show_entries", "stream=codec_name,width,height,pix_fmt",
   "-show_entries", "format=duration,size", "-of", "json", OUT_MP4],
  { encoding: "utf8", windowsHide: true }
);
console.log("[transcode] VERIFY:");
try {
  console.log(JSON.stringify(JSON.parse(verify.stdout), null, 2));
} catch {
  console.log(verify.stdout);
}

console.log(`[transcode] POSTER : ${POSTER}`);
console.log("[transcode] DONE");
