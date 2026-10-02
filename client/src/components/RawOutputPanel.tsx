import DOMPurify from "dompurify";
import type { PipelineState } from "../types/pipeline";

/**
 * RawOutputPanel — collapsible `<details>` for search / reader / critic output
 * (TDD §9.2, FR-5.4). Rendered through DOMPurify for safety.
 */

interface Props {
  state: PipelineState;
}

const PANELS: { key: string; label: string }[] = [
  { key: "search", label: "🔍 Search raw output" },
  { key: "reader", label: "📄 Scraped content" },
  { key: "critic", label: "🧐 Critic feedback" },
];

export function RawOutputPanel({ state }: Props) {
  const available = PANELS.filter((panel) => Boolean(state.steps[panel.key]?.output));
  if (available.length === 0) return null;

  return (
    <section className="card raw-output-panel">
      <div className="panel-label green">🧾 Raw Intermediate Outputs</div>

      {available.map((panel) => {
        const step = state.steps[panel.key];
        const safe = DOMPurify.sanitize(step?.output ?? "");
        return (
          <details key={panel.key} className="raw-details">
            <summary>
              {panel.label}
              {step?.provider ? <span className="meta-tag">{step.provider}</span> : null}
            </summary>
            <pre className="raw-pre">{safe}</pre>
          </details>
        );
      })}
    </section>
  );
}

export default RawOutputPanel;