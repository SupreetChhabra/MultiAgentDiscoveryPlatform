import { useResearchRun } from "./hooks/useResearchRun";
import { TopicInput } from "./components/TopicInput";
import { PipelinePanel } from "./components/PipelinePanel";
import { ReportPanel } from "./components/ReportPanel";
import { RawOutputPanel } from "./components/RawOutputPanel";
import { DownloadButtons } from "./components/DownloadButtons";
import { AgentDiscovery } from "./components/AgentDiscovery";

/**
 * App shell (TDD §9.1) — header, two-column layout and footer.
 */

export default function App() {
  const { state, runId, running, done, error, waking, start, stop, reset } = useResearchRun();

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🧭</span>
          <div>
            <h1>ResearchMind</h1>
            <p className="tagline">
              Multi-agent research discovery — running entirely on free tiers
            </p>
          </div>
        </div>
        {(done || error) && (
          <button type="button" className="btn btn-ghost" onClick={reset}>
            ↺ New run
          </button>
        )}
      </header>

      <main className="app-main">
        <div className="column column-left">
          <TopicInput onRun={start} running={running} onStop={stop} />

          {error && (
            <div className="card alert alert-error">
              <strong>Pipeline error:</strong> {error}
            </div>
          )}

          {waking && !error && (
            <div className="card alert alert-info">
              ⏳ The free-tier backend may be waking up. This can take up to ~30 seconds.
            </div>
          )}

          {state && <RawOutputPanel state={state} />}

          {state?.report && <ReportPanel markdown={state.report} topic={state.topic} />}

          {state?.report && <DownloadButtons state={state} runId={runId} />}

          <AgentDiscovery />
        </div>

        <div className="column column-right">
          <PipelinePanel state={state} running={running} waking={waking} />
        </div>
      </main>

      <footer className="app-footer">
        Powered by React + Node.js · Free-tier LLMs (Groq · Cerebras · Gemini · Ollama) · Built with
        SSE streaming
      </footer>
    </div>
  );
}