import fs from "node:fs";
import path from "node:path";
import { embed } from "../tools/embed.js";
import { logger } from "../utils/logger.js";
import {
  AgentRegistrySchema,
  type AgentCapability,
  type AgentRegistry,
} from "../schemas/pipeline.js";

/**
 * Agent registry + discovery (TDD §5.2 / FR-1).
 *
 * - `loadRegistry()` reads one or more registry files, validates them with Zod
 *   (FR-1.4) and merges them (**federated mode**, FR-1.5).
 * - `discoverAgents()` ranks agents against a task description by **embedding
 *   similarity** (FR-1.3).
 *
 * Two interchangeable backends are supported:
 *  1. a **local in-process cosine index** (default) - zero setup, truly embedded;
 *  2. **ChromaDB** when `CHROMA_URL` is set and reachable.
 * Both use the same free `@xenova/transformers` embeddings.
 */

const DEFAULT_REGISTRY_CANDIDATES = [
  path.join("src", "registry", "agents.json"),
  path.join("dist", "registry", "agents.json"),
  path.join("registry", "agents.json"),
];

const COLLECTION_NAME = "agent_capabilities";

/** Resolve the registry file(s) to load (comma-separated env = federated). */
export function resolveRegistryPaths(): string[] {
  const fromEnv = process.env.REGISTRY_PATH?.trim();
  const candidates = fromEnv
    ? fromEnv.split(",").map((p) => p.trim()).filter(Boolean)
    : DEFAULT_REGISTRY_CANDIDATES.map((rel) => path.resolve(process.cwd(), rel));

  const existing = candidates.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
  if (existing.length === 0) {
    throw new Error(`No agent registry file found. Looked in: ${candidates.join(", ")}`);
  }
  return existing;
}

/** Load, validate and merge the agent capability registry. */
export function loadRegistry(): AgentRegistry {
  const files = resolveRegistryPaths();
  const byId = new Map<string, AgentCapability>();
  let version: string | undefined;

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = AgentRegistrySchema.parse(JSON.parse(raw)); // FR-1.4 integrity check
    version ??= parsed.version;
    for (const agent of parsed.agents) {
      byId.set(agent.id, agent);
    }
    logger.debug({ file, agents: parsed.agents.length }, "registry.loaded");
  }

  return { version, agents: [...byId.values()] };
}

export interface DiscoverMatch {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  score: number;
}

/** Text used to embed an agent for similarity matching. */
function agentDocument(agent: AgentCapability): string {
  return [agent.name, agent.description, ...agent.capabilities, ...agent.tools].join(". ");
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Cached local index - rebuilt only when the set of agent ids changes. */
let localIndex: { signature: string; agents: AgentCapability[]; vectors: number[][] } | null = null;

async function getLocalIndex() {
  const agents = loadRegistry().agents;
  const signature = agents.map((a) => a.id).join("|");
  if (!localIndex || localIndex.signature !== signature) {
    const vectors: number[][] = [];
    for (const agent of agents) {
      vectors.push(await embed(agentDocument(agent)));
    }
    localIndex = { signature, agents, vectors };
  }
  return localIndex;
}

/** Reset the cached index (used by tests and after registry changes). */
export function resetDiscoveryCache(): void {
  localIndex = null;
  chromaCollection = null;
}

/** Embedding-similarity discovery against the in-process index. */
export async function discoverAgentsLocal(
  taskDescription: string,
  topK = 3
): Promise<DiscoverMatch[]> {
  const { agents, vectors } = await getLocalIndex();
  const queryVector = await embed(taskDescription);

  const scored = agents.map((agent, i) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
    score: cosine(queryVector, vectors[i] ?? []),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topK));
}

/* ── Optional ChromaDB backend ───────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chromaCollection: any = null;

async function getChromaCollection() {
  if (chromaCollection) return chromaCollection;

  const { ChromaClient } = await import("chromadb");
  const client = new ChromaClient({ path: process.env.CHROMA_URL ?? "http://localhost:8000" });
  const collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { "hnsw:space": "cosine" },
  });

  const agents = loadRegistry().agents;
  for (const agent of agents) {
    const document = agentDocument(agent);
    await collection.upsert({
      ids: [agent.id],
      embeddings: [await embed(document)],
      documents: [document],
      metadatas: [{ name: agent.name, description: agent.description }],
    });
  }

  chromaCollection = collection;
  logger.info({ agents: agents.length }, "discovery.chroma.ready");
  return collection;
}

/** Register agents into ChromaDB explicitly (TDD §5.2). */
export async function registerAgents(agents: { id: string; description: string }[]): Promise<void> {
  const collection = await getChromaCollection();
  for (const agent of agents) {
    await collection.upsert({
      ids: [agent.id],
      embeddings: [await embed(agent.description)],
      documents: [agent.description],
    });
  }
}

/**
 * Discover the best-matching agents for a task.
 *
 * Uses ChromaDB when `CHROMA_URL` is configured, otherwise (or on any Chroma
 * failure) the local embedding index. Never throws for an empty result.
 */
export async function discoverAgents(
  taskDescription: string,
  topK = 3
): Promise<{ backend: string; matches: DiscoverMatch[] }> {
  if (process.env.CHROMA_URL) {
    try {
      const collection = await getChromaCollection();
      const queryVector = await embed(taskDescription);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await collection.query({
        queryEmbeddings: [queryVector],
        nResults: Math.max(1, topK),
      });

      const ids: string[] = result.ids?.[0] ?? [];
      const distances: number[] = result.distances?.[0] ?? [];
      const agents = loadRegistry().agents;

      const matches: DiscoverMatch[] = ids.map((id, i) => {
        const agent = agents.find((a) => a.id === id);
        return {
          id,
          name: agent?.name ?? id,
          description: agent?.description ?? "",
          capabilities: agent?.capabilities ?? [],
          score: 1 - (distances[i] ?? 0),
        };
      });

      return { backend: "chromadb", matches };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message }, "discovery.chroma.failed_fallback_local");
    }
  }

  const matches = await discoverAgentsLocal(taskDescription, topK);
  return { backend: "local-embeddings", matches };
}

export default discoverAgents;