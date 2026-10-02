import ReactMarkdown from "react-markdown";
import { useMemo } from "react";
import DOMPurify from "dompurify";

/**
 * ReportPanel — renders the final report as **sanitized** Markdown (TDD §9.3).
 *
 * `react-markdown` does not render raw HTML by default; DOMPurify adds a second
 * layer of defense over the LLM output before it reaches the DOM (PRD §3.3).
 */

interface Props {
  markdown: string;
  topic?: string;
}

export function ReportPanel({ markdown }: Props) {
  const safe = useMemo(
    () => DOMPurify.sanitize(markdown, { USE_PROFILES: { html: true } }),
    [markdown]
  );

  return (
    <section className="card report-panel">
      <div className="panel-label orange">📝 Final Research Report</div>
      <article className="report-body">
        <ReactMarkdown>{safe}</ReactMarkdown>
      </article>
    </section>
  );
}

export default ReportPanel;