'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, durationLabel, dueLabel, initials, meetingErrorText, minutesLabel, plural, relativeDateTime, todayYmd } from '@/lib/tatva';
import { PROCESSING, TOOL_LABELS, type CalendarEvent, type DashboardData, type MeetingRow, type PendingItem } from './types';
import { firstName, ownerIsMe, useProfile } from './profile';
import { EmptyState, ErrorState, Icon, Skeleton, SkeletonRows, Spinner, useTatvaUi } from './ui';

const STEP_LABEL: Record<string, string> = {
  uploaded: 'Uploaded',
  transcribing: 'Transcribing audio…',
  extracting: 'Extracting decisions & action items…',
  indexing: 'Indexing for search…',
};
const STEP_INDEX: Record<string, number> = { uploaded: 0, transcribing: 1, extracting: 2, indexing: 3 };

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function untilLabel(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (minutes <= 0) return 'Now';
  if (minutes < 60) return `In ${minutes} min${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `In ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `In ${days} day${days === 1 ? '' : 's'}`;
}


export function StatusPill({ meeting }: { meeting: MeetingRow }) {
  if (meeting.status === 'ready')
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-on-tertiary-fixed-variant px-3 py-1 font-label-sm text-label-sm text-tertiary">
        <span className="h-1.5 w-1.5 rounded-full bg-tertiary-fixed" />
        <span>Ready</span>
      </div>
    );
  if (meeting.status === 'failed')
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-error-container/30 px-3 py-1 font-label-sm text-label-sm text-error" title={meetingErrorText(meeting.error)}>
        <span className="h-1.5 w-1.5 rounded-full bg-error" />
        <span>Failed</span>
      </div>
    );
  const step = STEP_INDEX[meeting.status] ?? 0;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-on-primary-fixed-variant/40 px-3 py-1 font-label-sm text-label-sm text-primary-fixed">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container" />
        <span>Processing (step {step + 1} of 4)</span>
      </div>
      <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-container-high">
        <div className="h-full rounded-full bg-primary-container transition-all duration-500" style={{ width: `${((step + 0.5) / 4) * 100}%` }} />
      </div>
    </div>
  );
}

