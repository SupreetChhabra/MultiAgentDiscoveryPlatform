import { useState } from "react";

/**
 * TopicInput — text input, Run button, example chips and an optional manual
 * source-URL fallback (TDD §9.2, PRD §5).
 */

const EXAMPLES = [
  "Latest advances in retrieval-augmented generation",
  "How do solid-state batteries work?",
  "State of open-source LLMs",
  "CRISPR gene editing risks",
];

interface Props {
  onRun: (topic: string, urls: string[]) => void;
  running: boolean;
  onStop: () => void;
}

export function TopicInput({ onRun, running, onStop }: Props) {
  const [topic, setTopic] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [showUrls, setShowUrls] = useState(false);

  /** Parse one URL per line, keeping only well-formed http(s) URLs. */
  const parseUrls = (): string[] =>
    urlsText
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter((value) => /^https?:\/\//i.test(value))
      .slice(0, 5);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (running) return;
    onRun(topic, parseUrls());
  };

  const runExample = (example: string) => {
    setTopic(example);
    onRun(example, parseUrls());
  };

  return (
    <form className="card topic-input" onSubmit={submit}>
      <label className="panel-label" htmlFor="topic">
        🔎 Research Topic
      </label>
      <textarea
        id="topic"
        className="topic-textarea"
        placeholder="What should the agents research? e.g. 'Recent breakthroughs in protein folding'"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={3}
        maxLength={300}
        disabled={running}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
      />

      <button
        type="button"
        className="link-toggle"
        onClick={() => setShowUrls((value) => !value)}
        disabled={running}
      >
        {showUrls ? "▾" : "▸"} Optional: paste source URLs (fallback if search is rate-limited)
      </button>

      {showUrls && (
        <textarea
          className="topic-textarea url-textarea"
          placeholder={"https://example.com/article\nhttps://another-source.org/page"}
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={3}
          disabled={running}
        />
      )}

      <div className="topic-actions">
        {running ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            ■ Stop pipeline
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!topic.trim()}>
            ▶ Run Pipeline
          </button>
        )}
        <span className="topic-hint">Enter to run · Shift+Enter for a new line</span>
      </div>

      <div className="chips">
        <span className="chips-label">Try:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip"
            disabled={running}
            onClick={() => runExample(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </form>
  );
}

export default TopicInput;