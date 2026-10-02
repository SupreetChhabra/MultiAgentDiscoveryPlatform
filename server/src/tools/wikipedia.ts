import axios from "axios";
import { logger } from "../utils/logger.js";
import { withTimeout } from "../utils/timeout.js";
import type { SearchResultItem } from "./search.js";

/**
 * Keyless Wikipedia fallback search (PRD §5 — "Search results low quality").
 *
 * DuckDuckGo can rate-limit or challenge busy/datacenter IPs. Wikipedia's
 * MediaWiki API needs **no API key** and no quota, so it is a reliable fallback
 * that still yields citable, real sources for research topics.
 */

const WIKI_TIMEOUT_MS = 10_000;
const API_URL = process.env.WIKIPEDIA_API_URL ?? "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "MultiAgentDiscoveryBot/2.0 (free-tier research platform)";

interface WikiSearchResponse {
  query?: {
    search?: { title: string; snippet: string }[];
  };
}

/** Strip the `<span class="searchmatch">` markup Wikipedia returns in snippets. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Search Wikipedia and map results into the common `SearchResultItem` shape. */
export async function searchWikipedia(query: string, limit = 5): Promise<SearchResultItem[]> {
  const response = await withTimeout(
    axios.get<WikiSearchResponse>(API_URL, {
      params: {
        action: "query",
        list: "search",
        srsearch: query,
        format: "json",
        srlimit: limit,
        origin: "*",
      },
      timeout: WIKI_TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT },
    }),
    WIKI_TIMEOUT_MS,
    "wikipedia.search"
  );

  const results = response.data?.query?.search ?? [];
  logger.debug({ query, count: results.length }, "search.wikipedia.ok");

  return results.map((item) => ({
    title: item.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    description: stripHtml(item.snippet ?? ""),
    source: "wikipedia",
  }));
}

export default searchWikipedia;