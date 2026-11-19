'use client';

// Shared Tatva UI: icon, toasts, confirm dialogs, "Coming soon" tag.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/tatva';

export function Icon({ name, className = '', filled = false }: { name: string; className?: string; filled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined select-none ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}

export function ComingSoon() {
  return (
    <span className="ml-1 inline-flex items-center rounded bg-surface-container-highest px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">
      Coming soon
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Icon name="progress_activity" className={`animate-spin ${className}`} />;
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-space-sm px-space-md py-space-xl text-center">
      <Icon name={icon} className="text-headline-lg text-on-surface-variant" />
      <p className="font-label-md text-label-md text-on-surface">{title}</p>
      {body && <p className="max-w-sm font-body-sm text-body-sm text-on-surface-variant">{body}</p>}
    </div>
  );
}

// ------------------------------------------------------------------- context

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

/** A Composio action the server previews (read-back) before the user confirms. */
export interface ActionRequest {
  kind: 'send_email' | 'post_to_slack' | 'create_calendar_event' | 'add_tracker_row' | 'log_issue';
  input: Record<string, unknown>;
  title: string;
  icon?: string;
  confirmLabel?: string;
  /** Optional form fields shown above the read-back (e.g. recipient). */
  fields?: (set: (patch: Record<string, unknown>) => void, input: Record<string, unknown>) => ReactNode;
  onDone?: (result: ActionResult) => void;
}
export interface ActionResult {
  ok: boolean;
  say: string;
  data?: unknown;
}

/** A plain confirm dialog for non-Composio work (or Composio work with its own endpoint). */
export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  icon?: string;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  run: () => Promise<string | void>;
}

interface TatvaUi {
  toast: (text: string, tone?: Tone) => void;
  runAction: (req: ActionRequest) => void;
  confirm: (req: ConfirmRequest) => void;
}

const Ctx = createContext<TatvaUi | null>(null);

export function useTatvaUi(): TatvaUi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTatvaUi must be used inside <TatvaUiProvider>');
  return ctx;
}

