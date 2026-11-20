'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/tatva';
import { TatvaLockup } from './brand';
import { Avatar, AVATAR_COLORS, ProfileProvider, useProfile, type Profile } from './profile';
import { DialogFrame, Field, Icon, inputClass, Spinner, TatvaUiProvider, useTatvaUi } from './ui';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'grid_view' },
  { href: '/meetings', label: 'Meetings', icon: 'calendar_today' },
  { href: '/talk', label: 'Talk to Tatva', icon: 'graphic_eq' },
  { href: '/knowledge', label: 'Knowledge Base', icon: 'dataset' },
  { href: '/tracker', label: 'Tracker', icon: 'check_box' },
  { href: '/contacts', label: 'Contacts', icon: 'group' },
];

/** The version this repo's extension/ folder is at; older installs are asked to reload. */
const EXTENSION_VERSION = '0.5.0';

const CONNECTIONS: { key: string; label: string; icon: string }[] = [
  { key: 'gmail', label: 'Gmail', icon: 'mail' },
  { key: 'googlecalendar', label: 'Google Calendar', icon: 'event' },
  { key: 'slack', label: 'Slack', icon: 'tag' },
  { key: 'googlesheets', label: 'Google Sheets', icon: 'table_chart' },
  { key: 'googledocs', label: 'Google Docs', icon: 'description' },
  { key: 'googledrive', label: 'Google Drive', icon: 'folder' },
];

/**
 * Detects the Tatva Recorder extension. Its content script (extension/page-marker.js)
 * marks <html data-tatva-extension="x.y.z"> and, from 0.4.0, answers a
 * window "tatva:extension-ping". Re-checked whenever the tab regains focus.
 * undefined = still checking, null = not detected.
 */
function useExtensionVersion(): string | null | undefined {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let found: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fromDom = () => document.documentElement.dataset.tatvaExtension ?? null;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.data?.type !== 'tatva:extension-pong') return;
      found = String(event.data.version);
      setVersion(found);
    };
    const check = (waitMs: number) => {
      found = fromDom();
      if (found) setVersion(found);
      window.postMessage({ type: 'tatva:extension-ping' }, window.location.origin);
      clearTimeout(timer);
      timer = setTimeout(() => setVersion(found ?? fromDom()), waitMs);
    };
    const onFocus = () => check(800);
    const onVisible = () => document.visibilityState === 'visible' && check(800);
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    check(2500);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return version;
}

const isOlder = (v: string, than: string) => {
  const a = v.split('.').map(Number);
  const b = than.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};

