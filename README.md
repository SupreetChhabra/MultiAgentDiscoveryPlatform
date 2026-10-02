# 🧭 Multi-Agent Discovery Platform

An open, extensible web platform where multiple specialized AI agents collaborate
to complete complex research and discovery tasks — running **entirely on free tiers**.

- **Frontend:** React 18 + Vite + TypeScript (deploy to Vercel / Netlify)
- **Backend:** Node.js 18+ + Express + TypeScript (deploy to Render / Railway)
- **LLM failover:** Groq → Cerebras → Gemini → Ollama (all OpenAI-compatible)
- **Search:** DuckDuckGo → Wikipedia keyless fallback (optional self-hosted SearXNG/Jiro)
- **Tools:** SSRF-guarded scraper, local in-process embeddings
- **Streaming:** Server-Sent Events (SSE) for live step status

> Constraint honored throughout: **zero monetary cost, no credit card, no paid APIs.**

---

## 📁 Project structure

```
multi-agent-discovery/
├── package.json            # Root — npm workspaces (client + server)
├── .env.example            # Environment template (all free tiers)
├── client/                 # React frontend (Vite + TS)
│   └── src/
│       ├── api/client.ts           # fetch wrappers + SSE helper
│       ├── components/             # TopicInput, StepCard, PipelinePanel, ...
│       ├── hooks/useResearchRun.ts # SSE consumer + state machine
│       ├── types/pipeline.ts
│       └── styles/globals.css
└── server/                 # Node.js backend (Express + TS)
    └── src/
        ├── index.ts                # Express app entrypoint
        ├── routes/                 # research.ts, runs.ts, agents.ts
        ├── orchestrator/           # pipeline.ts (async generator), runStore.ts
        ├── agents/                 # search/reader/writer/critic agents
        ├── llm/                    # router.ts (failover), providers.ts
        ├── tools/                  # search.ts, scrape.ts, embed.ts
        ├── registry/               # agents.json + discovery.ts (ChromaDB)
        ├── schemas/pipeline.ts     # Zod + TS types
        └── utils/logger.ts         # pino
```

---

## 🚀 Quick start (local, free)

### 1. Prerequisites
- **Node.js 18+** (LTS) — no native compilation required
- Optional: [Ollama](https://ollama.com/) for a fully offline, zero-key run

### 2. Install
```bash
npm install
```

### 3. Configure
```bash
copy .env.example server\.env      # Windows
# cp .env.example server/.env      # macOS / Linux
```
Add at least **one** free API key (Groq / Cerebras / Gemini). With no keys you can
still run fully locally via Ollama (`ollama pull llama3.2`).

### 4. Run both apps
```bash
npm run dev
```
- Frontend → http://localhost:5173
- Backend  → http://localhost:3001

### 5. Build & test
```bash
npm run build      # typecheck + bundle server and client
npm run test       # vitest (server: tools, router, pipeline)
```

---

## 🔌 API surface

| Method | Endpoint                    | Purpose                                              |
|--------|-----------------------------|------------------------------------------------------|
| POST   | `/api/research`             | Create a run from a `{ topic }`, returns `{ runId }` |
| GET    | `/api/runs/:id/stream`      | SSE stream of `step` / `done` / `error` events       |
| GET    | `/api/runs/:id/report`      | Final aggregated report (`?format=md\|json`)         |
| GET    | `/api/agents`               | List registered agent capabilities                   |
| POST   | `/api/discover`             | Best-matching agents for a task (embedding similarity)|
| GET    | `/healthz`                  | Liveness probe (used to warm the free-tier backend)  |

### Event stream shape
```
event: step
data: {"step":"search","state":{ ...PipelineState }}

event: done
data: {"state":{ ...PipelineState }}
```

---

## 🧠 How the pipeline works

1. **Search**   — `webSearch()` walks a keyless provider chain: **SearXNG/Jiro**
   (if `SEARCH_URL` is set) → **DuckDuckGo** (retried with backoff) → **Wikipedia**
   (MediaWiki API). No API key is ever required.
2. **Reader**   — scrapes candidate sources in order (user-supplied URLs first)
   with an SSRF-guarded, 3,000-char-capped fetcher until real content is found.
3. **Writer**   — LLM drafts a Markdown report (prefers Gemini; 1,500 RPD free).
4. **Critic**   — a *different* provider scores the report 1–10 and suggests fixes
   (prefers Cerebras, so rate limits never collide).

Every step is emitted over SSE as it transitions `waiting → running → done/error`,
including `provider`, `model` and `durationMs` for observability.

### Free-tier resilience features
- **LLM failover** — Groq → Cerebras → Gemini → Ollama, with in-memory per-provider
  daily-budget tracking.
- **Search fallback chain** — survives DuckDuckGo IP challenges automatically.
- **Manual source URLs** — paste URLs in the UI (or `urls: []` in `POST /api/research`)
  to bypass search entirely and read specific pages.
- **Partial results** — a failing agent returns an `error` field plus everything
  gathered so far, and a provenance-tagged fallback report is still downloadable.

---

## 🔐 Security & reliability

- Scraper **rejects private / loopback IPs** (SSRF guard via `ipaddr.js`).
- All LLM output is **sanitized with DOMPurify** before rendering.
- API keys live only in `.env` / platform secrets — never logged, never committed.
- CORS is restricted to `CLIENT_ORIGIN`.
- Provider **failover is automatic**; a failed agent returns a partial result
  with an `error` field instead of crashing the run.

---

## ☁️ Deployment (free)

- **Frontend → Vercel** (Hobby): root directory `client`, framework `Vite`,
  env `VITE_API_URL=https://your-backend.onrender.com`.
- **Backend → Render**: root directory `server`, build `npm install && npm run build`,
  start `node dist/index.js`, envs: `GROQ_API_KEY`, `CEREBRAS_API_KEY`,
  `GEMINI_API_KEY`, `CLIENT_ORIGIN`.

See `server/render.yaml` and `client/vercel.json` for ready-to-use config.

---

## 📜 Documents

- `Product Requirements Document.docx` / `prd.txt`
- `Technical Design Document.docx` / `tdd.txt`