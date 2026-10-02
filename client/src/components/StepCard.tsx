import type { StepResult } from "../types/pipeline";

/**
 * StepCard — status badge, title, description and error (TDD §6.4).
 * Re-renders automatically when the SSE hook updates state.
 */

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  waiting: { label: "WAITING", className: "status-waiting" },
  running: { label: "● RUNNING", className: "status-running" },
  done: { label: "✓ DONE", className: "status-done" },
  error: { label: "✕ ERROR", className: "status-error" },
};

interface Props {
  num: string;
  title: string;
  step: StepResult | undefined;
  desc?: string;
}

export function StepCard({ num, title, step, desc }: Props) {
  const state = step?.status ?? "waiting";
  const { label, className } = STATUS_CONFIG[state] ?? STATUS_CONFIG.waiting;

  return (
    <div
      className={`step-card ${state === "running" ? "active" : ""} ${state === "done" ? "done" : ""} ${
        state === "error" ? "failed" : ""
      }`}
    >
      <div className="step-header">
        <span className="step-num">{num}</span>
        <span className="step-title">{title}</span>
        <span className={`step-status ${className}`}>{label}</span>
      </div>

      {desc && <div className="step-desc">{desc}</div>}

      <div className="step-meta">
        {step?.provider && <span className="meta-tag">provider: {step.provider}</span>}
        {step?.model && <span className="meta-tag">model: {step.model}</span>}
        {typeof step?.durationMs === "number" && (
          <span className="meta-tag">{(step.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>

      {step?.error && <div className="step-error">{step.error}</div>}
    </div>
  );
}

export default StepCard;