function ExtensionCard({ version }: { version: string | null | undefined }) {
  const stale = version ? isOlder(version, EXTENSION_VERSION) : false;
  return (
    <div
      className="flex items-center gap-space-sm rounded-lg border border-hairline bg-surface-container-low px-3 py-2.5"
      title={
        version
          ? `Tatva Recorder ${version}${stale ? ` (update available: reload the extension to get ${EXTENSION_VERSION})` : ''}`
          : 'Load or reload the Tatva Recorder extension (extension/ folder) at chrome://extensions, then reload this page.'
      }
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${version ? (stale ? 'bg-primary-container' : 'bg-tertiary-fixed') : 'bg-outline'}`} />
      <span className="flex-1 truncate text-label-md text-on-surface">
        {version ? 'Extension connected' : version === null ? 'Extension not detected' : 'Checking extension…'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- profile UI

function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const { profile, save } = useProfile();
  const { toast } = useTatvaUi();
  const [draft, setDraft] = useState<Pick<Profile, 'name' | 'role' | 'email' | 'avatar_color'>>({
    name: profile?.name ?? '',
    role: profile?.role ?? '',
    email: profile?.email ?? '',
    avatar_color: profile?.avatar_color ?? AVATAR_COLORS[0].value,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save(draft);
      toast('Profile saved.', 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame title="Edit profile" icon="person" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-space-md">
        <div className="flex items-center gap-space-md rounded-xl border border-hairline bg-surface-container-lowest p-space-md">
          <Avatar profile={{ ...draft, updated_at: null }} size={48} />
          <div className="min-w-0">
            <p className="truncate text-headline-sm text-on-surface">{draft.name || 'Your name'}</p>
            <p className="truncate text-body-sm text-on-surface-variant">{[draft.role, draft.email].filter(Boolean).join(' · ') || 'Role · email'}</p>
          </div>
        </div>
        <Field label="Name">
          <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required autoFocus />
        </Field>
        <Field label="Role">
          <input className={inputClass} value={draft.role} onChange={(e) => set({ role: e.target.value })} maxLength={60} placeholder="e.g. Project Lead" />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} placeholder="you@company.com" />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-label-md text-on-surface">Avatar colour</legend>
          <div className="flex flex-wrap gap-space-sm">
            {AVATAR_COLORS.map((c) => {
              const selected = draft.avatar_color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => set({ avatar_color: c.value })}
                  className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface-container-low ${selected ? 'ring-2 ring-on-surface' : 'hover:ring-1 hover:ring-hairline-strong'}`}
                  style={{ background: c.value }}
                >
                  {selected && <Icon name="check" className="text-body-md text-[#0a0a0a]" />}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
          <Icon name="link" className="mt-0.5 text-body-md" />
          {profile?.contact_id
            ? `Linked to your contact “${profile.contact_name ?? 'you'}”: saving updates it too, and Pooja uses this email when you say “email me”.`
            : 'Pooja uses this email when you say “email me”. Add yourself in Contacts (same email) to link your contact entry.'}
        </p>
        {error && <p className="rounded-lg border border-error/30 bg-error-container/40 px-space-md py-space-sm text-body-sm text-error">{error}</p>}
        <div className="flex items-center justify-end gap-space-sm pt-space-sm">
          <button type="button" onClick={onClose} className="rounded-lg border border-hairline bg-surface-container-high px-space-md py-2 text-label-md text-on-surface hover:bg-surface-bright">
            Cancel
          </button>
          <button type="submit" disabled={busy || !draft.name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary-container px-space-md py-2 text-label-md font-semibold text-on-primary hover:brightness-105 active:scale-[0.98] disabled:opacity-50">
            {busy && <Spinner className="text-body-md" />}
            Save profile
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

function StatusRow({ icon, label, state, detail }: { icon: string; label: string; state: 'ok' | 'off' | 'warn' | 'loading'; detail: string }) {
  return (
    <li className="flex items-center gap-space-sm px-space-md py-2">
      <Icon name={icon} className="text-body-lg text-on-surface-variant" />
      <span className="flex-1 truncate text-body-sm text-on-surface">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 text-caption ${
          state === 'ok' ? 'text-tertiary-fixed' : state === 'warn' ? 'text-primary-container' : 'text-on-surface-variant'
        }`}
      >
        {state === 'loading' ? <Spinner className="text-body-sm" /> : <span className={`h-1.5 w-1.5 rounded-full ${state === 'ok' ? 'bg-tertiary-fixed' : state === 'warn' ? 'bg-primary-container' : 'bg-outline'}`} />}
        {detail}
      </span>
    </li>
  );
}

function ProfileMenu({ extension, onEdit, onClose, authEnabled }: { extension: string | null | undefined; onEdit: () => void; onClose: () => void; authEnabled: boolean }) {
  const { profile, error: profileError } = useProfile();
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async (fresh: boolean) => {
    setRefreshing(true);
    setStatusError(null);
    try {
      const r = await api<{ composio: Record<string, boolean> }>(`/status${fresh ? '?fresh=1' : ''}`);
      setStatus(r.composio);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-profile-trigger]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const stale = extension ? isOlder(extension, EXTENSION_VERSION) : false;
  const connectedCount = status ? CONNECTIONS.filter((c) => status[c.key]).length : 0;

  return (
    <div ref={ref} role="menu" aria-label="Profile" className="animate-pop absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-xl border border-hairline bg-surface-container-low shadow-popover">
      <div className="flex items-center gap-space-sm p-space-md">
        <Avatar profile={profile} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-md text-on-surface">{profile?.name ?? (profileError ? 'Profile unavailable' : 'Loading…')}</p>
          {profile?.role && <p className="truncate text-body-sm text-on-surface-variant">{profile.role}</p>}
          {profile?.email && <p className="truncate font-mono text-caption text-on-surface-variant">{profile.email}</p>}
        </div>
      </div>
      <div className="px-space-md pb-space-md">
        <button
          type="button"
          role="menuitem"
          disabled={!profile}
          onClick={onEdit}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-surface-container-high py-2 text-label-md text-on-surface hover:bg-surface-bright disabled:opacity-50"
        >
          <Icon name="edit" className="text-body-lg" />
          Edit profile
        </button>
      </div>

      <div className="border-t border-hairline">
        <p className="px-space-md pb-1 pt-space-sm text-label-sm uppercase text-on-surface-variant">Recorder</p>
        <ul>
          <StatusRow
            icon="extension"
            label="Chrome extension"
            state={extension === undefined ? 'loading' : extension ? (stale ? 'warn' : 'ok') : 'off'}
            detail={extension === undefined ? 'Checking' : extension ? (stale ? `v${extension} · reload to update` : `Connected · v${extension}`) : 'Not detected'}
          />
        </ul>
      </div>

      <div className="border-t border-hairline pb-space-sm">
        <div className="flex items-center justify-between px-space-md pb-1 pt-space-sm">
          <p className="text-label-sm uppercase text-on-surface-variant">
            Connections <span className="font-mono normal-case">{status ? `${connectedCount}/${CONNECTIONS.length}` : ''}</span>
          </p>
          <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50">
            <Icon name="refresh" className={`text-body-sm ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
        {statusError ? (
          <p className="px-space-md py-2 text-body-sm text-error">{statusError}</p>
        ) : (
          <ul>
            {CONNECTIONS.map((c) => (
              <StatusRow key={c.key} icon={c.icon} label={c.label} state={!status ? 'loading' : status[c.key] ? 'ok' : 'off'} detail={!status ? 'Checking' : status[c.key] ? 'Connected' : 'Not connected'} />
            ))}
          </ul>
        )}
        <p className="px-space-md pt-1 text-caption text-on-surface-variant">Via Composio. Pooja can act only through connected apps.</p>
      </div>
      {authEnabled && (
        <div className="border-t border-hairline p-space-sm">
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST' }).catch(() => {});
              window.location.assign('/login');
            }}
            className="flex w-full items-center gap-2 rounded-lg px-space-sm py-2 text-label-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <Icon name="logout" className="text-body-lg" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- shell

function Shell({ children, authEnabled }: { children: ReactNode; authEnabled: boolean }) {
  const pathname = usePathname();
  const extension = useExtensionVersion();
  const { profile } = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      <aside className="fixed left-0 top-0 z-50 flex h-screen w-60 select-none flex-col justify-between border-r border-hairline bg-surface-container-lowest py-space-lg">
        <div className="flex w-full flex-col">
          <Link href="/" aria-label="Tatva home" className="mx-3 mb-space-xl flex items-center rounded-lg px-2 py-1">
            <TatvaLockup />
          </Link>
          <nav className="flex w-full flex-col gap-0.5 px-3">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-label-md ${
                    active ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  {active && <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-container" />}
                  <Icon name={item.icon} className={`text-[18px] ${active ? 'text-primary-container' : ''}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-col gap-space-sm px-3">
          <ExtensionCard version={extension} />
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={!profile}
            title="Edit profile"
            className="flex items-center gap-space-sm rounded-lg border border-hairline bg-surface-container-low p-2 text-left hover:bg-surface-container"
          >
            <Avatar profile={profile} size={32} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-label-md text-on-surface">{profile?.name ?? '…'}</span>
              <span className="truncate text-caption text-on-surface-variant">{profile?.role ?? ''}</span>
            </span>
            <Icon name="unfold_more" className="text-body-lg text-on-surface-variant" />
          </button>
        </div>
      </aside>
      <div className="pl-60">
        <header className="fixed left-60 right-0 top-0 z-40 flex h-16 items-center justify-end gap-space-md border-b border-hairline bg-surface/80 px-space-xl backdrop-blur-xl">
          <div className="relative">
            <button
              type="button"
              data-profile-trigger
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Open profile menu"
              onClick={() => setMenuOpen((o) => !o)}
              className={`flex items-center rounded-full p-0.5 ring-offset-2 ring-offset-surface hover:ring-1 hover:ring-hairline-strong ${menuOpen ? 'ring-1 ring-hairline-strong' : ''}`}
            >
              <Avatar profile={profile} size={32} />
            </button>
            {menuOpen && (
              <ProfileMenu
                authEnabled={authEnabled}
                extension={extension}
                onClose={closeMenu}
                onEdit={() => {
                  setMenuOpen(false);
                  setEditing(true);
                }}
              />
            )}
          </div>
        </header>
        <main className="min-h-screen w-full bg-surface pt-16">{children}</main>
      </div>
      {editing && <EditProfileDialog onClose={() => setEditing(false)} />}
    </>
  );
}

export function AppShell({ children, authEnabled = false }: { children: ReactNode; authEnabled?: boolean }) {
  const pathname = usePathname();
  // The sign-in page has no sidebar and can't load any data yet.
  if (pathname === '/login') return <TatvaUiProvider>{children}</TatvaUiProvider>;
  return (
    <TatvaUiProvider>
      <ProfileProvider>
        <Shell authEnabled={authEnabled}>{children}</Shell>
      </ProfileProvider>
    </TatvaUiProvider>
  );
}
