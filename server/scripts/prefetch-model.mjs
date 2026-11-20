// Downloads the embedding model during the build (Render), so the first start
// doesn't spend ~90 MB of download time. Cached in node_modules/@huggingface/transformers/.cache.
import { pipeline } from '@huggingface/transformers';

const model = process.env.EMBEDDING_MODEL?.trim() || 'Xenova/all-MiniLM-L6-v2';
const started = Date.now();
const extractor = await pipeline('feature-extraction', model, { dtype: 'fp32' });
const out = await extractor(['warm up'], { pooling: 'mean', normalize: true });
console.log(`[prefetch] ${model} ready (${out.dims.join('x')}) in ${Date.now() - started} ms`);
