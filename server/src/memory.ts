import v8 from 'node:v8';
import vm from 'node:vm';

// Memory helpers for the 512 MB Render instance. V8 sizes its heap from the
// host's memory, not the container's, so without help it lets garbage pile up
// until the container is killed. The pipeline frees memory between steps.

export const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

// `node --expose-gc` gives a global gc(). Render's start command lives in its
// dashboard (it may not carry the flag), so fall back to enabling it at runtime.
function getGc(): (() => void) | null {
  const global = (globalThis as { gc?: () => void }).gc;
  if (typeof global === 'function') return global;
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc') as () => void;
  } catch {
    return null;
  }
}
const gc = getGc();

/** Runs a full GC (between pipeline steps and after each job). */
export function freeMemory(): void {
  gc?.();
}

/** True when a full GC can be triggered (reported on /health). */
export const canFreeMemory = () => gc !== null;
