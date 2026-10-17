import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { env, pipeline } from '@huggingface/transformers';

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MODEL_REVISION = '6fa4bf687ce79106377b66d10009c0e513715e24';
const defaultCache = fileURLToPath(new URL('../.cache/models/', import.meta.url));
export const MODEL_CACHE_DIR = path.resolve(process.env.SECONDLOOK_MODEL_CACHE || defaultCache);
env.cacheDir = MODEL_CACHE_DIR;
env.useFSCache = true;
env.useBrowserCache = false;
const offline = process.env.SECONDLOOK_OFFLINE === '1';
env.allowLocalModels = offline;
env.localModelPath = path.join(MODEL_CACHE_DIR, 'local-models');
env.allowRemoteModels = !offline;

let extractorPromise;
let state = 'cold';
let progress = null;
let failure = null;

export function modelStatus() {
  return {
    id: MODEL_ID, revision: MODEL_REVISION, state, progress,
    engine: 'Transformers.js / ONNX Runtime / CPU', dtype: 'q8',
    inference: 'local', dimensions: 384, offline: !env.allowRemoteModels,
    ...(failure ? { error: failure } : {}),
  };
}

export async function getExtractor() {
  if (!extractorPromise) {
    state = 'loading'; failure = null;
    extractorPromise = (async () => {
      await mkdir(MODEL_CACHE_DIR, { recursive: true });
      const extractor = await pipeline('feature-extraction', MODEL_ID, {
        revision: MODEL_REVISION, dtype: 'q8', device: 'cpu', cache_dir: MODEL_CACHE_DIR,
        local_files_only: offline,
        progress_callback: (event) => {
          if (event.status === 'progress') progress = { file: path.basename(event.file || ''), percent: Math.round(event.progress || 0) };
          else if (event.status === 'ready') progress = null;
        },
      });
      state = 'ready'; progress = null;
      return extractor;
    })().catch((error) => {
      state = 'error'; progress = null;
      failure = 'The open model could not be loaded. Check the first-download connection or the local model cache.';
      extractorPromise = undefined;
      throw new Error(failure, { cause: error });
    });
  }
  return extractorPromise;
}

export async function embedDescriptions(descriptions) {
  const extractor = await getExtractor();
  const vectors = [];
  // Small batches cap CPU/native memory without exporting text anywhere.
  for (let start = 0; start < descriptions.length; start += 16) {
    const tensor = await extractor(descriptions.slice(start, start + 16), { pooling: 'mean', normalize: true });
    const batch = tensor.tolist();
    for (const vector of batch) {
      if (vector.length !== 384 || vector.some((number) => !Number.isFinite(number))) throw new Error('The model returned an invalid embedding.');
      vectors.push(vector);
    }
    tensor.dispose?.();
  }
  return vectors;
}
