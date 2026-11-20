'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, clock, dueLabel, durationLabel, eventDateTime, initials, minutesLabel, plural, relativeDateTime } from '@/lib/tatva';
import type { Contact, MeetingDetail } from './types';
import { MeetingAttachments } from './Attachments';
import { RetryMeetingButton } from './Dashboard';
import { ComingSoon, EmptyState, ErrorState, Field, Icon, inputClass, Skeleton, Spinner, useTatvaUi } from './ui';

const BARS = 64;
const SPEEDS = [1, 1.25, 1.5, 2];
const SECTION_OPTIONS = [
  { id: 'summary', label: 'Summary' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'action_items', label: 'Action items' },
  { id: 'discuss_later', label: 'Discuss later' },
  { id: 'stats', label: 'Numbers' },
];

/** ISO instant -> "YYYY-MM-DDTHH:mm" in IST, for <input type="datetime-local">. */
function toLocalInput(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date(Date.now() + 2 * 86_400_000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${iso ? p.hour : '11'}:${iso ? p.minute : '00'}`;
}

function SectionPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-space-xs">
      {SECTION_OPTIONS.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            className={`rounded-full px-3 py-1.5 font-label-sm text-label-sm transition-colors ${on ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Peaks of the decoded recording, normalised to 0..1. */
async function computePeaks(url: string, bars: number): Promise<number[]> {
  const buffer = await (await fetch(url)).arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buffer);
    const data = audio.getChannelData(0);
    const size = Math.floor(data.length / bars) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = i * size; j < Math.min((i + 1) * size, data.length); j++) sum += data[j] * data[j];
      peaks.push(Math.sqrt(sum / size));
    }
    const max = Math.max(...peaks, 1e-6);
    return peaks.map((p) => Math.max(0.08, p / max));
  } finally {
    void ctx.close();
  }
}

