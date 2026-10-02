import { search, SafeSearchType } from "duck-duck-scrape";
import axios from "axios";
import { logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import { withTimeout } from "../utils/timeout.js";
import { searchWikipedia } from "./wikipedia.js";

/**
 * Free web search with a resilient provider chain (TDD §4.1, PRD §5).
 *
 * Order:
 *   1. **SearXNG / Jiro** — only when `SEARCH_URL` is set (self-hosted, free).
 *   2. **DuckDuckGo** via `duck-duck-scrape` — keyless, retried with backoff.
 *   3. **Wikipedia** — keyless fallback when DuckDuckGo challenges the IP.
 *
 * No provider requires an API key, so the platform stays free forever.
 */

const SEARCH_TIMEOUT_MS = 10_000; // PRD §3.2
const DEFAULT_LIMIT = 5;
const DDG_ATTEMPTS = 3;

export interface SearchResultItem {
  title: string;
  url: string;
  description: string;
  source?: string;
}

/** DuckDuckGo search with retries (handles transient throttling). */
async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResultItem[]> {
  const results = await retry(
    () =>
      withTimeout(
        search(query, { safeSearch: SafeSearchType.MODERATE }),
        SEARCH_TIMEOUT_MS,
        "webSearch"
      ),
    DDG_ATTEMPTS,
    500,
    "duckduckgo.search"
  );

  const mapped = (results.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
    source: "duckduckgo",
  }));

  // DuckDuckGo answers a challenge with an empty result set rather than an error.
  if (mapped.length === 0) {
    throw new Error("DuckDuckGo returned no results (possible anomaly challenge)");
  }

  logger.debug({ query, count: mapped.length }, "search.duckduckgo.ok");
  return mapped;
}

/** Optional self-hosted SearXNG / Jiro JSON API (PRD §4 — 9 engines, free). */
async function searchSearxng(query: string, limit: number): Promise<SearchResultItem[]> {
  const base = process.env.SEARCH_URL;
  if (!base) throw new Error("SEARCH_URL not configured");

  const response = await withTimeout(
    axios.get<{ results?: { title?: string; url?: string; content?: string }[] }>(base, {
      params: { q: query, format: "json" },
      timeout: SEARCH_TIMEOUT_MS,
      headers: { "User-Agent": "MultiAgentDiscoveryBot/2.0" },
    }),
    SEARCH_TIMEOUT_MS,
    "searxng.search"
  );

  const mapped = (response.data?.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.content ?? "",
    source: "searxng",
  }));

  if (mapped.length === 0) throw new Error("SearXNG returned no results");
  logger.debug({ query, count: mapped.length }, "search.searxng.ok");
  return mapped;
}

/**
 * Run the provider chain and return the first non-empty result set.
 * Throws only when every provider in the chain fails.
 */
export async function webSearchRaw(query: string, limit = DEFAULT_LIMIT): Promise<SearchResultItem[]> {
  const providers = [
    { name: "searxng", run: () => searchSearxng(query, limit) },
    { name: "duckduckgo", run: () => searchDuckDuckGo(query, limit) },
    { name: "wikipedia", run: () => searchWikipedia(query, limit) },
  ].filter((provider) => provider.name !== "searxng" || Boolean(process.env.SEARCH_URL));

  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const results = await provider.run();
      if (results.length > 0) return results;
      errors.push(`${provider.name}: empty results`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${message}`);
      logger.warn({ provider: provider.name, error: message }, "search.provider.failed");
    }
  }

  throw new Error(`All search providers failed:\n${errors.join("\n")}`);
}

/**
 * Formatted search text handed to the LLM as the "search results" block.
 * Never throws — returns an error string so the pipeline degrades gracefully.
 */
export async function webSearch(query: string): Promise<string> {
  try {
    const items = await webSearchRaw(query);
    const provider = items[0]?.source ?? "unknown";
    const body = items
      .map(
        (r) => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.description.slice(0, 300)}\n`
      )
      .join("\n----\n");
    return `[source: ${provider}]\n\n${body}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ error: message }, "search.failed");
    return `Search failed: ${message}`;
  }
}

export default webSearch;