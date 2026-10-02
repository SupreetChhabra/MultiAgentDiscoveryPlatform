import { useEffect, useState } from "react";
import { API_URL } from "../api/client";

/**
 * AgentDiscovery — demonstrates FR-1 (agent registry + embedding-similarity
 * discovery) directly from the UI. Calls `GET /api/agents` and
 * `POST /api/discover`.
 */

interface AgentCapability {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  provider?: string;
}

interface DiscoverMatch {
  id: string;
  name: string;
  description: string;
  score: number;
}

export function AgentDiscovery() {
  const [agents, setAgents] = useState<AgentCapability[]>([]);
  const [task, setTask] = useState("");
  const [matches, setMatches] = useState<DiscoverMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/agents`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
      .then((body: { agents: AgentCapability[] }) => {
        if (!cancelled) setAgents(body.agents ?? []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const discover = async () => {
    if (!task.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, topK: 3 }),
      });
      if (!response.ok) throw new Error(`Discovery failed (${response.status})`);
      const body = (await response.json()) as { matches: DiscoverMatch[] };
      setMatches(body.matches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card discovery-panel">
      <div className="panel-label purple">
        🧩 Agent Discovery <span className="panel-counter">{agents.length} registered</span>
      </div>

      <div className="discover-row">
        <input
          className="discover-input"
          placeholder="Describe a task, e.g. 'review a report for accuracy'"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && discover()}
          maxLength={500}
        />
        <button type="button" className="btn btn-secondary" onClick={discover} disabled={busy || !task.trim()}>
          {busy ? "Matching…" : "Discover"}
        </button>
      </div>

      {error && <div className="step-error">{error}</div>}

      {matches && (
        <ul className="match-list">
          {matches.map((match) => (
            <li key={match.id} className="match-item">
              <div className="match-head">
                <span className="match-name">{match.name}</span>
                <span className="match-score">{(match.score * 100).toFixed(0)}%</span>
              </div>
              <p className="match-desc">{match.description}</p>
            </li>
          ))}
        </ul>
      )}

      {!matches && agents.length > 0 && (
        <div className="agent-tags">
          {agents.map((agent) => (
            <span key={agent.id} className="agent-tag" title={agent.description}>
              {agent.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export default AgentDiscovery;