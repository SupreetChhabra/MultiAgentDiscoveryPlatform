import { scrapeUrl } from "../tools/scrape.js";

/**
 * ReaderAgent (TDD §7.2).
 *
 * Picks the most relevant URL from the search output and scrapes its deep
 * content. v1 uses a deterministic first-URL extraction (per TDD) so the step
 * needs no API key and stays fast; the system prompt is retained so an
 * LLM-driven URL picker can be dropped in later.
 */

export const READER_AGENT_ID = "reader-agent";
export const READER_SYSTEM_PROMPT =
  "You are a content extraction specialist. Given search results, pick the most " +
  "relevant URL, scrape it, and return the deep content.";

const URL_PATTERN = /URL:\s*(\S+)/;
const URL_GLOBAL = /URL:\s*(\S+)/g;
/** Cap how many sources the Reader will scrape (free-tier RAM/latency). */
export const MAX_READER_URLS = 3;

/** Extract the first `URL: ...` value from formatted search results. */
export function pickFirstUrl(searchOutput: string): string | null {
  const match = searchOutput.match(URL_PATTERN);
  return match?.[1] ?? null;
}

/**
 * Extract every distinct `URL: ...` value from search output, in order.
 * Used to try the next source when one URL is blocked or unscrapable (PRD §5).
 */
export function extractAllUrls(searchOutput: string, limit = MAX_READER_URLS): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of searchOutput.matchAll(URL_GLOBAL)) {
    const url = match[1]?.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
      if (urls.length >= limit) break;
    }
  }

  return urls;
}

export interface ReaderAgentResult {
  url: string | null;
  output: string;
  provider: string;
}

/** A scrape result is only useful if it is real content, not an error string. */
function isUsableContent(text: string): boolean {
  return (
    text.trim().length > 0 &&
    !text.startsWith("Blocked unsafe URL:") &&
    !text.startsWith("Skipped non-HTML content:") &&
    !text.startsWith("Could not scrape URL:") &&
    !text.startsWith("No readable text extracted")
  );
}

/**
 * Scrape the most relevant source (never throws).
 *
 * Tries each candidate URL in order — user-supplied URLs first (PRD §5 manual
 * fallback), then every URL found in the search output — and returns the first
 * one that yields real content. This makes the Reader resilient when a single
 * source is blocked, JS-only, or returns a non-HTML payload.
 */
export async function runReaderAgent(
  searchOutput: string,
  manualUrls: string[] = []
): Promise<ReaderAgentResult> {
  const candidates = [...new Set([...manualUrls, ...extractAllUrls(searchOutput)])];

  if (candidates.length === 0) {
    return { url: null, output: "No URL found in search results.", provider: "local" };
  }

  const attempts: string[] = [];

  for (const url of candidates) {
    const output = await scrapeUrl(url);
    if (isUsableContent(output)) {
      const header =
        manualUrls.includes(url) && candidates.indexOf(url) === 0
          ? `[user-provided source]\n\n`
          : "";
      return { url, output: header + output, provider: "local" };
    }
    attempts.push(`${url} -> ${output.slice(0, 120)}`);
  }

  // Nothing scraped cleanly: still return the last message so the run is
  // transparent rather than silently empty.
  return {
    url: candidates[0] ?? null,
    output: `Could not extract usable content from any source:\n${attempts.join("\n")}`,
    provider: "local",
  };
}