'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, downloadText, dueLabel, initials, plural, relativeDateTime, toCsv, todayYmd } from '@/lib/tatva';
import { describe, type Activity } from './activity';
import type { Contact, TrackerItem } from './types';
import { EmptyState, Field, Icon, inputClass, Spinner, useTatvaUi } from './ui';

const PAGE_SIZE = 6;
type Filter = 'all' | 'pending' | 'done' | 'issues';
type Sort = 'due' | 'newest' | 'owner';
const SORT_LABEL: Record<Sort, string> = { due: 'Due date', newest: 'Newest first', owner: 'Owner A–Z' };
const CONNECTORS: Record<string, string[]> = {
  send_email: ['Gmail'],
  post_to_slack: ['Slack'],
  log_issue: ['Slack', 'Sheets'],
  create_calendar_event: ['Calendar'],
  add_tracker_row: ['Sheets'],
  mark_complete: ['Sheets'],
  reopen_item: ['Sheets'],
  create_google_doc: ['Docs'],
  upload_document: ['Knowledge'],
};
const CONNECTOR_OPTIONS = ['All Connectors', 'Gmail', 'Slack', 'Calendar', 'Sheets', 'Docs', 'Knowledge'];
const CONNECTOR_ICON: Record<string, string> = { send_email: 'mail', post_to_slack: 'tag', log_issue: 'report', create_calendar_event: 'event', add_tracker_row: 'table_rows', mark_complete: 'task_alt', reopen_item: 'undo', create_google_doc: 'description', upload_document: 'upload_file' };

