import { useEffect, useState } from "react";
import { API_URL, getReportMeta } from "../api/client";
import type { PipelineState, ReportMeta } from "../types/pipeline";

/**
 * DownloadButtons — export the run as `.md` and `.json` (TDD §9.2, FR-5.2).
 *
 * The Markdown itself is generated locally from the live SSE state so it works
 * even if the free-tier backend has gone to sleep. Canonical server URLs are
 * also fetched (and shown) when the run metadata is available.
 */

interface Props {
  state: PipelineState;
  runId?: string | null;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Slugify the topic for a friendly file name. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}

export function DownloadButtons({ state, runId }: Props) {
  const [meta, setMeta] = useState<(ReportMeta & { mdUrl: string; jsonUrl: string }) | null>(null);
  const slug = slugify(state.topic);

  useEffect(() => {
    let cancelled = false;
    if (!runId) {
      setMeta(null);
      return;
    }
    getReportMeta(runId)
      .then((value) => {
        if (!cancelled) setMeta(value);
      })
      .catch(() => {
        /* server may be asleep — local download still works */
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const markdown = state.report ?? "";
  const jsonPayload = JSON.stringify(
    {
      runId: runId ?? undefined,
      topic: state.topic,
      generatedAt: meta?.generatedAt ?? new Date().toISOString(),
      markdown,
      sections: meta?.sections ?? [],
      steps: state.steps,
    },
    null,
    2
  );

  return (
    <div className="card download-card">
      <div className="panel-label green">⬇️ Export</div>

      <div className="download-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!markdown}
          onClick={() => download(`${slug}.md`, markdown, "text/markdown;charset=utf-8")}
        >
          ⬇ Download .md
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!markdown}
          onClick={() => download(`${slug}.json`, jsonPayload, "application/json")}
        >
          ⬇ Download .json
        </button>
      </div>

      {meta && markdown && (
        <p className="download-hint">
          Provenance recorded for {meta.sections.length} agent output
          {meta.sections.length === 1 ? "" : "s"}. Server copies:{" "}
          <a href={meta.mdUrl} target="_blank" rel="noreferrer">
            .md
          </a>{" "}
          ·{" "}
          <a href={meta.jsonUrl} target="_blank" rel="noreferrer">
            .json
          </a>
        </p>
      )}

      {!runId && <p className="download-hint">API: {API_URL}</p>}
    </div>
  );
}

export default DownloadButtons;