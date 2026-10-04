/**
 * Record an annotated demo video of ResearchMind (3 topics, burned-in captions).
 *
 * Flow: auto-start dev servers if needed → open app → 5 s intro hold →
 * for each topic: announce → type → run while narrating each pipeline step →
 * 3 s report hold → slow scroll down the full report → 2 s hold at the bottom →
 * scroll back to top → New run → next topic → save raw .webm to videos/.
 *
 * Env: APP_URL, API_URL, VIEW_W/H (default 1280x800)
 * Next step: `npm run transcode` (GitHub-compatible MP4 via local ffmpeg).
 */
import { chromium } from "playwright-core";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://localhost:3001";
const OUT_DIR = path.join(ROOT, "videos");
const VIEW = { width: Number(process.env.VIEW_W ?? 1280), height: Number(process.env.VIEW_H ?? 800) };

const TOPICS = [
  "health benefits of green tea",
  "How do solid-state batteries work?",
  "State of open-source LLMs",
];

/** Per-step narration shown while each agent runs. */
const STEP_NOTES = {
  Search: "Finding recent, reliable sources (keyless web search)",
  Reader: "Scraping the top source in depth (SSRF-guarded, 3k cap)",
  Writer: "Drafting the Markdown report via the LLM failover chain",
  Critic: "Scoring the report 1-10 and suggesting improvements",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["LOCALAPPDATA"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env["ProgramFiles"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No Chrome/Edge found; set CHROME_PATH");
  return found;
}

async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitForServers(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await up(`${API_URL}/healthz`)) && (await up(APP_URL))) return true;
    await sleep(1500);
  }
  return false;
}

/** Spawn `npm run dev` detached; returns child or null if already running. */
async function ensureServers() {
  if ((await up(`${API_URL}/healthz`)) && (await up(APP_URL))) {
    console.log("[record] servers already running");
    return null;
  }
  console.log("[record] starting dev servers (npm run dev)…");
  const child = spawn(`npm.cmd run dev`, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    // Node ≥18.19 requires shell:true to spawn .cmd shims (EINVAL otherwise)
    shell: true,
  });
  child.unref();
  const ok = await waitForServers(90_000);
  if (!ok) throw new Error("Dev servers did not become ready within 90s");
  console.log("[record] servers ready");
  return child;
}

/** PIDs currently LISTENING on the given TCP ports (parsed from netstat -ano). */
function listeningPids(ports) {
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (m && ports.includes(Number(m[1]))) pids.add(m[2]);
    }
    return [...pids];
  } catch {
    return [];
  }
}

/**
 * Stop the dev servers we started. `taskkill /T` on the launcher PID alone is not
 * always enough (npm/concurrently re-parents node), so fall back to killing
 * whatever still listens on the API/app ports. No-ops when we reused servers
 * that were already running (i.e. we never started them).
 */
async function stopServers(child) {
  if (!child?.pid) return;
  const kill = (pid) =>
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });

  try {
    kill(child.pid);
  } catch {
    /* best effort */
  }

  const ports = [new URL(API_URL).port, new URL(APP_URL).port].filter(Boolean).map(Number);
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const pids = listeningPids(ports);
    if (pids.length === 0) return;
    console.log(`[record] stopping dev servers on ${ports.map((p) => `:${p}`).join(" ")}…`);
    for (const pid of pids) {
      try {
        kill(pid);
      } catch {
        /* best effort */
      }
    }
    await sleep(750);
  }
  console.log("[record] warning: dev servers may still be listening");
}

/** Create the fixed bottom-center caption element inside the page. */
async function initCaption(page) {
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "demo-caption";
    el.style.cssText = [
      "position:fixed", "left:50%", "bottom:30px", "transform:translateX(-50%)",
      "z-index:2147483647", "max-width:860px", "padding:13px 26px",
      "background:rgba(9,13,28,0.94)", "border:1px solid rgba(96,165,250,0.6)",
      "border-radius:14px", "box-shadow:0 8px 30px rgba(0,0,0,0.55)",
      "color:#f1f5f9", 'font:600 21px/1.45 "Segoe UI",system-ui,sans-serif',
      "text-align:center", "pointer-events:none", "opacity:0",
      "transition:opacity 0.25s ease",
    ].join(";");
    document.body.appendChild(el);
  });
}

async function setCaption(page, text) {
  await page.evaluate((t) => {
    const el = document.getElementById("demo-caption");
    if (el) {
      el.textContent = t;
      el.style.opacity = "1";
    }
  }, text);
}

