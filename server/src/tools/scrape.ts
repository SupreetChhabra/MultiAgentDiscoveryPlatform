import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import ipaddr from "ipaddr.js";
import { logger } from "../utils/logger.js";

/**
 * Hardened scraper (TDD §4.2).
 *
 * - **SSRF guard:** rejects private / loopback / link-local / reserved hosts and
 *   re-validates *every* redirect hop (PRD §3.3).
 * - 8s timeout, HTML-only, 3,000-char cap to stay inside the Render 512 MB
 *   free tier (PRD §5).
 * - Never throws: returns a human-readable error string on failure.
 */

const SCRAPE_TIMEOUT_MS = 8_000; // PRD §3.2
const MAX_CHARS = 3_000;
const MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
]);

const BLOCKED_RANGES = new Set([
  "private",
  "loopback",
  "linkLocal",
  "uniqueLocal",
  "carrierGradeNat",
  "reserved",
  "unspecified",
  "broadcast",
  "multicast",
]);

/** True only for public `http(s)` URLs that do not resolve to an internal host. */
export function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  // `URL.hostname` keeps IPv6 brackets, e.g. "[::1]".
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }

  if (ipaddr.isValid(host)) {
    const range = ipaddr.parse(host).range();
    if (BLOCKED_RANGES.has(range)) return false;
  }

  return true;
}

/** Follow redirects manually so every hop passes the SSRF guard. */
async function safeGet(startUrl: string): Promise<AxiosResponse<string>> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeUrl(current)) {
      throw new Error(`Blocked unsafe URL: ${current}`);
    }

    const response = await axios.get<string>(current, {
      timeout: SCRAPE_TIMEOUT_MS,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MultiAgentDiscoveryBot/2.0)" },
      maxRedirects: 0,
      responseType: "text",
      // Resolve (do not throw) on 3xx so we can validate the next hop ourselves.
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location as string | undefined;
      if (!location) throw new Error("Redirect without a Location header");
      current = new URL(location, current).toString();
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

/** Extract readable text from an HTML document. */
export function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, aside, iframe, svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
}

/** Scrape a URL and return capped plain text (never throws). */
export async function scrapeUrl(url: string): Promise<string> {
  if (!isSafeUrl(url)) {
    return `Blocked unsafe URL: ${url}`;
  }

  try {
    const response = await safeGet(url);

    const contentType = String(response.headers["content-type"] ?? "");
    if (!contentType.includes("text/html")) {
      return `Skipped non-HTML content: ${url} (${contentType || "unknown"})`;
    }

    const text = extractText(response.data);
    if (!text) return `No readable text extracted from: ${url}`;

    logger.debug({ url, chars: text.length }, "scrape.ok");
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url, error: message }, "scrape.failed");
    return `Could not scrape URL: ${message}`;
  }
}

export default scrapeUrl;