/** Re-runs a failed meeting from its stored recording (POST /meetings/:id/retry). */
export function RetryMeetingButton({ meetingId, onRetried, className = '' }: { meetingId: string; onRetried: () => void; className?: string }) {
  const { toast } = useTatvaUi();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      await api(`/meetings/${meetingId}/retry`, { method: 'POST' });
      toast('Processing the recording again. This takes a minute or two.', 'success');
      onRetried();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={retry}
      disabled={busy}
      aria-busy={busy}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-hairline bg-surface-container-high px-3 py-1 font-label-md text-caption text-on-surface hover:border-hairline-strong hover:bg-surface-bright ${className}`}
    >
      {busy ? <Spinner /> : <Icon name="refresh" className="text-sm text-on-surface-variant" />}
      <span>{busy ? 'Retrying…' : 'Retry'}</span>
    </button>
  );
}

export function MeetingListRow({
  meeting,
  onAsk,
  onRetried,
  showSaved = false,
}: {
  meeting: MeetingRow;
  onAsk: (m: MeetingRow) => void;
  onRetried: () => void;
  showSaved?: boolean;
}) {
  const processing = PROCESSING.includes(meeting.status);
  const body = (
    <div className="flex min-w-0 items-start gap-space-sm">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          processing ? 'bg-primary-container/10 text-primary-container' : meeting.status === 'failed' ? 'bg-surface-container-high text-error' : 'bg-surface-container-high text-on-surface-variant'
        }`}
      >
        <Icon name={processing ? 'sync' : meeting.status === 'failed' ? 'warning_amber' : 'groups'} className={`text-headline-sm ${processing ? 'animate-spin' : ''}`} />
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate font-label-md text-label-md font-semibold text-on-surface group-hover:text-primary-fixed" title={meeting.title}>{meeting.title}</span>
          {processing ? (
            <span className="rounded bg-surface-container-high px-2 py-0.5 font-caption text-caption text-primary-container">Live Sync</span>
          ) : (
            <span className="text-primary-container opacity-0 transition-opacity group-hover:opacity-100">
              <Icon name="open_in_new" className="text-sm" />
            </span>
          )}
        </div>
        <div className={`flex items-center gap-2 font-caption text-caption ${processing ? 'text-primary-fixed-dim' : 'text-secondary'}`}>
          <span>{processing ? 'Just recorded' : relativeDateTime(meeting.recorded_at)}</span>
          {meeting.duration_seconds != null && (
            <>
              <span>•</span>
              <span>{durationLabel(meeting.duration_seconds)}</span>
            </>
          )}
          <span>•</span>
          {processing ? (
            // A progress note ("AI service busy, retrying with another model") shows instead of the step name.
            <span className="truncate" title={meeting.error ?? undefined}>{meeting.error || STEP_LABEL[meeting.status]}</span>
          ) : meeting.status === 'failed' ? (
            <span className="truncate text-error" title={meetingErrorText(meeting.error)}>{meetingErrorText(meeting.error)}</span>
          ) : (
            <span className={meeting.action_count ? 'font-medium text-tertiary-fixed' : ''}>{plural(meeting.action_count, 'action')}</span>
          )}
          {showSaved && meeting.time_saved_minutes ? (
            <>
              <span>•</span>
              <span className="whitespace-nowrap text-primary-container">~{minutesLabel(meeting.time_saved_minutes)} saved</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
  return (
    <div className={`group flex flex-col justify-between gap-space-sm p-space-md transition-colors hover:bg-surface-container sm:flex-row sm:items-center ${processing ? 'bg-surface-container/60' : ''}`}>
      {meeting.status === 'ready' ? (
        <Link href={`/meetings/${meeting.id}`} data-hover="parent" className="min-w-0 flex-1 rounded-lg">
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      <div className="flex shrink-0 items-center gap-space-sm self-end sm:self-auto">
        {meeting.status === 'ready' && (
          <button
            type="button"
            onClick={() => onAsk(meeting)}
            className="hidden items-center gap-1.5 rounded-lg bg-surface-container-high px-3 py-1 font-label-md text-caption text-on-surface opacity-0 transition-all hover:bg-surface-bright focus-visible:opacity-100 group-hover:opacity-100 sm:inline-flex"
          >
            <Icon name="graphic_eq" className="text-sm text-on-surface-variant" />
            <span>Ask Tatva</span>
          </button>
        )}
        {meeting.status === 'failed' && <RetryMeetingButton meetingId={meeting.id} onRetried={onRetried} />}
        <StatusPill meeting={meeting} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { runAction, toast } = useTatvaUi();
  const { profile } = useProfile();
  const { data, error, reload, setData } = useApi<DashboardData>('/dashboard', {
    refreshMs: (d) => (d?.meetings.some((m) => PROCESSING.includes(m.status)) ? 3000 : 30_000),
  });
  const next = useApi<{ event: CalendarEvent | null }>('/calendar/next', { refreshMs: 120_000 });
  const [completing, setCompleting] = useState<string | null>(null);

  const s = data?.stats;
  const tools = useMemo(
    () =>
      Object.entries(s?.actions_by_tool ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([tool, n]) => `${TOOL_LABELS[tool] ?? tool} ${n}`)
        .join(' · '),
    [s?.actions_by_tool],
  );
  const readyMeetings = data?.meetings.filter((m) => m.status === 'ready').length ?? 0;

  const askAbout = (m: MeetingRow) => router.push(`/talk?meeting=${m.id}`);

  const ping = (item: PendingItem) => {
    const who = item.owner_contact?.slack_handle ? `@${item.owner_contact.slack_handle}` : (item.owner ?? 'team');
    const due = item.due_date ? ` (due ${dueLabel(item.due_date)})` : item.due_text ? ` (due ${item.due_text})` : '';
    runAction({
      kind: 'post_to_slack',
      title: 'Ping on Slack',
      icon: 'send',
      confirmLabel: 'Post reminder',
      input: { message: `:bell: Reminder for ${who}: ${item.task}${due}.${item.meeting ? ` From "${item.meeting}".` : ''}` },
      onDone: (r) => r.ok && reload(),
    });
  };

  const complete = async (item: PendingItem) => {
    setCompleting(item.id);
    try {
      const r = await api<{ sheet: { ok: boolean; error?: string } }>(`/action-items/${item.id}`, { method: 'PATCH', json: { status: 'done' } });
      setData((d) => (d ? { ...d, pending: d.pending.filter((p) => p.id !== item.id), stats: { ...d.stats, open_action_items: d.stats.open_action_items - 1 } } : d));
      toast(r.sheet.ok ? `Marked "${item.task}" complete and updated the tracker sheet.` : `Marked complete. The tracker sheet wasn't updated: ${r.sheet.error}`, r.sheet.ok ? 'success' : 'error');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setCompleting(null);
    }
  };

  const event = next.data?.event ?? null;
  const today = todayYmd();

  return (
    <div className="mx-auto max-w-7xl py-space-xl sm:px-margin">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-space-xl px-space-md py-space-md sm:px-space-xl">
        <header className="flex flex-col justify-between gap-space-lg md:flex-row md:items-end">
          <div className="flex flex-col gap-space-xs">
            <h1 className="font-headline-xl text-headline-xl tracking-tight text-on-surface">{greeting()}{profile ? `, ${firstName(profile.name)}` : ''}</h1>
            <p className="font-body-md text-body-md text-secondary">Here&apos;s what your meetings produced this week</p>
          </div>
          <div className="flex items-center gap-space-sm self-start md:self-auto">
            <Link
              href="/talk"
              className="group relative inline-flex items-center gap-space-sm rounded-xl bg-primary-container px-5 py-2.5 font-label-md text-label-md text-on-primary shadow-lg shadow-primary-container/20 transition-all hover:bg-primary-fixed active:scale-[0.99]"
            >
              <Icon name="mic" className="text-headline-sm transition-transform group-hover:scale-110" />
              <span>Talk to Tatva</span>
            </Link>
          </div>
        </header>

        {error && !data && (
          <div className="rounded-xl border border-hairline bg-surface-container-low">
            <ErrorState title="Couldn't load your dashboard" message={error} onRetry={reload} />
          </div>
        )}

        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            href="/meetings"
            hint="See all meetings"
            label="Meetings Recorded"
            icon="graphic_eq"
            value={s ? String(s.meetings_recorded) : null}
            caption={s ? `${s.meetings_this_week} this week` : ''}
          />
          <StatCard
            href="/tracker?filter=pending"
            hint="See pending items in the Tracker"
            label="Open Action Items"
            icon="pending_actions"
            value={s ? String(s.open_action_items) : null}
            caption={s ? `${s.due_this_week} due this week${s.overdue ? ` · ${s.overdue} overdue` : ''}` : ''}
          />
          <StatCard
            href="/tracker?view=activity"
            hint="See every action in the activity log"
            label="Actions by Tatva"
            icon="bolt"
            value={s ? String(s.actions_by_tatva_this_week) : null}
            caption={s ? (tools ? `This week: ${tools}` : 'None yet this week') : ''}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-tertiary">
              <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
              <span>Each one confirmed by you first</span>
            </div>
          </StatCard>
          <StatCard
            href="/meetings?sort=time_saved"
            hint="See which meetings saved the most time"
            label="Time Saved This Week"
            icon="timer"
            accent
            value={s ? minutesLabel(s.time_saved_this_week_minutes) : null}
            caption={
              s
                ? `Notes, items and follow-ups for ${plural(s.meetings_this_week, 'meeting')}${s.time_saved_other_actions_minutes ? ` + ${s.time_saved_other_actions_minutes} min of other actions` : ''}`
                : ''
            }
          />
        </section>

        <div className="grid grid-cols-1 items-start gap-space-lg lg:grid-cols-12">
          <section className="flex flex-col gap-space-md lg:col-span-8">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Recent meetings</h2>
                <span className="rounded-full bg-surface-container px-2 py-0.5 font-caption text-caption font-semibold text-secondary">{readyMeetings} Total</span>
              </div>
              <Link href="/meetings" className="group flex items-center gap-1 rounded-md px-1 font-label-md text-label-md text-primary-container hover:text-primary-fixed hover:underline">
                <span>View all</span>
                <Icon name="arrow_forward" className="text-body-sm transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="divide-y divide-surface-container-highest overflow-hidden rounded-xl bg-surface-container-low shadow-md border border-hairline">
              {!data ? (
                error ? <ErrorState compact message={error} onRetry={reload} /> : <SkeletonRows rows={3} />
              ) : data.meetings.length === 0 ? (
                <EmptyState icon="mic_none" title="No meetings yet" body="Record a Google Meet or Teams call with the Tatva extension and it appears here." />
              ) : (
                data.meetings.slice(0, 5).map((m) => <MeetingListRow key={m.id} meeting={m} onAsk={askAbout} onRetried={reload} />)
              )}
            </div>
          </section>

          <aside className="flex flex-col gap-space-xl lg:col-span-4">
            <div className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between px-1">
                <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Up next</h2>
                <span className="font-caption text-caption text-secondary">Google Calendar</span>
              </div>
              <div className="relative flex flex-col gap-space-md overflow-hidden rounded-xl bg-surface-container-low p-5 shadow-md border border-hairline">
                {next.loading && !next.data ? (
                  <div role="status" aria-label="Checking your calendar" className="flex flex-col gap-space-sm">
                    <Skeleton className="h-5 w-32 rounded-full" />
                    <Skeleton className="h-5 w-3/5" />
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>
                ) : next.error && !next.data ? (
                  <ErrorState compact title="Couldn't read Google Calendar" message={next.error} onRetry={next.reload} />
                ) : event ? (
                  <>
                    <div className="flex items-center justify-between">
                      {!event.on_calendar ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-lowest px-2 py-0.5 font-label-sm text-label-sm text-primary-container">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
                          Planned · not on calendar yet
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-lowest px-2 py-0.5 font-label-sm text-label-sm text-secondary">
                          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                          On your calendar
                        </span>
                      )}
                      <span className="font-caption text-caption text-secondary">{untilLabel(event.start)}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <h3 className="truncate font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface" title={event.title}>{event.title}</h3>
                      <div className="flex items-center gap-2 font-caption text-caption text-secondary">
                        <Icon name="schedule" className="text-sm" />
                        <span>{event.when}</span>
                      </div>
                      {event.attendees.length > 0 && (
                        <div className="mt-1 flex items-center gap-2 font-caption text-caption text-secondary">
                          <Icon name="group" className="text-sm" />
                          <span className="truncate" title={event.attendees.join(', ')}>{event.attendees.join(', ')}</span>
                        </div>
                      )}
                      {event.from_meeting && (
                        <div className="mt-1 flex items-center gap-2 font-caption text-caption text-secondary">
                          <Icon name="forum" className="text-sm" />
                          <span className="truncate" title={`Follow-up from ${event.from_meeting}`}>Follow-up from {event.from_meeting}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push('/talk?brief=1')}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-surface-container-high px-4 py-2.5 font-label-md text-label-md text-on-surface shadow-sm transition-all hover:border-hairline-strong hover:bg-surface-bright"
                    >
                      <Icon name="auto_awesome" className="text-body-lg text-on-surface-variant" />
                      <span>Brief me</span>
                    </button>
                  </>
                ) : (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    Nothing on your calendar or planned in follow-ups for the next two weeks.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Pending actions</h2>
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-container-high px-1 font-caption text-caption font-bold text-primary-container">
                    {s?.open_action_items ?? 0}
                  </span>
                </div>
                <span className="font-caption text-caption text-secondary">Auto-tracked</span>
              </div>
              <div className="divide-y divide-surface-container-highest overflow-hidden rounded-xl bg-surface-container-low shadow-md border border-hairline">
                {!data && (error ? <ErrorState compact message={error} onRetry={reload} /> : <SkeletonRows rows={3} />)}
                {data && data.pending.length === 0 && <EmptyState icon="task_alt" title="All caught up" body="No open action items." />}
                {data?.pending.slice(0, 3).map((item) => {
                  const mine = ownerIsMe(item.owner, profile);
                  const due = item.due_date ? dueLabel(item.due_date) : item.due_text;
                  const overdue = item.due_date ? item.due_date < today : false;
                  return (
                    <div key={item.id} className={`flex items-center justify-between gap-3 p-3.5 transition-colors hover:bg-surface-container ${mine ? 'bg-surface-container/40' : ''}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-caption text-caption font-bold ${
                            mine ? 'bg-primary-container text-on-primary' : 'bg-surface-container-high text-on-surface'
                          }`}
                        >
                          {item.owner ? initials(item.owner) : '–'}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className={`truncate font-label-md text-label-md text-on-surface ${mine ? 'font-semibold' : ''}`} title={`${item.owner ? `${item.owner}: ` : ''}${item.task}`}>
                            {item.owner && !mine ? `${item.owner.split(' ')[0]}: ` : ''}
                            {item.task}
                          </span>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5">
                            {due && (
                              <span
                                className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${
                                  overdue ? 'bg-error-container/40 text-error' : mine ? 'bg-on-tertiary-fixed-variant text-tertiary' : 'bg-on-primary-fixed-variant/30 text-primary-fixed'
                                }`}
                              >
                                {overdue ? `Overdue · ${due}` : `Due ${due}`}
                              </span>
                            )}
                            <span className="min-w-0 truncate font-caption text-caption text-secondary" title={item.meeting ?? undefined}>
                              {mine ? 'You (Owner)' : item.owner ? (item.meeting ?? 'Tracker') : 'Unassigned'}
                            </span>
                          </div>
                        </div>
                      </div>
                      {mine || !item.owner ? (
                        <button
                          type="button"
                          title="Mark Complete"
                          aria-label={`Mark "${item.task}" complete`}
                          disabled={completing !== null}
                          aria-busy={completing === item.id}
                          onClick={() => complete(item)}
                          className="shrink-0 rounded-lg p-1.5 text-primary-container transition-colors hover:bg-surface-container-high disabled:opacity-50"
                        >
                          {completing === item.id ? <Spinner className="text-headline-sm" /> : <Icon name="check_circle" className="text-headline-sm" />}
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Ping on Slack"
                          aria-label={`Ping ${item.owner} on Slack`}
                          onClick={() => ping(item)}
                          className="shrink-0 rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface-container-high hover:text-primary-container"
                        >
                          <Icon name="send" className="text-headline-sm" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <Link href="/tracker" className="group flex items-center justify-between rounded-lg px-1 py-1 font-label-md text-label-md text-secondary transition-colors hover:text-on-surface">
                <span>View all tracker tasks</span>
                <Icon name="arrow_forward" className="text-body-sm transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** A dashboard number that opens the page behind it. */
function StatCard({
  href,
  hint,
  label,
  icon,
  value,
  caption,
  accent = false,
  children,
}: {
  href: string;
  hint: string;
  label: string;
  icon: string;
  value: string | null;
  caption: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={hint}
      className={`tatva-card group relative flex flex-col justify-between overflow-hidden rounded-xl border p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        accent ? 'border-primary-container/25 bg-surface-container-lowest hover:border-primary-container/60' : 'border-hairline bg-surface-container-low hover:border-hairline-strong hover:bg-surface-container'
      }`}
    >
      {accent && <div className="pointer-events-none absolute -bottom-4 -right-4 h-28 w-28 rounded-full bg-primary-container/10 blur-2xl" />}
      <div className="relative flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 font-label-sm text-label-sm uppercase tracking-wider ${accent ? 'text-on-surface-variant' : 'text-secondary'}`}>
          {accent && <span className="h-2 w-2 rounded-full bg-primary-container" />}
          {label}
        </span>
        {/* The icon turns into an arrow on hover: "this opens something". */}
        <span className="relative h-5 w-5 shrink-0">
          <Icon name={icon} className="absolute inset-0 text-body-lg text-secondary transition-all group-hover:-translate-y-1 group-hover:opacity-0" />
          <Icon name="arrow_outward" className="absolute inset-0 translate-y-1 text-body-lg text-primary-container opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100" />
        </span>
      </div>
      <div className="relative my-3 flex h-10 items-center">
        {value === null ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className={`font-heading font-semibold tabular-nums tracking-tight ${accent ? 'text-headline-xl text-primary-container' : 'text-headline-lg text-on-surface'}`}>{value}</span>
        )}
      </div>
      {value === null ? <Skeleton className="h-3 w-3/4" /> : <span className="relative font-caption text-caption text-secondary">{caption}</span>}
      {children && value !== null && <div className="relative mt-2">{children}</div>}
      <span className="sr-only">{hint}</span>
    </Link>
  );
}
