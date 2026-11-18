import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config, EMBEDDING_DIMS } from '../config.js';

// Local embeddings with transformers.js (no API key). The model (~90 MB) is
// downloaded from Hugging Face on first use and cached on disk.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline('feature-extraction', config.embeddingModel, { dtype: 'fp32' }) as Promise<FeatureExtractionPipeline>;
  extractorPromise.catch(() => {
    extractorPromise = null;
  });
  return extractorPromise;
}

/** Loads the model ahead of the first request (optional). */
export async function warmUpEmbeddings(): Promise<void> {
  await getExtractor();
}

/** Returns one normalized 384-dim vector per input text. */
export async function embed(texts: string[], batchSize = 32): Promise<number[][]> {
  const extractor = await getExtractor();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const output = await extractor(texts.slice(i, i + batchSize), { pooling: 'mean', normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMS) {
      throw new Error(`Embedding model returned ${vector.length} dims, expected ${EMBEDDING_DIMS}.`);
    }
  }
  return vectors;
}
