/**
 * Real-browser smoke test for the ResearchMind UI.
 *
 * Drives an installed Chrome/Edge (via puppeteer-core — no bundled download):
 *   1. loads the client
 *   2. fills in a topic and clicks "Run Pipeline"
 *   3. waits for the four step cards to reach DONE over SSE
 *   4. asserts the sanitized Markdown report + download buttons render
 *   5. captures a screenshot and reports console/page errors
 *
 * Usage:
 *   node scripts/browser-smoke.mjs
 * Env:
 *   APP_URL      (default http://localhost:5173)
 *   CHROME_PATH  (auto-detected if omitted)
 *   TOPIC        (default "health benefits of green tea")
 *   SHOT         (screenshot path, default ./browser-smoke.png)
 *   HEADFUL=1    run with a visible window
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const TOPIC = process.env.TOPIC ?? "health benefits of green tea";
const SHOT = process.env.SHOT ?? "browser-smoke.png";

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

const browserPath = findBrowser();
console.log(`[smoke] browser : ${browserPath}`);
console.log(`[smoke] app     : ${APP_URL}`);

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: !process.env.HEADFUL,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const consoleErrors = [];
const pageErrors = [];
let failed = false;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // 1. Load + React mount
  await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector("#topic", { timeout: 15_000 });
  const heading = await page.$eval(".brand h1", (el) => el.textContent);
  console.log(`[smoke] rendered heading: "${heading}"`);
  if (heading !== "ResearchMind") throw new Error(`unexpected heading: ${heading}`);

  // Regression guard: React must actually have mounted (not an empty shell)
  const stepCards = await page.$$(".step-card");
  console.log(`[smoke] step cards rendered: ${stepCards.length}`);
  if (stepCards.length !== 4) throw new Error(`expected 4 step cards, got ${stepCards.length}`);

  // 2. Run the pipeline
  await page.type("#topic", TOPIC);
  await Promise.all([
    page.waitForFunction(
      () =>
        document.querySelectorAll(".step-status.status-running, .step-status.status-done").length >
        0,
      { timeout: 30_000 }
    ),
    page.click("button.btn-primary"),
  ]);
  console.log("[smoke] pipeline started, streaming…");

  // 3. Wait for all four steps to finish (done or error)
  await page.waitForFunction(
    () => {
      const cards = [...document.querySelectorAll(".step-card")];
      return (
        cards.length === 4 && cards.every((c) => c.querySelector(".status-done, .status-error"))
      );
    },
    { timeout: 150_000, polling: 500 }
  );

  const steps = await page.$$eval(".step-card", (cards) =>
    cards.map((c) => ({
      title: c.querySelector(".step-title")?.textContent ?? "?",
      status: c.querySelector(".step-status")?.textContent?.trim() ?? "?",
      tags: [...c.querySelectorAll(".meta-tag")].map((t) => t.textContent),
    }))
  );
  console.log("[smoke] step results:");
  for (const s of steps) {
    console.log(`         ${s.title.padEnd(8)} ${s.status.padEnd(8)} ${s.tags.join(" | ")}`);
  }

  // 4. Report + downloads must render
  await page.waitForSelector(".report-body", { timeout: 20_000 });
  const reportInfo = await page.$eval(".report-body", (el) => ({
    headingCount: el.querySelectorAll("h1,h2,h3").length,
    links: el.querySelectorAll("a").length,
    textLength: (el.textContent ?? "").trim().length,
  }));
  console.log(
    `[smoke] report: ${reportInfo.headingCount} headings, ${reportInfo.textLength} chars, ${reportInfo.links} links`
  );
  if (reportInfo.textLength < 200) throw new Error("report body looks empty");

  await page.waitForSelector(".download-buttons button", { timeout: 10_000 });
  const downloads = await page.$$eval(".download-buttons button", (b) => b.map((x) => x.textContent));
  console.log(`[smoke] download buttons: ${downloads.join(", ")}`);

  // Sanitization guard (PRD §3.3): the report must contain no <script> nodes
  const injected = await page.$$eval(".report-body script", (s) => s.length);
  if (injected > 0) throw new Error("sanitization failed: <script> found in report");
  console.log("[smoke] sanitization: no <script> in report body ✓");

  // 5. Screenshot
  await page.screenshot({ path: SHOT, fullPage: true });
  console.log(`[smoke] screenshot -> ${SHOT}`);

  console.log(`[smoke] console errors: ${consoleErrors.length}`);
  for (const e of consoleErrors) console.log(`         ✗ ${e}`);
  console.log(`[smoke] page errors: ${pageErrors.length}`);
  for (const e of pageErrors) console.log(`         ✗ ${e}`);
  if (pageErrors.length) throw new Error("page-level errors occurred");

  console.log("\n[smoke] RESULT: PASS");
} catch (err) {
  failed = true;
  console.error(`\n[smoke] RESULT: FAIL\n  ${err.message}`);
  if (consoleErrors.length) console.error("  console errors:", consoleErrors.join(" | "));
  if (pageErrors.length) console.error("  page errors:", pageErrors.join(" | "));
} finally {
  await browser.close();
  process.exit(failed ? 1 : 0);
}