export default function Tracker() {
  const { toast, runAction } = useTatvaUi();
  const { data, error, reload, setData } = useApi<{ items: TrackerItem[] }>('/tracker', { refreshMs: 10_000 });
  const activity = useApi<{ activity: Activity[] }>('/activity', { refreshMs: 10_000 });
  const sheet = useApi<{ url: string }>('/tracker/sheet');
  const contacts = useApi<{ contacts: Contact[] }>('/contacts');
  const [view, setView] = useState<'items' | 'activity'>('items');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('due');
  const [page, setPage] = useState(0);
  const [connector, setConnector] = useState('All Connectors');
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (data) setUpdatedAt(Date.now());
  }, [data]);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setPage(0), [filter, query, sort]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const today = todayYmd();
  const overdue = (i: TrackerItem) => i.status === 'open' && !!i.due_date && i.due_date < today;
  const counts = {
    all: items.length,
    pending: items.filter((i) => i.status === 'open').length,
    done: items.filter((i) => i.status === 'done').length,
    issues: items.filter((i) => i.kind === 'issue').length,
    attention: items.filter((i) => i.status === 'open' && (i.kind === 'issue' || overdue(i))).length,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((i) => {
      if (filter === 'pending' && i.status !== 'open') return false;
      if (filter === 'done' && i.status !== 'done') return false;
      if (filter === 'issues' && i.kind !== 'issue') return false;
      return !q || [i.task, i.owner, i.context, i.meeting].some((v) => v?.toLowerCase().includes(q));
    });
    const byDue = (a: TrackerItem, b: TrackerItem) => (a.due_date ?? '9999') .localeCompare(b.due_date ?? '9999');
    return [...list].sort((a, b) => {
      if (sort === 'newest') return b.created_at.localeCompare(a.created_at);
      if (sort === 'owner') return (a.owner ?? '~').localeCompare(b.owner ?? '~') || byDue(a, b);
      // due: open first, then by date
      return (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || byDue(a, b) || b.created_at.localeCompare(a.created_at);
    });
  }, [items, filter, query, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const acts = useMemo(
    () => (activity.data?.activity ?? []).filter((a) => connector === 'All Connectors' || (CONNECTORS[a.tool] ?? []).includes(connector)),
    [activity.data, connector],
  );
  const automatedToday = (activity.data?.activity ?? []).filter((a) => a.status === 'confirmed' && a.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;

  const toggle = async (item: TrackerItem) => {
    const next = item.status === 'open' ? 'done' : 'open';
    setBusy(item.id);
    try {
      const r = await api<{ sheet: { ok: boolean; error?: string } }>(`/action-items/${item.id}`, { method: 'PATCH', json: { status: next } });
      setData((d) => (d ? { items: d.items.map((x) => (x.id === item.id ? { ...x, status: next } : x)) } : d));
      toast(
        r.sheet.ok ? `${next === 'done' ? 'Marked done' : 'Reopened'}: "${item.task}". Tracker sheet updated.` : `Saved, but the tracker sheet wasn't updated: ${r.sheet.error}`,
        r.sheet.ok ? 'success' : 'error',
      );
      activity.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    downloadText(
      `tatva-tracker-${filter}-${today}.csv`,
      toCsv([
        ['Task', 'Detail', 'Type', 'Owner', 'Due', 'Status', 'Source meeting', 'Created'],
        ...filtered.map((i) => [i.task, i.context, i.kind === 'issue' ? 'Issue' : 'Task', i.owner, i.due_date ?? i.due_text, i.status === 'done' ? 'Done' : 'Pending', i.meeting ?? (i.source === 'meeting' ? '' : 'Logged by voice'), i.created_at.slice(0, 10)]),
      ]),
    );
    toast(`Exported ${plural(filtered.length, 'row')} (current view).`, 'success');
  };

  const logIssue = () =>
    runAction({
      kind: 'log_issue',
      title: 'Log an issue',
      icon: 'report',
      confirmLabel: 'Log & escalate',
      input: { title: '', owner: contacts.data?.contacts.find((c) => /rahul/i.test(c.name))?.name ?? '', context: '', source: 'web' },
      fields: (set, input) => (
        <>
          <Field label="Issue" note="Required">
            <input className={inputClass} value={String(input.title ?? '')} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Login bug reported by client" />
          </Field>
          <Field label="Owner" note="Escalated on Slack">
            <select className={inputClass} value={String(input.owner ?? '')} onChange={(e) => set({ owner: e.target.value })}>
              <option value="">Unassigned</option>
              {(contacts.data?.contacts ?? []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                  {c.role ? ` · ${c.role}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Detail">
            <input className={inputClass} value={String(input.context ?? '')} onChange={(e) => set({ context: e.target.value })} placeholder="One line of context" />
          </Field>
        </>
      ),
      onDone: (r) => {
        if (r.ok) {
          reload();
          activity.reload();
        }
      },
    });

  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-space-xl px-space-xl py-space-xl">
      <div className="flex flex-col justify-between gap-space-lg md:flex-row md:items-center">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-sm">
            <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Tracker</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-sm text-label-sm uppercase tracking-wider text-primary-container">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
              Sync Stream
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant">Action items and issues, synced with Google Sheets</p>
        </div>
        <div className="flex flex-wrap items-center gap-space-md">
          <div className="flex items-center gap-2 rounded-full bg-surface-container-low px-space-md py-2 font-caption text-caption text-on-surface-variant shadow-sm">
            <span className={`h-2 w-2 rounded-full ${error ? 'bg-error' : 'bg-tertiary-fixed shadow-[0_0_8px_rgba(111,251,190,0.8)]'}`} />
            <span>
              {error ? 'Sync paused: server unreachable' : 'Live Sync active'} <span className="text-secondary/40">·</span>{' '}
              {ago == null ? 'Loading…' : ago < 15 ? 'Updated just now' : `Updated ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago`}
            </span>
          </div>
          <button
            type="button"
            onClick={logIssue}
            className="inline-flex items-center gap-space-sm rounded-lg bg-surface-container px-space-md py-2 font-label-md text-label-md text-on-surface shadow-sm transition-all hover:bg-surface-container-high hover:text-error active:scale-[0.99]"
          >
            <Icon name="report" className="text-[18px] text-error" />
            <span>Log issue</span>
          </button>
          <a
            href={sheet.data?.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!sheet.data}
            onClick={(e) => !sheet.data && e.preventDefault()}
            className={`inline-flex items-center gap-space-sm rounded-lg bg-surface-container px-space-md py-2 font-label-md text-label-md text-on-surface shadow-sm transition-all hover:bg-surface-container-high hover:text-primary-container active:scale-[0.99] ${sheet.data ? '' : 'opacity-50'}`}
          >
            <Icon name="table_chart" className="text-[18px] text-tertiary-container" />
            <span>Open in Google Sheets</span>
            {sheet.data ? <Icon name="open_in_new" className="text-[16px] text-on-surface-variant" /> : <Spinner className="text-[16px]" />}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total Commitments" value={counts.all} icon="task_alt" tone="text-on-surface" iconTone="text-primary-container" />
        <Kpi label="Pending Execution" value={counts.pending} icon="pending_actions" tone="text-primary-fixed-dim" iconTone="text-primary-fixed-dim" />
        <Kpi label="Completed" value={counts.done} icon="verified" tone="text-tertiary-fixed" iconTone="text-tertiary-fixed" />
        <Kpi label="Attention Needed" value={counts.attention} icon="error" tone="text-error" iconTone="text-error" iconBg="bg-error-container/40" title="Open issues and overdue items" />
      </div>

      <div className="flex items-center gap-space-lg">
        <TabButton active={view === 'items'} onClick={() => setView('items')} icon="checklist" label="Action items" count={counts.all} />
        <TabButton active={view === 'activity'} onClick={() => setView('activity')} icon="history_toggle_off" label="Activity log" count={activity.data?.activity.length ?? 0} />
      </div>

      {view === 'items' ? (
        <>
          <div className="flex flex-col justify-between gap-space-md rounded-xl bg-surface-container-low p-space-sm lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-space-xs">
              {(
                [
                  ['all', 'All', counts.all],
                  ['pending', 'Pending', counts.pending],
                  ['done', 'Done', counts.done],
                  ['issues', 'Issues', counts.issues],
                ] as [Filter, string, number][]
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-label-sm text-label-sm transition-colors ${
                    filter === id ? 'bg-primary-container text-on-primary-container shadow-[0_0_12px_rgba(255,212,0,0.2)]' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  <span>{label}</span>
                  {id === 'issues' && filter !== id ? <span className="rounded-full bg-error-container px-1.5 text-[10px] text-error">{n}</span> : <span className="opacity-70">{n}</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-space-sm">
              <div className="relative flex-1 sm:w-72">
                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest py-2 pl-9 pr-space-md font-body-sm text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/60 focus:ring-1 focus:ring-primary-container"
                  placeholder="Filter actions or owners..."
                  type="text"
                />
              </div>
              <button
                type="button"
                title={`Sort: ${SORT_LABEL[sort]} (click to change)`}
                onClick={() => setSort((s) => (s === 'due' ? 'newest' : s === 'newest' ? 'owner' : 'due'))}
                className="flex items-center gap-1 rounded-lg bg-surface-container p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Icon name="sort" className="text-[20px]" />
                <span className="hidden font-caption text-caption xl:inline">{SORT_LABEL[sort]}</span>
              </button>
              <button
                type="button"
                title="Export current view (CSV)"
                aria-label="Export current view as CSV"
                disabled={!filtered.length}
                onClick={exportCsv}
                className="rounded-lg bg-surface-container p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
              >
                <Icon name="file_download" className="text-[20px]" />
              </button>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-xl bg-surface-container-low shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead>
                  <tr className="bg-surface-container font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                    <th className="px-space-lg py-space-md font-semibold">Task &amp; Context</th>
                    <th className="px-space-md py-space-md font-semibold">Source Meeting</th>
                    <th className="px-space-md py-space-md font-semibold">Owner</th>
                    <th className="px-space-md py-space-md font-semibold">Due Date</th>
                    <th className="px-space-md py-space-md font-semibold">Status</th>
                    <th className="px-space-lg py-space-md text-right font-semibold">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container/60 font-body-md text-body-md text-on-surface">
                  {!data && !error && (
                    <tr>
                      <td colSpan={6} className="p-space-xl text-center text-on-surface-variant">
                        <Spinner />
                      </td>
                    </tr>
                  )}
                  {data && shown.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState icon="checklist" title={query || filter !== 'all' ? 'Nothing matches this view' : 'No action items yet'} />
                      </td>
                    </tr>
                  )}
                  {shown.map((i) => {
                    const done = i.status === 'done';
                    const issue = i.kind === 'issue';
                    const late = overdue(i);
                    return (
                      <tr key={i.id} className={`group transition-colors hover:bg-surface-container-high/40 ${issue && !done ? 'bg-error-container/5' : ''} ${done ? 'opacity-85' : ''}`}>
                        <td className="px-space-lg py-space-md">
                          <div className="flex min-w-0 flex-col">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium transition-colors group-hover:text-primary ${done ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>{i.task}</span>
                              {issue && !done && <span className="h-2 w-2 animate-ping rounded-full bg-error" />}
                            </div>
                            {(i.context || i.due_text) && (
                              <span className={`truncate font-body-sm text-body-sm ${issue && !done ? 'text-error/80' : 'text-on-surface-variant'}`}>{i.context ?? `Said: due ${i.due_text}`}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-space-md py-space-md">
                          {i.meeting_id ? (
                            <Link href={`/meetings/${i.meeting_id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-2.5 py-1 font-caption text-caption text-on-surface transition-colors hover:bg-surface-variant">
                              <Icon name={issue ? 'priority_high' : 'groups'} className={`text-[14px] ${issue ? 'text-error' : 'text-primary-container'}`} />
                              <span>{i.meeting}</span>
                              {i.meeting_date && <span className="text-on-surface-variant">· {relativeDateTime(i.meeting_date).split(',')[0]}</span>}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-2.5 py-1 font-caption text-caption text-on-surface-variant">
                              <Icon name="mic" className="text-[14px] text-primary-container" />
                              {i.source === 'web' ? 'Logged in the app' : 'Logged by voice'}
                            </span>
                          )}
                        </td>
                        <td className="px-space-md py-space-md">
                          {i.owner ? (
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-highest font-label-sm text-label-sm font-bold text-on-surface">{initials(i.owner)}</div>
                              <span className="font-label-md text-label-md text-on-surface">{i.owner}</span>
                            </div>
                          ) : (
                            <span className="font-body-sm text-body-sm text-on-surface-variant">Unassigned</span>
                          )}
                        </td>
                        <td className="px-space-md py-space-md">
                          <div className={`inline-flex items-center gap-1.5 font-body-sm text-body-sm ${late ? 'font-semibold text-error' : 'text-on-surface-variant'}`}>
                            <Icon name={done ? 'done_all' : late ? 'schedule' : 'calendar_today'} className="text-[16px]" />
                            <span>{i.due_date ? `${late ? 'Overdue · ' : ''}${dueLabel(i.due_date)}` : (i.due_text ?? '—')}</span>
                          </div>
                        </td>
                        <td className="px-space-md py-space-md">
                          <button
                            type="button"
                            disabled={busy === i.id}
                            onClick={() => toggle(i)}
                            title={done ? 'Reopen' : 'Mark done'}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-label-sm text-label-sm transition-all hover:ring-1 disabled:opacity-60 ${
                              done ? 'bg-tertiary-container/15 text-tertiary-fixed hover:ring-tertiary-fixed/50' : 'bg-primary-container/15 text-primary-fixed hover:ring-primary-container/50'
                            }`}
                          >
                            {busy === i.id ? <Spinner className="text-[14px]" /> : done ? <Icon name="check" className="text-[14px]" /> : <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />}
                            {done ? 'Done' : 'Pending'}
                          </button>
                        </td>
                        <td className="px-space-lg py-space-md text-right">
                          {issue ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-error-container/40 px-2.5 py-0.5 font-label-sm text-label-sm font-semibold text-error">
                              <Icon name="warning" className="text-[14px]" /> Issue
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-surface-container px-2 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                              <Icon name="check_circle" className="text-[14px]" /> Task
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between bg-surface-container px-space-lg py-space-md font-body-sm text-body-sm text-on-surface-variant">
              <span>
                Showing {shown.length} of {filtered.length} {filtered.length === 1 ? 'commitment' : 'commitments'}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded bg-surface-container-low p-1 text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:text-on-surface-variant/40">
                  <Icon name="chevron_left" className="text-[18px]" />
                </button>
                <span className="px-2 font-label-sm text-label-sm text-on-surface">
                  Page {page + 1} of {pages}
                </span>
                <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded bg-surface-container-low p-1 text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:text-on-surface-variant/40">
                  <Icon name="chevron_right" className="text-[18px]" />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-space-lg">
          <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-center">
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center gap-space-sm">
                <h2 className="font-headline-md text-headline-md tracking-tight text-on-surface">Activity log</h2>
                <span className="inline-flex items-center rounded-full bg-tertiary-container/20 px-2.5 py-0.5 font-label-sm text-label-sm text-tertiary">{automatedToday} automated today</span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant">Voice-approved and in-app actions executed across connected tools</p>
            </div>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-low px-3 py-1.5 font-label-md text-label-md text-on-surface shadow-sm transition-colors hover:bg-surface-container"
              >
                <Icon name="filter_list" className="text-[18px] text-on-surface-variant" />
                <span>{connector}</span>
              </button>
              {menuOpen && (
                <div role="listbox" className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-xl bg-surface-container-high shadow-[0_8px_32px_-4px_rgba(0,0,0,0.8)]">
                  {CONNECTOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="option"
                      aria-selected={connector === c}
                      onClick={() => {
                        setConnector(c);
                        setMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-space-md py-2 text-left font-label-md text-label-md transition-colors hover:bg-surface-bright ${connector === c ? 'text-primary-container' : 'text-on-surface'}`}
                    >
                      {c}
                      {connector === c && <Icon name="check" className="text-body-md" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-xl bg-surface-container-low p-space-lg shadow-sm lg:p-space-xl">
            {acts.length === 0 ? (
              <EmptyState icon="history" title={activity.data ? 'No actions yet for this connector' : 'Loading…'} />
            ) : (
              <div className="relative space-y-space-xl pl-6 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-[2px] before:bg-surface-container-high sm:pl-8 sm:before:left-4">
                {acts.map((a) => {
                  const d = describe(a);
                  const failed = a.status === 'error';
                  const web = a.session_id === 'web';
                  const badge =
                    a.status === 'confirmed'
                      ? web
                        ? { icon: 'touch_app', text: 'Approved in app' }
                        : { icon: 'mic', text: 'Voice approved' }
                      : failed
                        ? { icon: 'person', text: web ? 'From the app' : 'Triggered by Pooja' }
                        : a.status === 'cancelled'
                          ? { icon: 'block', text: web ? 'Cancelled in app' : 'Cancelled by voice' }
                          : { icon: 'touch_app', text: 'From the app' };
                  return (
                    <div key={a.id} className="group relative">
                      <div className={`absolute -left-6 top-1.5 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-surface-container-lowest shadow-md sm:-left-8 ${failed ? 'ring-2 ring-error' : ''}`}>
                        <Icon name={failed ? 'warning' : (CONNECTOR_ICON[a.tool] ?? 'bolt')} className={`text-[16px] ${failed ? 'text-error' : 'text-primary-container'}`} />
                      </div>
                      <div className={`flex flex-col justify-between gap-space-sm rounded-xl p-space-md transition-colors lg:flex-row lg:items-center ${failed ? 'bg-error-container/10 hover:bg-error-container/20' : 'bg-surface-container hover:bg-surface-container-high/60'}`}>
                        <div className="flex min-w-0 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`font-headline-sm text-headline-sm font-semibold ${failed ? 'text-error' : 'text-on-surface'}`}>{d.title}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-caption text-caption ${a.status === 'confirmed' && !web ? 'bg-primary-container/20 text-primary-fixed-dim' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                              <Icon name={badge.icon} className="text-[12px]" />
                              {badge.text}
                            </span>
                          </div>
                          {d.detail && <p className="line-clamp-2 font-body-md text-body-md text-on-surface-variant">{d.detail}</p>}
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-space-md lg:justify-end">
                          <span className="font-body-sm text-body-sm text-on-surface-variant">{relativeDateTime(a.created_at)}</span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-label-sm text-label-sm ${
                              failed ? 'bg-error-container/30 font-semibold text-error' : a.status === 'cancelled' ? 'bg-surface-container-highest text-on-surface-variant' : 'bg-tertiary-container/15 text-tertiary'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${failed ? 'bg-error' : a.status === 'cancelled' ? 'bg-on-surface-variant' : 'bg-tertiary-fixed'}`} />
                            {failed ? 'Failed' : a.status === 'cancelled' ? 'Cancelled' : 'Success'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, tone, iconTone, iconBg = 'bg-surface-container', title }: { label: string; value: number; icon: string; tone: string; iconTone: string; iconBg?: string; title?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface-container-low p-space-md shadow-sm" title={title}>
      <div className="flex flex-col">
        <span className="font-caption text-caption uppercase tracking-wider text-on-surface-variant">{label}</span>
        <span className={`mt-1 font-headline-md text-headline-md font-bold ${tone}`}>{String(value).padStart(2, '0')}</span>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} ${iconTone}`}>
        <Icon name={icon} className="text-headline-sm" />
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: string; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-space-sm border-b-2 pb-space-sm font-label-md text-label-md transition-colors ${
        active ? 'border-primary-container text-primary-container' : 'border-transparent text-on-surface-variant hover:border-surface-variant hover:text-on-surface'
      }`}
    >
      <Icon name={icon} className="text-headline-sm" />
      <span>{label}</span>
      <span className={`rounded-full px-2 py-0.5 font-caption text-caption ${active ? 'bg-primary-container font-bold text-on-primary-container' : 'bg-surface-container text-on-surface-variant group-hover:text-on-surface'}`}>{count}</span>
    </button>
  );
}