/** Read the four step cards' current status from the DOM. */
async function readSteps(page) {
  return page.$$eval(".step-card", (cards) =>
    cards.map((c) => ({
      title: c.querySelector(".step-title")?.textContent?.trim() ?? "?",
      status: c.classList.contains("done")
        ? "done"
        : c.classList.contains("failed")
          ? "error"
          : c.classList.contains("active")
            ? "running"
            : "waiting",
      tags: [...c.querySelectorAll(".meta-tag")].map((t) => t.textContent?.trim() ?? ""),
    }))
  );
}

/**
 * Watch the step cards until all four finish, narrating each step as it
 * starts (running) and completes (done/error). Returns the final steps.
 */
async function narrateRun(page) {
  const known = {};
  const deadline = Date.now() + 300_000;

  while (Date.now() < deadline) {
    const steps = await readSteps(page);
    if (steps.length === 0) {
      await sleep(250);
      continue;
    }

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const prev = known[s.title];
      known[s.title] = s.status;
      if (prev === s.status) continue;

      if (s.status === "running") {
        await setCaption(page, `${i + 1}/4 ${s.title} — ${STEP_NOTES[s.title] ?? "Working…"}`);
      } else if (s.status === "done") {
        const dur = s.tags.find((t) => /^[\d.]+s$/.test(t));
        const provider = s.tags.find((t) => t.includes(":"))?.split(":")[1]?.trim();
        const meta = [dur, provider].filter(Boolean).join(" · ");
        await setCaption(page, `${i + 1}/4 ${s.title} ✓ complete${meta ? ` — ${meta}` : ""}`);
      } else if (s.status === "error") {
        await setCaption(page, `${i + 1}/4 ${s.title} ✕ failed — continuing with partial results`);
      }
    }

    if (steps.every((s) => s.status === "done" || s.status === "error")) return steps;
    await sleep(250);
  }
  throw new Error("Pipeline run did not finish within 300s");
}

/** Current window scroll position and the maximum reachable offset. */
function scrollMetrics(page) {
  return page.evaluate(() => ({
    y: window.scrollY,
    max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
  }));
}

/**
 * Ease the window scrollbar from `from` to `to` over `ms` with an in-out
 * quadratic curve. We animate manually (instead of `behavior: "smooth"`) so the
 * duration is deterministic — CSS smooth scrolling is browser-paced and would
 * rush past the report far too quickly on tall pages.
 */
