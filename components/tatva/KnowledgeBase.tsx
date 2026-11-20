'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, durationLabel, plural, relativeDateTime, uploadTarget } from '@/lib/tatva';
import type { DashboardData, DocumentRow, MeetingRow, SearchResult } from './types';
import { AttachmentPreview, AttachmentThumb, openAttachment, StatusPill, type Attachment } from './Attachments';
import { EmptyState, ErrorState, Icon, Skeleton, Spinner, useTatvaUi } from './ui';

type Tab = 'all' | 'meetings' | 'documents' | 'attachments';

const sizeLabel = (bytes: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(new Date(iso));

function agoLabel(iso: string | null): string {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function openDocument(id: string, download: boolean) {
  // Open the tab first (keeps the click's user activation), then point it at the signed URL.
  const tab = download ? null : window.open('about:blank', '_blank');
  try {
    const { url } = await api<{ url: string }>(`/documents/${id}/url${download ? '?download=1' : ''}`);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export default function KnowledgeBase() {
  const { toast } = useTatvaUi();
  const meetings = useApi<DashboardData>('/dashboard', { refreshMs: 30_000 });
  const docs = useApi<{ documents: DocumentRow[] }>('/documents', {
    refreshMs: (d) => (d?.documents.some((x) => x.status === 'processing') ? 2000 : 30_000),
  });
  const files = useApi<{ attachments: Attachment[] }>('/attachments', {
    refreshMs: (d) => (d?.attachments.some((x) => x.status === 'processing') ? 2500 : 30_000),
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const meetingList: MeetingRow[] = useMemo(() => (meetings.data?.meetings ?? []).filter((m) => m.status === 'ready'), [meetings.data]);
  const docList = useMemo(() => docs.data?.documents ?? [], [docs.data]);
  const fileList = useMemo(() => files.data?.attachments ?? [], [files.data]);
  const lastIndexed = useMemo(() => {
    const times = [...meetingList.map((m) => m.indexed_at ?? m.recorded_at), ...docList.filter((d) => d.status === 'ready').map((d) => d.updated_at)].filter(Boolean) as string[];
    return times.sort().at(-1) ?? null;
  }, [meetingList, docList]);

  const search = async (q: string) => {
    const clean = q.trim();
    if (!clean) {
      setSearched(null);
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const r = await api<{ results: SearchResult[] }>(`/knowledge/search?q=${encodeURIComponent(clean)}`);
      setResults(r.results);
      setSearched(clean);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSearching(false);
    }
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('Only PDF documents are supported.', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('That PDF is over 25 MB. Upload a smaller file.', 'error');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const target = await uploadTarget();
      const res = await fetch(target.url('/documents'), { method: 'POST', body: form, headers: target.headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
      toast(`Uploaded ${file.name}. Tatva is reading and indexing it…`, 'success');
      setTab((t) => (t === 'meetings' ? 'all' : t));
      docs.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Notify when a document finishes indexing.
  const prevStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const d of docList) {
      const before = prevStatus.current[d.id];
      if (before === 'processing' && d.status === 'ready') toast(`${d.name} is indexed: ${plural(d.chunk_count, 'chunk')}. Pooja can answer from it now.`, 'success');
      if (before === 'processing' && d.status === 'failed') toast(`${d.name} failed: ${d.error}`, 'error');
      prevStatus.current[d.id] = d.status;
    }
  }, [docList, toast]);

  const shownResults = (results ?? []).filter((r) => tab === 'all' || r.kind === tab.replace(/s$/, ''));
  const tabs: { id: Tab; label: string; count: number }[] = searched
    ? [
        { id: 'all', label: 'All', count: results?.length ?? 0 },
        { id: 'meetings', label: 'Meetings', count: results?.filter((r) => r.kind === 'meeting').length ?? 0 },
        { id: 'documents', label: 'Documents', count: results?.filter((r) => r.kind === 'document').length ?? 0 },
        { id: 'attachments', label: 'Attachments', count: results?.filter((r) => r.kind === 'attachment').length ?? 0 },
      ]
    : [
        { id: 'all', label: 'All', count: meetingList.length + docList.length + fileList.length },
        { id: 'meetings', label: 'Meetings', count: meetingList.length },
        { id: 'documents', label: 'Documents', count: docList.length },
        { id: 'attachments', label: 'Attachments', count: fileList.length },
      ];

  const loading = (!meetings.data && !meetings.error) || (!docs.data && !docs.error);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-space-xl px-space-md py-space-xl sm:px-space-xl">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs font-caption text-caption uppercase tracking-widest text-on-surface-variant">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-container" />
            <span>Central Knowledge Graph</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">Knowledge Base</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Everything Tatva knows: your meetings and company documents</p>
        </div>
        <div className="flex items-center gap-space-sm">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
          <button
            type="button"
            disabled={uploading}
            aria-busy={uploading}
            onClick={() => fileRef.current?.click()}
            className="group flex items-center gap-space-sm whitespace-nowrap rounded-[10px] bg-primary-container px-space-lg py-space-sm font-label-md text-label-md text-on-primary transition-all duration-150 hover:bg-primary-fixed disabled:opacity-60"
          >
            {uploading ? <Spinner className="text-headline-sm" /> : <Icon name="upload_file" className="text-headline-sm transition-transform group-hover:-translate-y-0.5" />}
            <span>{uploading ? 'Uploading…' : 'Upload document'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-space-md">
        <form
          role="search"
          className="relative w-full rounded-xl border border-hairline bg-surface-container-low shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-all duration-200 focus-within:border-primary-container/50 focus-within:ring-1 focus-within:ring-primary-container/40 hover:border-hairline-strong"
          onSubmit={(e) => {
            e.preventDefault();
            void search(query);
          }}
        >
          <div className="flex items-center gap-space-sm px-space-md py-space-sm">
            {searching ? <Spinner className="text-headline-sm text-on-surface-variant" /> : <Icon name="search" className="text-headline-sm text-on-surface-variant" />}
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) void search('');
              }}
              className="w-full bg-transparent font-body-lg text-body-lg text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none"
              placeholder="Ask or search across all meetings and documents…"
              aria-label="Search meetings and documents"
              type="text"
            />
            {searched ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  void search('');
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              >
                <Icon name="close" className="text-headline-sm" />
              </button>
            ) : (
              <kbd className="hidden shrink-0 whitespace-nowrap rounded border border-hairline bg-surface-container-high px-1.5 py-0.5 font-mono text-[11px] text-on-surface-variant sm:inline-flex">Ctrl K</kbd>
            )}
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <div role="tablist" aria-label="Knowledge types" className="flex max-w-full items-center gap-space-xs overflow-x-auto rounded-xl border border-hairline bg-surface-container-lowest p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-space-xs whitespace-nowrap rounded-lg px-space-md py-1.5 font-label-md text-label-md transition-colors ${
                  tab === t.id ? 'bg-surface-container text-primary-container shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                }`}
              >
                <span>{t.label}</span>
                <span className={`rounded-full px-1.5 font-caption text-caption ${tab === t.id ? 'bg-surface-container-high text-primary-container' : 'bg-surface-container-low text-on-surface-variant'}`}>{t.count}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-space-md font-caption text-caption text-on-surface-variant">
            {searched ? (
              <span>
                Results for &ldquo;{searched}&rdquo;, ranked by meaning
              </span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${meetings.error || docs.error ? 'bg-error' : 'bg-tertiary-fixed'}`} />
                  {meetings.error || docs.error ? 'Server unreachable' : 'Sync active'}
                </span>
                <span className="hidden sm:inline">Last indexed {agoLabel(lastIndexed)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {searched ? (
        <div className="flex flex-col gap-space-sm">
          {shownResults.length === 0 && <EmptyState icon="search_off" title="Nothing relevant found" body="Try different words, or upload the document that has the answer." />}
          {shownResults.map((r, i) => (
            <div key={`${r.id}-${i}`} className="group flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-md shadow-md transition-colors hover:bg-surface-container border border-hairline">
              <div className="flex items-center justify-between gap-space-sm">
                <div className="flex min-w-0 items-center gap-space-xs">
                  <Icon name={r.kind === 'document' ? 'description' : r.kind === 'attachment' ? 'attach_file' : 'graphic_eq'} className="text-headline-sm text-on-surface-variant" />
                  <span className="truncate font-label-md text-label-md text-on-surface" title={r.title}>{r.title}</span>
                  {r.kind === 'attachment' && <span className="hidden truncate text-caption text-on-surface-variant sm:inline">shared in {r.meeting_title}</span>}
                  <span className="shrink-0 rounded bg-surface-container-highest px-2 py-0.5 font-caption text-caption text-on-surface-variant">
                    {r.kind === 'document' ? `Page ${r.page ?? '?'}` : r.kind === 'attachment' ? (r.page ? `Attachment · p.${r.page}` : 'Attachment') : r.source_type.replace('_', ' ')}
                  </span>
                </div>
                <span className="shrink-0 whitespace-nowrap font-caption text-caption tabular-nums text-tertiary-fixed">{Math.round(r.similarity * 100)}% match</span>
              </div>
              <p className="line-clamp-4 break-words font-body-sm text-body-sm text-on-surface-variant">{r.content}</p>
              <div className="flex justify-end">
                {r.kind === 'attachment' ? (
                  <div className="flex items-center gap-space-md">
                    <button type="button" onClick={() => setPreview(r.id)} className="flex items-center gap-1 font-label-md text-label-md text-on-surface-variant hover:text-on-surface">
                      Preview <Icon name="visibility" className="text-body-sm" />
                    </button>
                    <Link href={`/meetings/${r.meeting_id}`} className="flex items-center gap-1 font-label-md text-label-md text-primary-container hover:text-primary">
                      Open meeting <Icon name="arrow_forward" className="text-body-sm" />
                    </Link>
                  </div>
                ) : r.kind === 'meeting' ? (
                  <Link href={`/meetings/${r.id}`} className="flex items-center gap-1 font-label-md text-label-md text-primary-container hover:text-primary">
                    Open meeting <Icon name="arrow_forward" className="text-body-sm" />
                  </Link>
                ) : (
                  <button type="button" onClick={() => openDocument(r.id, false).catch((e) => toast(e.message, 'error'))} className="flex items-center gap-1 font-label-md text-label-md text-primary-container hover:text-primary">
                    Open PDF <Icon name="open_in_new" className="text-body-sm" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : meetings.error && docs.error && !meetings.data && !docs.data ? (
        <div className="rounded-xl border border-hairline bg-surface-container-low">
          <ErrorState title="Couldn't load the knowledge base" message={meetings.error} onRetry={() => Promise.all([meetings.reload(), docs.reload()])} />
        </div>
      ) : loading ? (
        <div role="status" aria-label="Loading" className="grid grid-cols-1 gap-space-lg md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, n) => (
            <div key={n} className="flex flex-col gap-space-sm overflow-hidden rounded-xl border border-hairline bg-surface-container-low p-space-md">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-14 w-full rounded-lg" />
              <div className="flex justify-between">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-space-lg md:grid-cols-2 lg:grid-cols-3">
          {(tab === 'all' || tab === 'meetings') &&
            meetingList.map((m) => (
              <div key={m.id} className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-hairline bg-surface-container-low shadow-md transition-all duration-200 hover:border-hairline-strong hover:bg-surface-container">
                <Link href={`/meetings/${m.id}`} className="flex flex-col rounded-t-xl hover:opacity-100">
                  <div className="flex items-center justify-between bg-surface-container-lowest px-space-md py-space-sm">
                    <div className="flex items-center gap-space-xs">
                      <Icon name="graphic_eq" className="text-headline-sm text-on-surface-variant" />
                      <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface">Meeting Audio</span>
                    </div>
                    {m.duration_seconds != null && (
                      <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-caption text-caption font-semibold text-primary-fixed">{durationLabel(m.duration_seconds)}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-space-sm p-space-md">
                    <div className="flex flex-col gap-1">
                      <h2 className="truncate font-headline-sm text-headline-sm font-bold text-on-surface transition-colors group-hover:text-primary-container" title={m.title}>
                        {m.title}
                      </h2>
                      <div className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
                        <Icon name="calendar_today" className="text-body-sm" />
                        <span>{relativeDateTime(m.recorded_at)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest/60 p-space-sm border border-hairline">
                      <div className="flex items-center gap-1 font-caption text-caption uppercase tracking-wider text-primary-container">
                        <Icon name="auto_awesome" className="text-body-sm" />
                        <span>AI Summary</span>
                      </div>
                      <p className="line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">{m.summary ?? 'No summary.'}</p>
                    </div>
                  </div>
                </Link>
                <div className="flex items-center justify-between px-space-md pb-space-md pt-0">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-surface-container-highest px-2 py-0.5 font-caption text-caption text-on-surface">{plural(m.action_count, 'action')}</span>
                    <span className="rounded bg-tertiary-container/20 px-2 py-0.5 font-caption text-caption text-tertiary">Ready</span>
                  </div>
                  {m.gdoc_url ? (
                    <a href={m.gdoc_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-label-md text-label-md text-primary-container transition-colors hover:text-primary">
                      <span>Open Google Doc</span>
                      <Icon name="open_in_new" className="text-body-sm" />
                    </a>
                  ) : (
                    <Link href={`/meetings/${m.id}`} className="flex items-center gap-1 font-label-md text-label-md text-primary-container transition-colors hover:text-primary">
                      <span>Open meeting</span>
                      <Icon name="arrow_forward" className="text-body-sm" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          {(tab === 'all' || tab === 'documents') &&
            docList.map((d) => (
              <div key={d.id} className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-hairline bg-surface-container-low shadow-md transition-all duration-200 hover:border-hairline-strong hover:bg-surface-container">
                <div className="flex flex-col">
                  <div className="flex items-center justify-between bg-surface-container-lowest px-space-md py-space-sm">
                    <div className="flex items-center gap-space-xs">
                      <Icon name="description" className="text-headline-sm text-on-surface-variant" />
                      <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">PDF Reference</span>
                    </div>
                    {d.status === 'ready' ? (
                      <div className="flex items-center gap-1 rounded-full bg-tertiary-container/20 px-2 py-0.5 font-caption text-caption font-semibold text-tertiary">
                        <Icon name="check_circle" filled className="text-caption" />
                        <span>Indexed</span>
                      </div>
                    ) : d.status === 'processing' ? (
                      <div className="flex items-center gap-1 rounded-full bg-on-primary-fixed-variant/40 px-2 py-0.5 font-caption text-caption font-semibold text-primary-fixed">
                        <Spinner className="text-caption" />
                        <span>Indexing</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 rounded-full bg-error-container/30 px-2 py-0.5 font-caption text-caption font-semibold text-error" title={d.error ?? undefined}>
                        <Icon name="error" className="text-caption" />
                        <span>Failed</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-space-sm p-space-md">
                    <div className="flex flex-col gap-1">
                      <h2 className="truncate font-headline-sm text-headline-sm font-bold text-on-surface transition-colors group-hover:text-primary-container" title={d.name}>
                        {d.name}
                      </h2>
                      <div className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
                        <Icon name="cloud_upload" className="text-body-sm" />
                        <span>
                          Uploaded {dayLabel(d.created_at)}
                          {d.pages ? ` · ${plural(d.pages, 'page')}` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-lowest/60 p-space-sm border border-hairline">
                      <div className="flex items-center gap-1 font-caption text-caption uppercase tracking-wider text-on-surface-variant">
                        <Icon name="article" className="text-body-sm" />
                        <span>Content Scope</span>
                      </div>
                      <p className="line-clamp-2 font-body-sm text-body-sm text-on-surface-variant">
                        {d.status === 'failed' ? d.error : d.status === 'processing' ? 'Reading the PDF and creating embeddings…' : (d.summary ?? '')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between px-space-md pb-space-md pt-0">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-surface-container-highest px-2 py-0.5 font-caption text-caption text-on-surface">{d.status === 'ready' ? plural(d.chunk_count, 'chunk') : 'PDF'}</span>
                    <span className="rounded bg-surface-container-highest px-2 py-0.5 font-caption text-caption text-on-surface">{sizeLabel(d.bytes)}</span>
                  </div>
                  <div className="flex items-center gap-space-xs">
                    <button type="button" title="Preview" aria-label={`Preview ${d.name}`} onClick={() => openDocument(d.id, false).catch((e) => toast(e.message, 'error'))} className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary-container">
                      <Icon name="visibility" className="text-headline-sm" />
                    </button>
                    <button type="button" title="Download" aria-label={`Download ${d.name}`} onClick={() => openDocument(d.id, true).catch((e) => toast(e.message, 'error'))} className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary-container">
                      <Icon name="download" className="text-headline-sm" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          {(tab === 'all' || tab === 'attachments') &&
            fileList.map((a) => (
              <div key={a.id} className="group relative flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface-container-low shadow-md transition-all duration-200 hover:border-hairline-strong hover:bg-surface-container">
                <button type="button" onClick={() => setPreview(a.id)} aria-label={`Preview ${a.name}`} className="relative block aspect-[16/9] w-full overflow-hidden rounded-t-xl border-b border-hairline bg-surface-container-lowest hover:brightness-110">
                  <AttachmentThumb a={a} className="transition-transform duration-300 group-hover:scale-[1.02]" />
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-caption text-on-surface backdrop-blur">
                    <Icon name="attach_file" className="text-[12px]" /> Attachment
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-black/75 backdrop-blur">
                    <StatusPill a={a} />
                  </span>
                </button>
                <div className="flex flex-1 flex-col gap-space-sm p-space-md">
                  <div className="flex flex-col gap-1">
                    <h2 className="truncate text-headline-sm text-on-surface" title={a.name}>
                      {a.name}
                    </h2>
                    <Link href={`/meetings/${a.meeting_id}`} title={`Shared in ${a.meeting_title}`} className="flex w-fit max-w-full items-center gap-1.5 truncate rounded text-body-sm text-on-surface-variant hover:text-on-surface">
                      <Icon name="graphic_eq" className="text-body-sm" />
                      <span className="truncate">Shared in {a.meeting_title}</span>
                    </Link>
                  </div>
                  <p className="line-clamp-2 text-body-sm text-on-surface-variant">
                    {a.status === 'failed' ? a.error : a.status === 'processing' ? 'Reading and indexing…' : a.summary}
                  </p>
                  <div className="mt-auto flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-surface-container-highest px-2 py-0.5 text-caption tabular-nums text-on-surface">{sizeLabel(a.bytes)}</span>
                      <span className="rounded bg-surface-container-highest px-2 py-0.5 text-caption capitalize text-on-surface">{a.kind === 'pdf' ? 'PDF' : (a.label ?? 'image')}</span>
                    </div>
                    <div className="flex items-center gap-space-xs">
                      <button type="button" title="Preview" aria-label={`Preview ${a.name}`} onClick={() => setPreview(a.id)} className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface">
                        <Icon name="visibility" className="text-headline-sm" />
                      </button>
                      <button type="button" title="Download" aria-label={`Download ${a.name}`} onClick={() => openAttachment(a.id, true).catch((e) => toast(e.message, 'error'))} className="rounded-md p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface">
                        <Icon name="download" className="text-headline-sm" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          {((tab === 'documents' && docList.length === 0) ||
            (tab === 'meetings' && meetingList.length === 0) ||
            (tab === 'attachments' && fileList.length === 0) ||
            (tab === 'all' && meetingList.length + docList.length + fileList.length === 0)) && (
            <div className="md:col-span-2 lg:col-span-3">
              <EmptyState
                icon={tab === 'documents' ? 'upload_file' : tab === 'attachments' ? 'attach_file' : 'mic_none'}
                title={tab === 'documents' ? 'No documents yet' : tab === 'attachments' ? 'No attachments yet' : 'Nothing here yet'}
                body={
                  tab === 'documents'
                    ? 'Upload an SOP or project plan (PDF) and Pooja can answer from it.'
                    : tab === 'attachments'
                      ? 'Open a meeting and drop or paste the slides and screenshots shared in it.'
                      : 'Record a meeting or upload a PDF.'
                }
              />
            </div>
          )}
        </div>
      )}

      {preview && <AttachmentPreview id={preview} onClose={() => setPreview(null)} />}

      <div className="flex items-center justify-center pb-space-2xl pt-space-lg">
        <div className="flex items-center gap-space-xs rounded-full bg-surface-container-low px-space-md py-space-sm text-center font-body-sm text-body-sm text-on-surface-variant shadow-sm">
          <Icon name="lightbulb" className="text-body-md text-on-surface-variant" />
          <span>Tip: record a meeting with the Tatva extension and it appears here automatically.</span>
        </div>
      </div>
    </div>
  );
}
