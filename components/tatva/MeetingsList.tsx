'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { MeetingListRow } from './Dashboard';
import { PROCESSING, type DashboardData } from './types';
import { EmptyState, ErrorState, Icon, SkeletonRows } from './ui';

const SORTS = [
  { id: 'newest', label: 'Newest', icon: 'schedule' },
  { id: 'time_saved', label: 'Time saved', icon: 'timer' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

export default function MeetingsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The sort lives in the URL (?sort=time_saved), so the dashboard's
  // "Time saved" card can link straight to it.
  const sort: SortId = params.get('sort') === 'time_saved' ? 'time_saved' : 'newest';
  const setSort = (next: SortId) => router.replace(next === 'newest' ? pathname : `${pathname}?sort=${next}`, { scroll: false });

  const { data, error, reload } = useApi<DashboardData>('/dashboard', {
    refreshMs: (d) => (d?.meetings.some((m) => PROCESSING.includes(m.status)) ? 3000 : 30_000),
  });
  const [query, setQuery] = useState('');
  const meetings = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.meetings ?? []).filter((m) => !q || m.title.toLowerCase().includes(q));
    if (sort === 'time_saved') return [...list].sort((a, b) => (b.time_saved_minutes ?? -1) - (a.time_saved_minutes ?? -1));
    return list;
  }, [data, query, sort]);
  const totalSaved = useMemo(() => (data?.meetings ?? []).reduce((sum, m) => sum + (m.time_saved_minutes ?? 0), 0), [data]);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-space-xl px-space-md py-space-xl sm:px-space-xl">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div className="flex flex-col gap-space-xs">
          <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Meetings</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {sort === 'time_saved'
              ? `Ranked by the time Tatva saved you${totalSaved ? `: ${totalSaved} min across all meetings` : ''}`
              : 'Every recording from the Tatva extension, newest first'}
          </p>
        </div>
        <div className="flex w-full flex-col gap-space-sm sm:flex-row sm:items-center md:w-auto">
          <div role="tablist" aria-label="Sort meetings" className="flex shrink-0 rounded-lg border border-hairline bg-surface-container-low p-0.5">
            {SORTS.map((o) => {
              const on = sort === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSort(o.id)}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-label-md ${
                    on ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <Icon name={o.icon} className={`text-body-md ${on ? 'text-primary-container' : ''}`} />
                  {o.label}
                </button>
              );
            })}
          </div>
          <div className="relative w-full md:w-72">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title…"
              aria-label="Filter meetings by title"
              className="w-full rounded-lg border border-hairline bg-surface-container-low py-2 pl-9 pr-space-md font-body-sm text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant/60 hover:border-hairline-strong focus:ring-1 focus:ring-primary-container"
            />
          </div>
        </div>
      </div>
      <div className="divide-y divide-surface-container-highest overflow-hidden rounded-xl border border-hairline bg-surface-container-low shadow-md">
        {!data ? (
          error ? <ErrorState title="Couldn't load your meetings" message={error} onRetry={reload} /> : <SkeletonRows rows={4} />
        ) : meetings.length === 0 ? (
          <EmptyState icon="mic_none" title={query ? 'No meetings match' : 'No meetings yet'} body={query ? 'Try a different word from the title.' : 'Record a meeting with the Tatva extension to get started.'} />
        ) : (
          meetings.map((m) => <MeetingListRow key={m.id} meeting={m} showSaved onAsk={(x) => router.push(`/talk?meeting=${x.id}`)} onRetried={reload} />)
        )}
      </div>
    </div>
  );
}
