import { PIPELINE_STEPS, type PipelineState } from "../types/pipeline";
import { StepCard } from "./StepCard";

/**
 * PipelinePanel — renders the four step cards from `state.steps` (TDD §9.2).
 */

interface Props {
  state: PipelineState | null;
  running: boolean;
  waking: boolean;
}

export function PipelinePanel({ state, running, waking }: Props) {
  const completed = PIPELINE_STEPS.filter(
    (descriptor) => state?.steps[descriptor.key]?.status === "done"
  ).length;

  return (
    <section className="card pipeline-panel">
      <div className="panel-label blue">
        ⚙️ Pipeline
        {state && (
          <span className="panel-counter">
            {completed}/{PIPELINE_STEPS.length}
          </span>
        )}
      </div>

      {waking && <div className="wake-banner">⏳ Waking up backend… (free-tier cold start)</div>}

      <div className="steps">
        {PIPELINE_STEPS.map((descriptor) => (
          <StepCard
            key={descriptor.key}
            num={descriptor.num}
            title={descriptor.title}
            desc={descriptor.desc}
            step={state?.steps[descriptor.key]}
          />
        ))}
      </div>

      {!state && !running && (
        <p className="pipeline-empty">Enter a topic and press <strong>Run Pipeline</strong> to begin.</p>
      )}
    </section>
  );
}

export default PipelinePanel;