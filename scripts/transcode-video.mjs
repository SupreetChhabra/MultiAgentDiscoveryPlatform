/**
 * Transcode the recorded .webm into a GitHub-friendly MP4 + a poster frame.
 *
 * Output: docs/demo/researchmind-demo.mp4  (1280x800, 25 fps, crf 20)
 *         docs/demo/poster.png              (frame near the end: report + caption)
 *
 * Playback note: the README links the MP4 through a GitHub *attachment* URL
 * (github.com/user-attachments/assets/...), which serves `Content-Type: video/mp4`
 * inline so the browser plays it. Linking the repo blob/raw URL instead does NOT
 * work -- raw.githubusercontent.com serves `application/octet-stream` with
 * `X-Content-Type-Options: nosniff`, so the browser downloads the file at any size.
 *
 * Size budget: free-plan GitHub attachments cap video at 10 MB, so the encoder
 * escalates CRF until the output fits.
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
const POSTER = path.join(OUT_DIR, "poster.png");

// Free-plan GitHub attachments cap video uploads at 10 MB. The recording is a
// text-dense UI capture, so we keep the source resolution/fps and trade CRF
// until it fits rather than downscaling or dropping frames.
const WIDTH = 1280;
const HEIGHT = 800;
const FPS = 25;
const CRF_LADDER = [20, 23, 26, 29, 32, 35];
const CAP_MB = 10;

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

// Encode at source resolution/fps, escalating CRF until it fits the 10 MB cap.
// Don't add "-tune animation": it disables deblocking and inflates the file ~25%.
// "yuv420p" + "faststart" are required for Safari and for progressive playback.
let result = null;
for (const crf of CRF_LADDER) {
  console.log(`[transcode] encoding (${WIDTH}×${HEIGHT} · ${FPS} fps · crf ${crf} · yuv420p · faststart)…`);
  const enc = spawnSync(
    FFMPEG,
    ["-y", "-i", input, "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}`, "-c:v", "libx264", "-crf", String(crf),
     "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUT_MP4],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", windowsHide: true }
  );
  if (enc.status !== 0) fail(`crf ${crf} encode failed:\n${(enc.stderr ?? "").slice(-800)}`);

  const mb = fs.statSync(OUT_MP4).size / 1024 / 1024;
  console.log(`[transcode] crf ${crf}: ${mb.toFixed(2)} MB`);
  result = { crf, mb };
  if (mb <= CAP_MB) break;
  console.log(`[transcode] over the ${CAP_MB} MB attachment cap — raising crf`);
}

if (!result) fail("no encode produced output");
if (result.mb > CAP_MB)
  console.log(`[transcode] WARNING: ${result.mb.toFixed(2)} MB still exceeds the ${CAP_MB} MB cap — the upload may fail`);
console.log(`[transcode] final: crf ${result.crf} · ${result.mb.toFixed(2)} MB -> ${OUT_MP4}`);

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
