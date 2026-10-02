import type { PipelineState, Report, ReportMeta } from "../types/pipeline";

/**
 * Thin fetch/SSE wrapper around the backend (TDD §6.2).
 *
 * `VITE_API_URL` points at the Render backend in production and at
 * `http://localhost:3001` locally.
 */

export const API_URL: string = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  ""
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      "Cannot reach the backend. It may be waking up from a free-tier cold start — retrying…",
      0
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

/** POST /api/research → { runId } */
export function createRun(topic: string, urls: string[] = []): Promise<{ runId: string }> {
  return request<{ runId: string }>("/api/research", {
    method: "POST",
    body: JSON.stringify({ topic, urls }),
  });
}

/** GET /api/runs/:id → run snapshot */
export function getRun(id: string): Promise<{ id: string; state: PipelineState; status: string }> {
  return request(`/api/runs/${id}`);
}

/** GET /api/runs/:id/report?format=json */
export function getReport(id: string): Promise<Report> {
  return request<Report>(`/api/runs/${id}/report?format=json`);
}

/** GET /api/runs/:id/report?meta=1 — provenance metadata + canonical file URLs. */
export function getReportMeta(id: string): Promise<ReportMeta & { mdUrl: string; jsonUrl: string }> {
  return request<ReportMeta & { mdUrl: string; jsonUrl: string }>(
    `/api/runs/${id}/report?meta=1`
  ).then((meta) => ({
    ...meta,
    mdUrl: `${API_URL}/api/runs/${id}/report`,
    jsonUrl: `${API_URL}/api/runs/${id}/report?format=json`,
  }));
}

/** URL for the SSE stream consumed by `useResearchRun`. */
export function streamUrl(runId: string): string {
  return `${API_URL}/api/runs/${runId}/stream`;
}

/** Cheap liveness probe — used to show the "waking up backend" indicator. */
export async function ping(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}