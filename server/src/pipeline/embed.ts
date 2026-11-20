import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config, EMBEDDING_DIMS } from '../config.js';

// Local embeddings with transformers.js (no API key). The model (~90 MB) is
// downloaded from Hugging Face on first use and cached on disk.
//
// Memory: the server runs on a 512 MB instance. Attention memory grows with
// batch size x sequence length², so a batch of 32 transcript windows added
// ~180 MB on top of the model and pushed a 6-minute meeting out of memory.
// Small batches plus no ONNX memory arena (which otherwise keeps the largest
// batch's buffers forever) keep indexing nearly flat for any meeting length.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export const EMBED_BATCH_SIZE = Math.max(1, Number(process.env.EMBED_BATCH_SIZE) || 4);

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline('feature-extraction', config.embeddingModel, {
    dtype: 'fp32',
    session_options: { enableCpuMemArena: false, enableMemPattern: false, intraOpNumThreads: 1, interOpNumThreads: 1 },
  }) as Promise<FeatureExtractionPipeline>;
  extractorPromise.catch(() => {
    extractorPromise = null;
  });
  return extractorPromise;
}

/** Loads the model ahead of the first request (optional). */
export async function warmUpEmbeddings(): Promise<void> {
  await getExtractor();
}

/** Returns one normalized 384-dim vector per input text, embedding a few at a time. */
export async function embed(texts: string[], batchSize = EMBED_BATCH_SIZE): Promise<number[][]> {
  const extractor = await getExtractor();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const output = await extractor(texts.slice(i, i + batchSize), { pooling: 'mean', normalize: true });
    vectors.push(...(output.tolist() as number[][]));
    output.dispose?.(); // free the native tensor now, not at the next GC
  }
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMS) {
      throw new Error(`Embedding model returned ${vector.length} dims, expected ${EMBEDDING_DIMS}.`);
    }
  }
  return vectors;
}