export function TatvaUiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [action, setAction] = useState<ActionRequest | null>(null);
  const [plain, setPlain] = useState<ConfirmRequest | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, tone: Tone = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 5000);
  }, []);

  const value = useMemo<TatvaUi>(() => ({ toast, runAction: setAction, confirm: setPlain }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {action && <ActionDialog request={action} onClose={() => setAction(null)} toast={toast} />}
      {plain && <PlainDialog request={plain} onClose={() => setPlain(null)} toast={toast} />}
      <div className="pointer-events-none fixed bottom-space-lg right-space-lg z-[70] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-space-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-space-sm rounded-xl bg-surface-container-high p-space-md shadow-[0_8px_32px_-4px_rgba(0,0,0,0.8)] ${
              t.tone === 'error' ? 'ring-1 ring-error/60' : t.tone === 'success' ? 'ring-1 ring-tertiary-fixed/40' : ''
            }`}
          >
            <Icon
              name={t.tone === 'error' ? 'error' : t.tone === 'success' ? 'check_circle' : 'info'}
              className={`text-body-lg ${t.tone === 'error' ? 'text-error' : t.tone === 'success' ? 'text-tertiary-fixed' : 'text-primary-container'}`}
            />
            <p className="font-body-md text-body-md text-on-surface">{t.text}</p>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------- dialogs

function DialogFrame({ title, icon, onClose, children }: { title: string; icon?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-space-md backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-lg flex-col gap-space-lg rounded-2xl bg-surface-container-low p-space-xl shadow-[0_24px_64px_rgba(0,0,0,0.85),0_0_32px_rgba(255,212,0,0.08)]">
        <div className="flex items-start justify-between gap-space-md">
          <div className="flex items-center gap-space-sm">
            {icon && <Icon name={icon} className="text-headline-sm text-primary-container" />}
            <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-bright hover:text-on-surface">
            <Icon name="close" className="text-headline-sm" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActionDialog({ request, onClose, toast }: { request: ActionRequest; onClose: () => void; toast: TatvaUi['toast'] }) {
  const [input, setInput] = useState(request.input);
  const [summary, setSummary] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Read-back from the server (same text Pooja speaks), refreshed when fields change.
  useEffect(() => {
    let live = true;
    setSummary(null);
    setPreviewError(null);
    api<{ summary: string }>('/actions/preview', { method: 'POST', json: { kind: request.kind, input } })
      .then((r) => live && setSummary(r.summary))
      .catch((e) => live && setPreviewError(e.message));
    return () => {
      live = false;
    };
  }, [request.kind, input]);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api<ActionResult>('/actions/execute', { method: 'POST', json: { kind: request.kind, input } });
      toast(result.say, 'success');
      request.onDone?.(result);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      request.onDone?.({ ok: false, say: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame title={request.title} icon={request.icon} onClose={onClose}>
      {request.fields && <div className="flex flex-col gap-space-md">{request.fields((patch) => setInput((i) => ({ ...i, ...patch })), input)}</div>}
      <div className="flex items-start gap-space-sm rounded-xl bg-surface-container-lowest p-space-md">
        <Icon name="record_voice_over" className="mt-0.5 text-body-lg text-primary-container" />
        <div className="flex flex-col gap-1">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary-container">Tatva will</span>
          {summary ? (
            <p className="font-body-md text-body-md text-on-surface">{summary.replace(/\s*(Should|Shall) I [^?]*\?$/, '')}</p>
          ) : previewError ? (
            <p className="font-body-md text-body-md text-error">{previewError}</p>
          ) : (
            <p className="flex items-center gap-2 font-body-md text-body-md text-on-surface-variant">
              <Spinner className="text-body-md" /> Preparing…
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-space-sm">
        <button type="button" onClick={onClose} className="rounded-xl bg-surface-container-high px-space-lg py-2.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-bright active:scale-[0.98]">
          Cancel
        </button>
        <button
          type="button"
          disabled={!summary || busy}
          onClick={confirm}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-space-xl py-2.5 font-label-md text-label-md font-bold text-on-primary shadow-[0_0_16px_rgba(255,212,0,0.35)] transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Spinner className="text-body-md" />}
          {request.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </DialogFrame>
  );
}

function PlainDialog({ request, onClose, toast }: { request: ConfirmRequest; onClose: () => void; toast: TatvaUi['toast'] }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const said = await request.run();
      if (said) toast(said, 'success');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogFrame title={request.title} icon={request.icon} onClose={onClose}>
      <div className="font-body-md text-body-md text-on-surface-variant">{request.body}</div>
      <div className="flex items-center justify-end gap-space-sm">
        <button type="button" onClick={onClose} className="rounded-xl bg-surface-container-high px-space-lg py-2.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-bright">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={run}
          className={`inline-flex items-center gap-2 rounded-xl px-space-xl py-2.5 font-label-md text-label-md font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
            request.tone === 'danger' ? 'bg-error-container text-on-error-container hover:bg-error hover:text-on-error' : 'bg-primary-container text-on-primary shadow-[0_0_16px_rgba(255,212,0,0.35)] hover:brightness-105'
          }`}
        >
          {busy && <Spinner className="text-body-md" />}
          {request.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </DialogFrame>
  );
}

// ---------------------------------------------------------------- form bits

export const inputClass =
  'w-full rounded-xl bg-surface-container-lowest px-space-md py-2.5 font-body-md text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 focus:bg-surface-container focus:ring-1 focus:ring-primary-container';

export function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between font-label-md text-label-md text-on-surface">
        <span>{label}</span>
        {note && <span className="font-caption text-caption uppercase tracking-wider text-on-surface-variant">{note}</span>}
      </span>
      {children}
    </label>
  );
}