export default function MeetingDetails({ id }: { id: string }) {
  const { runAction, confirm, toast } = useTatvaUi();
  const { data, error, reload } = useApi<{ meeting: MeetingDetail }>(`/meetings/${id}`, {
    refreshMs: (d) => (d && d.meeting.status !== 'ready' && d.meeting.status !== 'failed' ? 3000 : undefined),
  });
  const contacts = useApi<{ contacts: Contact[] }>('/contacts');
  const m = data?.meeting;

  // ------------------------------------------------------------- audio
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!m?.audio_path) return;
    let live = true;
    api<{ url: string }>(`/meetings/${id}/audio`)
      .then((r) => {
        if (!live) return;
        setAudioUrl(r.url);
        computePeaks(r.url, BARS)
          .then((p) => live && setPeaks(p))
          .catch(() => live && setPeaks(null));
      })
      .catch((e) => live && setAudioError(e.message));
    return () => {
      live = false;
    };
  }, [id, m?.audio_path]);

  const total = duration || Number(m?.duration_seconds ?? 0);
  const seek = useCallback(
    (seconds: number, play = true) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min(seconds, total || seconds));
      setTime(a.currentTime);
      if (play) void a.play().catch(() => {});
    },
    [total],
  );
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch((e) => toast(`Can't play the recording: ${e.message}`, 'error'));
    else a.pause();
  };

  // ------------------------------------------------------------ transcript
  const [query, setQuery] = useState('');
  const segments = useMemo(() => m?.transcript_segments ?? [], [m]);
  const moments = useMemo(() => [...(m?.key_moments ?? [])].sort((a, b) => a.timestamp_sec - b.timestamp_sec), [m]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments;
  }, [segments, query]);
  const activeIndex = segments.findIndex((s) => time >= Number(s.start_sec) && time < Number(s.end_sec));
  const momentFor = (s: { start_sec: number; end_sec: number }) => moments.find((k) => k.timestamp_sec >= Number(s.start_sec) && k.timestamp_sec < Number(s.end_sec));
  const lineRefs = useRef<Map<number, HTMLElement>>(new Map());

  // ------------------------------------------------------------- actions
  const contactList = contacts.data?.contacts ?? [];

  const openDoc = () => {
    if (!m) return;
    if (m.gdoc_url) {
      window.open(m.gdoc_url, '_blank', 'noopener');
      void api(`/meetings/${id}/gdoc/opened`, { method: 'POST', json: {} }).catch(() => {});
      return;
    }
    confirm({
      title: 'Create Google Doc',
      icon: 'description',
      confirmLabel: 'Create doc',
      body: `This meeting has no Google Doc yet. Tatva will create "Tatva: ${m.title ?? 'Meeting'}" in your Google Drive with the summary, decisions, action items and transcript.`,
      run: async () => {
        const r = await api<{ url: string }>(`/meetings/${id}/gdoc`, { method: 'POST', json: {} });
        window.open(r.url, '_blank', 'noopener');
        reload();
        return 'Google Doc created.';
      },
    });
  };

  const sendEmail = () =>
    runAction({
      kind: 'send_email',
      title: 'Send by email',
      icon: 'mail',
      confirmLabel: 'Send email',
      input: { to: contactList[0]?.name ?? '', meeting: id, sections: ['summary', 'decisions', 'action_items'] },
      fields: (set, input) => (
        <>
          <Field label="Recipient">
            <select className={inputClass} value={String(input.to ?? '')} onChange={(e) => set({ to: e.target.value })}>
              {contactList.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} · {c.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Include">
            <SectionPicker value={(input.sections as string[]) ?? []} onChange={(v) => set({ sections: v })} />
          </Field>
        </>
      ),
    });

  const sendSlack = () =>
    runAction({
      kind: 'post_to_slack',
      title: 'Send to Slack',
      icon: 'send',
      confirmLabel: 'Post to Slack',
      input: { meeting: id, sections: ['summary', 'decisions', 'action_items'] },
      fields: (set, input) => (
        <Field label="Include">
          <SectionPicker value={(input.sections as string[]) ?? []} onChange={(v) => set({ sections: v })} />
        </Field>
      ),
    });

  const addToCalendar = (d: MeetingDetail['discuss_later'][number]) =>
    runAction({
      kind: 'create_calendar_event',
      title: 'Add to Calendar',
      icon: 'event',
      confirmLabel: 'Create event',
      input: {
        title: d.topic.replace(/^./, (c) => c.toUpperCase()),
        start: toLocalInput(d.suggested_at),
        duration_minutes: 30,
        attendees: d.people,
        discuss_later_id: d.id,
        skip_unknown_attendees: true,
        description: `Follow-up from "${m?.title ?? 'a meeting'}". Scheduled by Tatva.`,
      },
      fields: (set, input) => (
        <>
          <Field label="Start" note="IST">
            <input type="datetime-local" className={inputClass} value={String(input.start)} onChange={(e) => set({ start: e.target.value })} />
          </Field>
          <Field label="Duration">
            <select className={inputClass} value={Number(input.duration_minutes)} onChange={(e) => set({ duration_minutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} minutes
                </option>
              ))}
            </select>
          </Field>
          {d.people.length > 0 && (
            <p className="font-caption text-caption text-on-surface-variant">
              Invites go to people in your contacts ({d.people.join(', ')}); anyone not in contacts is left out.
            </p>
          )}
        </>
      ),
      onDone: (r) => r.ok && reload(),
    });

  // ---------------------------------------------------------------- render
  if (error && !m)
    return /not found|404|invalid input syntax/i.test(error) ? (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-space-md p-space-xl text-center">
        <EmptyState icon="search_off" title="This meeting doesn't exist" body="It may have been deleted, or the link is incomplete." />
        <Link href="/meetings" className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-5 py-2.5 text-label-md font-semibold text-on-primary hover:bg-primary-fixed">
          <Icon name="arrow_back" className="text-body-lg" />
          All meetings
        </Link>
      </div>
    ) : (
      <div className="p-space-xl">
        <ErrorState title="Couldn't load this meeting" message={error} onRetry={reload} />
      </div>
    );
  if (!m) return <MeetingSkeleton />;

  const title = m.title ?? m.source_title ?? 'Untitled meeting';
  const ready = m.status === 'ready';
  const played = total ? time / total : 0;
  const openItems = m.action_items.filter((a) => a.status === 'open').length;

  return (
    <div className="flex w-full flex-col">
      <div className="flex flex-col gap-space-xl px-space-md py-space-lg sm:px-space-xl">
        <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-center">
          <div className="flex flex-col gap-space-xs">
            <Link href="/meetings" className="group inline-flex w-fit items-center gap-space-xs rounded-md font-label-md text-label-md text-on-surface-variant transition-colors hover:text-primary">
              <Icon name="arrow_back" className="text-body-lg transition-transform group-hover:-translate-x-1" />
              <span>Back to Meetings</span>
            </Link>
            <div className="mt-space-xs flex flex-wrap items-center gap-space-md">
              <h1 className="break-words font-headline-xl text-headline-xl font-extrabold tracking-tight text-on-surface">{title}</h1>
              <div className="flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-1">
                <span className={`h-2 w-2 rounded-full ${ready ? 'bg-tertiary-fixed' : m.status === 'failed' ? 'bg-error' : 'animate-pulse bg-primary-container'}`} />
                <span className={`font-label-sm text-label-sm font-semibold uppercase tracking-wider ${ready ? 'text-tertiary' : m.status === 'failed' ? 'text-error' : 'text-primary-fixed'}`}>
                  {ready ? 'Ready' : m.status === 'failed' ? 'Failed' : m.status}
                </span>
              </div>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant">
              {[relativeDateTime(m.recorded_at ?? m.created_at), durationLabel(m.duration_seconds), plural(m.action_items.length, 'action item')].filter(Boolean).join(' · ')}
            </p>
          </div>
          {ready && (
            <div className="flex flex-wrap items-center gap-space-sm self-start md:self-center">
              {/* Flagship: talk to Pooja about this meeting only (meeting mode). */}
              <Link
                href={`/talk?meeting=${m.id}`}
                className="inline-flex items-center gap-space-xs rounded-lg bg-primary-container px-space-md py-space-sm font-label-md text-label-md text-on-primary-fixed shadow-sm transition-all hover:bg-primary-fixed active:scale-[0.98]"
              >
                <Icon name="graphic_eq" className="text-body-lg" />
                <span className="font-bold">Ask Tatva about this meeting</span>
              </Link>
              <button type="button" onClick={openDoc} className="inline-flex items-center gap-space-xs rounded-lg border border-hairline bg-surface-container px-space-md py-space-sm font-label-md text-label-md text-on-surface shadow-sm transition-all hover:border-hairline-strong hover:bg-surface-container-high">
                <Icon name="description" className="text-body-lg text-on-surface-variant" />
                <span>{m.gdoc_url ? 'Open Google Doc' : 'Create Google Doc'}</span>
              </button>
              <button type="button" onClick={sendEmail} className="inline-flex items-center gap-space-xs rounded-lg border border-hairline bg-surface-container px-space-md py-space-sm font-label-md text-label-md text-on-surface shadow-sm transition-all hover:border-hairline-strong hover:bg-surface-container-high">
                <Icon name="mail" className="text-body-lg text-on-surface-variant" />
                <span>Send by email</span>
              </button>
              <button type="button" onClick={sendSlack} className="inline-flex items-center gap-space-xs rounded-lg border border-hairline bg-surface-container px-space-md py-space-sm font-label-md text-label-md text-on-surface shadow-sm transition-all hover:border-hairline-strong hover:bg-surface-container-high">
                <Icon name="send" className="text-body-lg text-on-surface-variant" />
                <span>Send to Slack</span>
              </button>
            </div>
          )}
        </div>

        {!ready && (
          <div className="flex items-center gap-space-sm rounded-xl bg-surface-container-low p-space-md text-on-surface-variant border border-hairline">
            {m.status === 'failed' ? <Icon name="error" className="text-error" /> : <Spinner />}
            <span className="min-w-0 flex-1 font-body-md text-body-md">{m.status === 'failed' ? `Processing failed: ${m.error ?? 'unknown error'}` : `Processing: ${m.status}… this page updates automatically.`}</span>
            {m.status === 'failed' && m.audio_path && <RetryMeetingButton meetingId={m.id} onRetried={reload} className="shrink-0 py-space-sm" />}
          </div>
        )}

        {/* Audio player */}
        {m.audio_path && (
          <div className="relative flex flex-col items-center gap-space-lg overflow-hidden rounded-xl bg-surface-container-lowest p-space-md shadow-2xl md:flex-row border border-hairline">
            {audioUrl && (
              <audio
                ref={audioRef}
                src={audioUrl}
                preload="metadata"
                onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
                onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setAudioError('The recording could not be loaded.')}
              />
            )}
            <div className="flex shrink-0 items-center gap-space-sm">
              <button type="button" title="Rewind 10s" aria-label="Rewind 10 seconds" disabled={!audioUrl} onClick={() => seek(time - 10, playing)} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container text-on-surface transition-colors hover:bg-surface-container-high hover:text-primary-container disabled:opacity-40">
                <Icon name="replay_10" className="text-body-lg" />
              </button>
              <button
                type="button"
                aria-label={playing ? 'Pause' : 'Play'}
                disabled={!audioUrl}
                onClick={toggle}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container text-on-primary-fixed transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
              >
                {audioUrl ? <Icon name={playing ? 'pause' : 'play_arrow'} className="text-headline-sm" filled /> : <Spinner className="text-headline-sm" />}
              </button>
              <button type="button" title="Forward 10s" aria-label="Forward 10 seconds" disabled={!audioUrl} onClick={() => seek(time + 10, playing)} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container text-on-surface transition-colors hover:bg-surface-container-high hover:text-primary-container disabled:opacity-40">
                <Icon name="forward_10" className="text-body-lg" />
              </button>
            </div>
            <div className="relative flex w-full flex-1 select-none flex-col justify-center gap-1.5">
              <div
                className="relative flex h-12 w-full cursor-pointer items-center gap-0.5 rounded-md px-1 hover:bg-surface-container/40"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (total) seek(((e.clientX - rect.left) / rect.width) * total, playing);
                }}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                aria-valuenow={Math.round(time)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') seek(time + 5, playing);
                  if (e.key === 'ArrowLeft') seek(time - 5, playing);
                }}
              >
                {total > 0 && (
                  <div className="absolute bottom-0 top-0 z-20 w-0.5 bg-primary-container" style={{ left: `${played * 100}%` }}>
                    <div className="absolute -top-1 -ml-1 h-2.5 w-2.5 rounded-full bg-primary-container" />
                  </div>
                )}
                {total > 0 &&
                  moments.map((k) => (
                    <button
                      key={`${k.timestamp_sec}-${k.note}`}
                      type="button"
                      aria-label={`Jump to ${clock(k.timestamp_sec)}: ${k.note}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        seek(k.timestamp_sec);
                      }}
                      className="group absolute -top-2 z-30 -translate-x-1/2 rounded-full p-1 hover:bg-primary-container/20"
                      style={{ left: `${Math.min(100, (k.timestamp_sec / total) * 100)}%` }}
                    >
                      <span className="block h-2 w-2 rounded-full bg-primary-container transition-transform group-hover:scale-125" />
                      <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-surface-container-high px-2 py-0.5 font-caption text-caption text-primary-container opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {clock(k.timestamp_sec)} · {k.note.length > 40 ? `${k.note.slice(0, 40)}…` : k.note}
                      </span>
                    </button>
                  ))}
                <div className="flex h-full w-full items-center justify-between gap-[3px]">
                  {(peaks ?? Array.from({ length: BARS }, () => 0.15)).map((p, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-full transition-colors ${i / BARS < played ? 'bg-primary-container' : 'bg-secondary-container hover:bg-on-surface-variant'} ${peaks ? '' : 'animate-pulse'}`}
                      style={{ height: `${Math.round(p * 100)}%` }}
                    />
                  ))}
                </div>
              </div>
              {audioError && <p className="font-caption text-caption text-error">{audioError}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-space-md">
              <span className="whitespace-nowrap font-mono text-label-md tracking-tight text-on-surface">
                {clock(time)} <span className="font-normal text-on-surface-variant">/ {clock(total)}</span>
              </span>
              <button
                type="button"
                title="Playback speed"
                onClick={() => {
                  const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                  setSpeed(next);
                  if (audioRef.current) audioRef.current.playbackRate = next;
                }}
                className="flex items-center gap-space-xs rounded-md bg-surface-container px-2.5 py-1 text-label-sm font-bold tabular-nums text-primary-container hover:bg-surface-container-high"
              >
                {speed.toFixed(speed % 1 ? 2 : 1)}x
              </button>
              <button
                type="button"
                title={muted ? 'Unmute' : 'Mute'}
                aria-label={muted ? 'Unmute' : 'Mute'}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  if (audioRef.current) audioRef.current.muted = next;
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
              >
                <Icon name={muted ? 'volume_off' : 'volume_up'} className="text-body-lg" />
              </button>
            </div>
          </div>
        )}

        {ready && (
          <div className="grid grid-cols-1 gap-space-xl lg:grid-cols-12">
            <div className="flex flex-col gap-space-xl lg:col-span-8">
              <div className="relative flex flex-col gap-space-md overflow-hidden rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-xs">
                    <Icon name="auto_awesome" className="text-headline-sm text-on-surface-variant" filled />
                    <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Executive Summary</h2>
                  </div>
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">AI Generated</span>
                </div>
                <p className="font-body-lg text-body-lg leading-relaxed text-on-surface-variant">{m.summary ?? 'No summary.'}</p>
              </div>

              <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex items-center gap-space-sm">
                  <Icon name="gavel" className="text-headline-sm text-on-surface-variant" />
                  <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Key Decisions ({m.decisions.length})</h2>
                </div>
                {m.decisions.length === 0 ? (
                  <p className="font-body-md text-body-md text-on-surface-variant">No decisions were recorded in this meeting.</p>
                ) : (
                  <div className="flex flex-col gap-space-sm">
                    {m.decisions.map((d, i) => (
                      <div key={i} className="flex items-start gap-space-md rounded-lg bg-surface-container p-space-md border border-hairline">
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-fixed">
                          <Icon name="check" className="text-body-sm font-black" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <p className="font-body-md text-body-md font-semibold text-on-surface">{d.decision}</p>
                          {d.context && <p className="font-caption text-caption text-on-surface-variant">{d.context}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-sm">
                    <Icon name="task_alt" className="text-headline-sm text-on-surface-variant" />
                    <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Action Items ({m.action_items.length})</h2>
                  </div>
                  <button type="button" disabled title="Coming soon" className="inline-flex items-center gap-space-xs whitespace-nowrap font-label-sm text-label-sm text-on-surface-variant">
                    <Icon name="ios_share" className="text-body-md" />
                    <span>Export Jira/Asana</span>
                    <ComingSoon />
                  </button>
                </div>
                {m.action_items.length === 0 ? (
                  <p className="font-body-md text-body-md text-on-surface-variant">No action items.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-body-md text-body-md">
                      <thead>
                        <tr className="bg-surface-container-lowest font-caption text-caption uppercase tracking-wider text-on-surface-variant">
                          <th className="rounded-l-lg px-space-md py-space-sm">Task</th>
                          <th className="px-space-md py-space-sm">Owner</th>
                          <th className="px-space-md py-space-sm">Due</th>
                          <th className="rounded-r-lg px-space-md py-space-sm">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.action_items.map((a) => (
                          <tr key={a.id} className="transition-colors hover:bg-surface-container">
                            <td className={`px-space-md py-space-md font-medium ${a.status === 'done' ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}>{a.task}</td>
                            <td className="px-space-md py-space-md">
                              {a.owner ? (
                                <div className="flex items-center gap-space-xs whitespace-nowrap">
                                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-label-sm text-label-sm font-bold text-primary-container">{initials(a.owner)}</div>
                                  <span className="font-body-sm text-body-sm text-on-surface">{a.owner}</span>
                                </div>
                              ) : (
                                <span className="font-body-sm text-body-sm text-on-surface-variant">Unassigned</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-space-md py-space-md text-body-sm tabular-nums text-on-surface-variant">{a.due_date ? dueLabel(a.due_date) : (a.due_text ?? '—')}</td>
                            <td className="px-space-md py-space-md">
                              {a.status === 'done' ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-sm text-label-sm font-semibold text-tertiary">
                                  <span className="h-1.5 w-1.5 rounded-full bg-tertiary-fixed" />
                                  Done
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-0.5 font-label-sm text-label-sm font-semibold text-surface-tint">
                                  <span className="h-1.5 w-1.5 rounded-full bg-surface-tint" />
                                  Pending
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <MeetingAttachments meetingId={id} meetingTitle={title} />

              <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex flex-col justify-between gap-space-sm sm:flex-row sm:items-center">
                  <div className="flex items-center gap-space-sm">
                    <Icon name="graphic_eq" className="text-headline-sm text-on-surface-variant" />
                    <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Transcript</h2>
                  </div>
                  <div className="flex w-full items-center gap-space-xs rounded-lg border border-hairline bg-surface-container-lowest px-3 py-1.5 hover:border-hairline-strong focus-within:ring-1 focus-within:ring-primary-container sm:max-w-xs">
                    <Icon name="search" className="text-body-md text-on-surface-variant" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full border-none bg-transparent font-body-sm text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
                      placeholder="Search transcript…"
                      aria-label="Search transcript"
                      type="search"
                    />
                    {query && <span className="shrink-0 font-caption text-caption text-on-surface-variant">{shown.length}</span>}
                  </div>
                </div>
                <div className="mt-space-xs flex max-h-[560px] flex-col gap-space-sm overflow-y-auto pr-1">
                  {shown.length === 0 && <p className="font-body-md text-body-md text-on-surface-variant">{query ? 'No lines match your search.' : 'No transcript.'}</p>}
                  {shown.map((s) => {
                    const moment = momentFor(s);
                    const active = segments.indexOf(s) === activeIndex;
                    if (moment)
                      return (
                        <button
                          type="button"
                          key={s.position}
                          ref={(el) => {
                            if (el) lineRefs.current.set(s.position, el);
                          }}
                          onClick={() => seek(Number(s.start_sec))}
                          title={`Play from ${clock(Number(s.start_sec))}`}
                          className={`flex w-full flex-col gap-1 rounded-lg bg-surface-container-high p-space-md text-left hover:bg-surface-bright ${active ? 'ring-1 ring-primary-container' : 'hover:ring-1 hover:ring-primary-container/40'}`}
                        >
                          <div className="flex items-center justify-between gap-space-sm">
                            <span className="shrink-0 font-mono text-body-sm font-bold text-primary-container">{clock(Number(s.start_sec))}</span>
                            <span className="inline-flex min-w-0 items-center gap-1 rounded bg-primary-container px-2 py-0.5 font-caption text-caption font-bold uppercase tracking-wide text-on-primary-fixed" title={moment.note}>
                              <Icon name="verified" className="shrink-0 text-caption" />
                              <span className="truncate">Key moment: {moment.note}</span>
                            </span>
                          </div>
                          <p className="mt-1 font-body-md text-body-md font-medium leading-relaxed text-primary">{s.text}</p>
                        </button>
                      );
                    return (
                      <button
                        type="button"
                        key={s.position}
                        onClick={() => seek(Number(s.start_sec))}
                        title={`Play from ${clock(Number(s.start_sec))}`}
                        className={`group flex w-full items-start gap-space-md rounded-lg p-space-sm text-left transition-colors hover:bg-surface-container ${active ? 'bg-surface-container' : ''}`}
                      >
                        <span className={`mt-0.5 shrink-0 font-mono text-body-sm group-hover:text-primary-container ${active ? 'text-primary-container' : 'text-on-surface-variant'}`}>{clock(Number(s.start_sec))}</span>
                        <p className={`font-body-md text-body-md leading-relaxed group-hover:text-on-surface ${active ? 'text-on-surface' : 'text-on-surface-variant'}`}>{s.text}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-space-xl lg:col-span-4">
              <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">Numbers Mentioned</h3>
                  <Icon name="tag" className="text-body-lg text-on-surface-variant" />
                </div>
                {m.stats_mentioned.length === 0 ? (
                  <p className="font-body-sm text-body-sm text-on-surface-variant">No figures were mentioned.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-space-sm">
                    {m.stats_mentioned.map((st, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={st.timestamp_sec == null || !audioUrl}
                        onClick={() => st.timestamp_sec != null && seek(st.timestamp_sec)}
                        title={st.timestamp_sec != null ? `Play from ${clock(st.timestamp_sec)}` : undefined}
                        className="flex items-center justify-between rounded-lg border border-hairline bg-surface-container p-space-md text-left shadow-sm transition-colors enabled:hover:border-hairline-strong enabled:hover:bg-surface-container-high disabled:!cursor-default disabled:!opacity-100"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span
                            className={`break-words font-heading font-bold tabular-nums tracking-tight text-primary-container ${
                              st.value.length <= 10 ? 'font-headline-lg text-headline-lg' : st.value.length <= 18 ? 'font-headline-md text-headline-md' : 'font-headline-sm text-headline-sm'
                            }`}
                          >
                            {st.value}
                          </span>
                          <span className="font-body-sm text-body-sm text-on-surface-variant">{st.context}</span>
                        </div>
                        {st.timestamp_sec != null && <Icon name="play_arrow" className="text-on-surface-variant" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">Key Moments</h3>
                  <span className="font-label-sm text-label-sm uppercase text-on-surface-variant">{plural(moments.length, 'marker')}</span>
                </div>
                <div className="flex flex-col gap-space-xs">
                  {moments.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">No key moments.</p>}
                  {moments.map((k, i) => {
                    const next = moments[i + 1]?.timestamp_sec ?? Infinity;
                    const current = time >= k.timestamp_sec && time < next && time > 0;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => seek(k.timestamp_sec)}
                        className={`group flex items-center justify-between gap-space-sm rounded-lg p-space-sm text-left transition-colors ${current ? 'bg-surface-container-high shadow-sm' : 'bg-surface-container hover:bg-surface-container-high'}`}
                      >
                        <div className="flex min-w-0 items-center gap-space-sm">
                          <span className="shrink-0 rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-body-sm text-on-surface-variant">{clock(k.timestamp_sec)}</span>
                          <span className={`font-body-sm text-body-sm transition-colors group-hover:text-primary ${current ? 'font-semibold text-primary' : 'text-on-surface'}`}>{k.note}</span>
                        </div>
                        <Icon name="play_arrow" className={`text-body-sm ${current ? 'text-primary-container' : 'text-on-surface-variant group-hover:text-primary-container'}`} filled={current} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-space-md rounded-xl bg-surface-container-low p-space-lg shadow-md border border-hairline">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">Discuss Later</h3>
                  <Icon name="schedule" className="text-body-lg text-on-surface-variant" />
                </div>
                <div className="flex flex-col gap-space-sm">
                  {m.discuss_later.length === 0 && <p className="font-body-sm text-body-sm text-on-surface-variant">Nothing was parked for later.</p>}
                  {m.discuss_later.map((d) => (
                    <div key={d.id} className="flex flex-col gap-space-sm rounded-lg bg-surface-container p-space-md border border-hairline">
                      <div className="flex items-start justify-between gap-space-sm">
                        <div>
                          <h4 className="font-label-md text-label-md font-bold text-on-surface">{d.topic.replace(/^./, (c) => c.toUpperCase())}</h4>
                          <p className="mt-0.5 font-caption text-caption text-on-surface-variant">
                            Suggested: {d.suggested_at ? eventDateTime(d.suggested_at) : (d.suggested_time_text ?? 'no time given')}
                            {d.suggested_at && !d.suggested_time_text ? ' (default)' : ''}
                          </p>
                        </div>
                        <div className="flex -space-x-1.5 overflow-hidden">
                          {d.people.slice(0, 3).map((p) => (
                            <div key={p} title={p} className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-container-highest font-caption text-caption font-bold text-primary-container ring-1 ring-surface-container">
                              {initials(p)}
                            </div>
                          ))}
                        </div>
                      </div>
                      {d.status === 'open' ? (
                        <button
                          type="button"
                          onClick={() => addToCalendar(d)}
                          className="flex w-full items-center justify-center gap-1 rounded bg-primary-container px-space-sm py-1.5 font-label-sm text-label-sm font-bold text-on-primary-fixed transition-all hover:bg-primary-fixed"
                        >
                          <Icon name="event" className="text-body-sm" />
                          <span>Add to Calendar</span>
                        </button>
                      ) : (
                        <span className="flex items-center justify-center gap-1 rounded bg-surface-container-high py-1.5 font-label-sm text-label-sm text-tertiary">
                          <Icon name="event_available" className="text-body-sm" />
                          {d.status === 'scheduled' ? 'Scheduled' : 'Done'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative flex items-center justify-between overflow-hidden rounded-xl bg-surface-container-lowest p-space-lg shadow-xl border border-hairline">
                <div className="z-10 flex flex-col gap-0.5">
                  <span className="font-caption text-caption font-semibold uppercase tracking-widest text-on-surface-variant">Time saved by Tatva</span>
                  <span className="font-heading text-headline-xl font-semibold tabular-nums tracking-tight text-primary-container">~{minutesLabel(m.time_saved_minutes ?? 0)}</span>
                  <p className="font-caption text-caption text-secondary-fixed-dim">
                    {m.time_saved_breakdown.length ? m.time_saved_breakdown.map((b) => `${b.task} (${b.minutes} min)`).join(', ') : 'Notes and captured items'}
                  </p>
                </div>
                <div className="z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary-container">
                  <Icon name="bolt" className="text-headline-sm" filled />
                </div>
              </div>
              {openItems > 0 && (
                <Link href={`/talk?meeting=${m.id}`} className="flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-container-low px-space-md py-space-sm font-label-md text-label-md text-on-surface transition-colors hover:border-hairline-strong hover:bg-surface-container">
                  <Icon name="graphic_eq" className="text-on-surface-variant" />
                  Ask Tatva about this meeting
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Placeholder while a meeting loads: header, player and the two-column body. */
function MeetingSkeleton() {
  return (
    <div role="status" aria-label="Loading meeting" className="flex flex-col gap-space-xl px-space-md py-space-lg sm:px-space-xl">
      <div className="flex flex-col gap-space-sm">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-2/3 max-w-lg" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-space-xl lg:grid-cols-12">
        <div className="flex flex-col gap-space-xl lg:col-span-8">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-space-xl lg:col-span-4">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
