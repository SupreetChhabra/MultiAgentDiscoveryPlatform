import { webSearch } from "../tools/search.js";

/**
 * SearchAgent (TDD §7.1).
 *
 * Provider: DuckDuckGo tool (keyless). The LLM-facing system prompt is kept here
 * so the agent can be upgraded to LLM-driven tool-calling without touching the
 * orchestrator.
 */

export const SEARCH_AGENT_ID = "search-agent";
export const SEARCH_SYSTEM_PROMPT =
  "You are a research search specialist. Use the web search tool to find recent, " +
  "reliable sources. Return a structured list of findings with URLs.";

export interface SearchAgentResult {
  query: string;
  output: string;
  provider: string;
}

/** Build the search query for a topic.
 *
 * Kept **concise** on purpose: the verbose "find recent, reliable…" framing is
 * only useful for the LLM prompt, while search backends (DuckDuckGo, Wikipedia)
 * return much better matches for a plain topical query (PRD §5 — "search results
 * low quality").
 */
export function buildSearchQuery(topic: string): string {
  const cleaned = topic
    .replace(/^(find|search for|look up|tell me about|information about|research)\s+/i, "")
    .replace(/\?+\s*$/, "")
    .trim();
  return cleaned || topic.trim();
}

/** Run the search tool and return formatted findings (never throws). */
export async function runSearchAgent(topic: string): Promise<SearchAgentResult> {
  const query = buildSearchQuery(topic);
  const output = await webSearch(query);
  return { query, output, provider: "duckduckgo" };
}