import { pipeline } from "@xenova/transformers";
import { logger } from "../utils/logger.js";

/**
 * Local, free embeddings (TDD §5.1).
 *
 * Runs `all-MiniLM-L6-v2` in-process via @xenova/transformers (ONNX runtime,
 * CPU-friendly, no API key). The ~80 MB model is downloaded once and cached.
 */

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>;

let embedder: FeatureExtractionPipeline | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    logger.info({ model: EMBEDDING_MODEL }, "embed.model.loading");
    embedder = (await pipeline("feature-extraction", EMBEDDING_MODEL)) as unknown as FeatureExtractionPipeline;
    logger.info({ model: EMBEDDING_MODEL }, "embed.model.ready");
  }
  return embedder;
}

/** Embed a single string into a normalised mean-pooled vector. */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Embed many strings sequentially (keeps memory low on the free tier). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (const text of texts) {
    vectors.push(await embed(text));
  }
  return vectors;
}

export default embed;