function animateScroll(page, from, to, ms) {
  return page.evaluate(
    ({ from, to, ms }) =>
      new Promise((resolve) => {
        const start = performance.now();
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / ms);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad
          window.scrollTo({ top: from + (to - from) * ease, behavior: "instant" });
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    { from, to, ms }
  );
}

/**
 * Slowly scroll to the very bottom so the whole generated report is readable,
 * then hold 2 s there. Speed scales with distance at ~420 px/s (clamped 7–16 s for
 * the first pass) so long reports stay legible instead of flashing past.
 *
 * The page keeps growing while we scroll (critic feedback / provenance panels
 * render right after the run), so we re-measure after every pass and keep going
 * until the scrollbar is genuinely at the bottom — otherwise the video ends on a
 * half-clipped report.
 */
async function showcaseReport(page) {
  await sleep(600); // let post-run panels render before measuring
  let distance = 0;
  let duration = 0;

  for (let pass = 0; pass < 3; pass++) {
    const { y, max } = await scrollMetrics(page);
    const remaining = Math.max(0, max - y);
    if (remaining < 40) break; // reached the true bottom of the document
    const min = pass === 0 ? 7_000 : 3_000;
    const ms = Math.min(16_000, Math.max(min, (remaining / 420) * 1000));
    await animateScroll(page, y, max, ms);
    distance += remaining;
    duration += ms;
    await sleep(400); // settle, then check whether the page grew
  }

  return { distance, duration };
}

/** Smoothly return to the top of the page (brisk, so the demo stays tight). */
async function backToTop(page, ms = 1_800) {
  const { y } = await scrollMetrics(page);
  if (y < 5) return { distance: 0, duration: 0 };
  await animateScroll(page, y, 0, ms);
  return { distance: y, duration: ms };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browserPath = findBrowser();
  console.log(`[record] browser: ${browserPath}`);

  let serverChild = null;
  let context = null;
  let browser = null;
  let video = null;
  let page = null;

  try {
    serverChild = await ensureServers();

    browser = await chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    context = await browser.newContext({
      viewport: VIEW,
      deviceScaleFactor: 1,
      recordVideo: { dir: OUT_DIR, size: VIEW },
    });

    page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    video = page.video();

    console.log("[record] loading app…");
    await page.goto(APP_URL, { waitUntil: "load", timeout: 60_000 });
    await page.waitForSelector("#topic", { timeout: 30_000 });
    await initCaption(page);

    // ── Intro: 5 s hold on the idle screen ──
    await setCaption(page, "🧭 ResearchMind — multi-agent research discovery · free tiers");
    console.log("[record] intro hold (5s)…");
    await sleep(5_000);

    // ── One run per topic ──
    for (let i = 0; i < TOPICS.length; i++) {
      const topic = TOPICS[i];
      const n = i + 1;

      await setCaption(page, `Topic ${n}/${TOPICS.length}: ${topic}`);
      await sleep(1_500);

      await setCaption(page, `⌨ Typing topic ${n}/${TOPICS.length}…`);
      await page.fill("#topic", "");
      await page.locator("#topic").pressSequentially(topic, { delay: 45 });
      await sleep(700);

      await setCaption(page, "▶ Run Pipeline — 4 agents in sequence (live via SSE)");
      await page.click(".topic-input button.btn-primary");

      console.log(`[record] topic ${n}/${TOPICS.length} running…`);
      await narrateRun(page);

      await page.waitForSelector(".report-body", { timeout: 60_000 });
      await setCaption(
        page,
        `✅ Report complete — topic ${n}/${TOPICS.length} · Markdown + .md/.json export`
      );
      console.log(`[record] topic ${n} complete, holding 3s…`);
      await sleep(3_000);

      // ── Slowly scroll the full report, then hold 2 s at the bottom ──
      await setCaption(page, "📜 Scrolling the full report — end to end");
      const scrolled = await showcaseReport(page);
      console.log(
        `[record] topic ${n} scrolled ${scrolled.distance}px in ${(scrolled.duration / 1000).toFixed(1)}s`
      );
      await setCaption(page, "⏸ End of the report — challenges, outlook & conclusions");
      await sleep(2_000);

      // ── Back to the top, then straight on to the next topic ──
      await setCaption(
        page,
        `⬆️ Back to top — ${n < TOPICS.length ? `next up: topic ${n + 1}/${TOPICS.length}` : "that's the demo"}`
      );
      const backed = await backToTop(page);
      console.log(`[record] topic ${n} scrolled back up ${backed.distance}px`);

      if (n < TOPICS.length) {
        await setCaption(page, `↺ New run — preparing topic ${n + 1}/${TOPICS.length}…`);
        await page.click("button.btn-ghost");
        await page.waitForFunction(
          () => document.querySelector(".status-pill")?.textContent?.includes("Idle"),
          { timeout: 10_000 }
        );
        await sleep(1_000);
      }
    }

    await setCaption(page, "✅ Demo complete — free-tier multi-agent pipeline (no paid APIs)");
    console.log("[record] outro hold (2s)…");
    await sleep(2_000);

    if (consoleErrors.length) {
      console.log(`[record] page errors: ${consoleErrors.length}`);
      for (const e of consoleErrors) console.log(`         ✗ ${e}`);
    } else {
      console.log("[record] page errors: 0");
    }
  } catch (err) {
    console.error(`[record] ERROR: ${err.message}`);
    if (page) await setCaption(page, "⚠ Recording stopped early").catch(() => {});
    process.exitCode = 1;
  } finally {
    let videoPath = null;
    try {
      if (video) videoPath = await video.path().catch(() => null);
    } catch {
      /* ignore */
    }

    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    // Video file is finalized by context.close(); save() is optional
    if (video && typeof video.save === "function") {
      try {
        await video.save();
      } catch {
        /* ignore */
      }
    }

    if (videoPath && fs.existsSync(videoPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const finalPath = path.join(OUT_DIR, `demo-raw-${stamp}.webm`);
      fs.renameSync(videoPath, finalPath);
      console.log(`[record] RAW VIDEO: ${finalPath}`);
    } else {
      console.error("[record] no video file produced");
      process.exitCode = 1;
    }

    await stopServers(serverChild);
    console.log("[record] DONE");
    process.exit(process.exitCode ?? 0);
  }
}

await main();
