'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { TatvaMark, TatvaWordmark } from '@/components/tatva/brand';
import { Icon, inputClass, Spinner } from '@/components/tatva/ui';

/** Only same-site paths, so ?next= can't send people elsewhere. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export default function LoginForm() {
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Sign-in failed (${res.status}).`);
      // Full navigation so every server-rendered page sees the new cookie.
      window.location.assign(safeNext(params.get('next')));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-space-md">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-space-lg rounded-2xl border border-hairline bg-surface-container-low p-space-xl shadow-2xl">
        <div className="flex flex-col items-center gap-space-md text-center">
          <TatvaMark className="h-14 w-14" />
          <TatvaWordmark className="h-4 w-auto text-on-surface" />
          <h1 className="sr-only">Sign in to Tatva</h1>
          <p className="text-body-sm text-on-surface-variant">Voice-first meeting assistant. Enter the access code to continue.</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-label-md text-on-surface">Access code</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
            aria-invalid={!!error}
          />
        </label>
        {error && (
          <p role="alert" className="flex items-center gap-2 text-body-sm text-error">
            <Icon name="error" className="text-body-md" />
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !code.trim()} aria-busy={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-container py-2.5 text-label-md font-semibold text-on-primary hover:bg-primary-fixed active:scale-[0.98] disabled:opacity-50">
          {busy && <Spinner className="text-body-md" />}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
