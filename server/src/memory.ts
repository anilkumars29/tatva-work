// Memory helpers for the 512 MB Render instance. The server starts with
// --expose-gc --max-old-space-size (render.yaml), so V8 collects before the
// container limit instead of sizing its heap from the host's memory.

export const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

/** Runs a full GC when the server was started with --expose-gc (between pipeline steps). */
export function freeMemory(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

/** True when the process was started with --expose-gc (reported on /health). */
export const canFreeMemory = () => typeof (globalThis as { gc?: unknown }).gc === 'function';
