'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/tatva';

/**
 * Loads a Tatva API path; refreshes every `refreshMs` (when set) and on
 * `reload()`. Keeps the last good data while refreshing.
 */
export function useApi<T>(path: string | null, opts: { refreshMs?: number | ((data: T | null) => number | undefined) } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const dataRef = useRef<T | null>(null);
  const refreshRef = useRef(opts.refreshMs);
  refreshRef.current = opts.refreshMs;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const next = await api<T>(path);
      dataRef.current = next;
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await load();
      if (stopped) return;
      const r = refreshRef.current;
      const ms = typeof r === 'function' ? r(dataRef.current) : r;
      if (ms) timer = setTimeout(tick, ms);
    };
    setLoading(true);
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [path, load]);

  return { data, error, loading, reload: load, setData };
}
