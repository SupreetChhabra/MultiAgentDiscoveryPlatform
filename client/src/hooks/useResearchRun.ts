import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createRun, streamUrl } from "../api/client";
import type { PipelineState } from "../types/pipeline";

/**
 * SSE consumer + pipeline state machine (TDD §6.3).
 *
 * React re-renders automatically whenever `setState` is called after a `step`
 * event, so the step cards animate `waiting → running → done` with no manual
 * refresh. Transport failures auto-reconnect with **exponential backoff**
 * (PRD §3.2).
 */

interface StepPayload {
  step: string;
  state: PipelineState;
}
interface DonePayload {
  state: PipelineState;
}
interface ErrorPayload {
  message: string;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;

export interface UseResearchRun {
  state: PipelineState | null;
  runId: string | null;
  running: boolean;
  done: boolean;
  error: string | null;
  waking: boolean;
  start: (topic: string, urls?: string[]) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useResearchRun(): UseResearchRun {
  const [state, setState] = useState<PipelineState | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const runIdRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const cleanup = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const subscribe = useCallback((runId: string) => {
    const es = new EventSource(streamUrl(runId));
    eventSourceRef.current = es;

    es.addEventListener("step", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as StepPayload;
      setState(payload.state);
      setWaking(false);
      retriesRef.current = 0;
    });

    es.addEventListener("done", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as DonePayload;
      setState(payload.state);
      setRunning(false);
      setDone(true);
      setWaking(false);
      es.close();
      eventSourceRef.current = null;
    });

    es.addEventListener("error", (event) => {
      // A server-sent `event: error` carries data; a transport failure does not.
      const data = (event as MessageEvent).data as string | undefined;
      if (data) {
        try {
          const payload = JSON.parse(data) as ErrorPayload;
          setError(payload.message);
          setRunning(false);
          setWaking(false);
          es.close();
          eventSourceRef.current = null;
          return;
        } catch {
          /* fall through to transport handling */
        }
      }

      es.close();
      eventSourceRef.current = null;

      if (retriesRef.current >= MAX_RETRIES) {
        setError("Lost connection to the backend stream. Please try again.");
        setRunning(false);
        setWaking(false);
        return;
      }

      const delay = BASE_DELAY_MS * 2 ** retriesRef.current;
      retriesRef.current += 1;
      setWaking(true);
      const timer = window.setTimeout(() => {
        if (runIdRef.current) subscribe(runIdRef.current);
      }, delay);
      timersRef.current.push(timer);
    });
  }, []);

  const start = useCallback(
    async (topic: string, urls: string[] = []) => {
      cleanup();
      retriesRef.current = 0;
      setState(null);
      setRunId(null);
      setError(null);
      setDone(false);
      setRunning(true);

      const trimmed = topic.trim();
      if (!trimmed) {
        setError("Please enter a topic to research.");
        setRunning(false);
        return;
      }

      try {
        const { runId: newRunId } = await createRun(trimmed, urls);
        runIdRef.current = newRunId;
        setRunId(newRunId);
        setState({ topic: trimmed, urls, steps: {} });
        subscribe(newRunId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to start the pipeline.");
        setRunning(false);
      }
    },
    [cleanup, subscribe]
  );

  const stop = useCallback(() => {
    cleanup();
    runIdRef.current = null;
    setRunning(false);
    setWaking(false);
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    runIdRef.current = null;
    retriesRef.current = 0;
    setState(null);
    setRunId(null);
    setError(null);
    setDone(false);
    setRunning(false);
    setWaking(false);
  }, [cleanup]);

  // Close the stream if the component unmounts mid-run.
  useEffect(() => cleanup, [cleanup]);

  return { state, runId, running, done, error, waking, start, stop, reset };
}

export default useResearchRun;