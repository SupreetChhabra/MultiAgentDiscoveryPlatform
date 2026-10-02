import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the keyless search providers so no network call is made.
vi.mock("duck-duck-scrape", () => ({
  SafeSearchType: { MODERATE: "moderate" },
  search: vi.fn(),
}));
vi.mock("../src/tools/wikipedia.js", () => ({
  searchWikipedia: vi.fn(),
  default: vi.fn(),
}));

import { search } from "duck-duck-scrape";
import { extractText, isSafeUrl } from "../src/tools/scrape.js";
import { webSearch, webSearchRaw } from "../src/tools/search.js";
import { searchWikipedia } from "../src/tools/wikipedia.js";
import { extractAllUrls, pickFirstUrl } from "../src/agents/readerAgent.js";
import { buildSearchQuery } from "../src/agents/searchAgent.js";

describe("scrape — SSRF guard (PRD §3.3)", () => {
  it("allows public http(s) URLs", () => {
    expect(isSafeUrl("https://example.com/article")).toBe(true);
    expect(isSafeUrl("http://93.184.216.34/")).toBe(true);
  });

  it("blocks private, loopback, link-local and internal hosts", () => {
    const blocked = [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://0.0.0.0/",
      "http://metadata.google.internal/",
      "http://foo.internal/",
      "http://db.local/",
    ];
    for (const url of blocked) {
      expect(isSafeUrl(url), url).toBe(false);
    }
  });

  it("blocks non-http protocols and malformed URLs", () => {
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("ftp://example.com")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
});

describe("scrape — text extraction", () => {
  it("strips scripts, styles and navigation", () => {
    const html =
      "<html><head><style>.a{}</style><script>alert(1)</script></head>" +
      "<body><nav>nav</nav><p>Hello world</p><footer>foot</footer></body></html>";
    expect(extractText(html)).toBe("Hello world");
  });

  it("caps extracted text at 3000 characters (PRD §5)", () => {
    const html = `<body>${"a".repeat(5000)}</body>`;
    expect(extractText(html).length).toBe(3000);
  });
});

describe("search tool (TDD §4.1, PRD §5)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("formats results with title, URL and snippet", async () => {
    vi.mocked(search).mockResolvedValue({
      results: [{ title: "T", url: "https://x.com", description: "D" }],
    } as unknown as Awaited<ReturnType<typeof search>>);

    const items = await webSearchRaw("topic");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "T",
      url: "https://x.com",
      description: "D",
      source: "duckduckgo",
    });

    const text = await webSearch("topic");
    expect(text).toContain("Title: T");
    expect(text).toContain("URL: https://x.com");
    expect(text).toContain("source: duckduckgo");
  });

  it("falls back to Wikipedia when DuckDuckGo is blocked", async () => {
    vi.mocked(search).mockRejectedValue(new Error("DDG anomaly"));
    vi.mocked(searchWikipedia).mockResolvedValue([
      { title: "Green tea", url: "https://en.wikipedia.org/wiki/Green_tea", description: "x", source: "wikipedia" },
    ]);

    const items = await webSearchRaw("green tea");
    expect(items[0]?.source).toBe("wikipedia");
    expect(searchWikipedia).toHaveBeenCalledOnce();
  });

  it("returns an error string instead of throwing when every provider fails", async () => {
    vi.mocked(search).mockRejectedValue(new Error("boom"));
    vi.mocked(searchWikipedia).mockRejectedValue(new Error("wiki down"));

    await expect(webSearch("topic")).resolves.toContain("Search failed:");
  });
});

describe("search agent — query building (PRD §5)", () => {
  it("strips instruction prefixes and trailing question marks", () => {
    expect(buildSearchQuery("state of open-source LLMs")).toBe("state of open-source LLMs");
    expect(buildSearchQuery("research solid state batteries")).toBe("solid state batteries");
    expect(buildSearchQuery("How do solid-state batteries work?")).toBe(
      "How do solid-state batteries work"
    );
    expect(buildSearchQuery("   ")).toBe("");
  });
});

describe("reader — URL extraction (PRD §5)", () => {
  const output = [
    "Title: A\nURL: https://a.com/1\nSnippet: one",
    "Title: B\nURL: https://b.com/2\nSnippet: two",
    "Title: C\nURL: https://c.com/3\nSnippet: three",
    "Title: A again\nURL: https://a.com/1\nSnippet: dup",
  ].join("\n----\n");

  it("picks the first URL", () => {
    expect(pickFirstUrl(output)).toBe("https://a.com/1");
    expect(pickFirstUrl("no urls here")).toBeNull();
  });

  it("extracts distinct URLs in order, capped by the limit", () => {
    expect(extractAllUrls(output)).toEqual([
      "https://a.com/1",
      "https://b.com/2",
      "https://c.com/3",
    ]);
    expect(extractAllUrls(output, 2)).toEqual(["https://a.com/1", "https://b.com/2"]);
  });
});