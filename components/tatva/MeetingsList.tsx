'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { MeetingListRow } from './Dashboard';
import { PROCESSING, type DashboardData } from './types';
import { EmptyState, Icon, Spinner } from './ui';

export default function MeetingsList() {
  const router = useRouter();
  const { data, error } = useApi<DashboardData>('/dashboard', {
    refreshMs: (d) => (d?.meetings.some((m) => PROCESSING.includes(m.status)) ? 3000 : 30_000),
  });
  const [query, setQuery] = useState('');
  const meetings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.meetings ?? []).filter((m) => !q || m.title.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-space-xl px-space-xl py-space-xl">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div className="flex flex-col gap-space-xs">
          <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Meetings</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Every recording from the Tatva extension, newest first</p>
        </div>
        <div className="relative w-full md:w-80">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title..."
            className="w-full rounded-lg bg-surface-container-low py-2 pl-9 pr-space-md font-body-sm text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant/60 focus:ring-1 focus:ring-primary-container"
          />
        </div>
      </div>
      {error && !data && <p className="font-body-md text-body-md text-error">{error}</p>}
      <div className="divide-y divide-surface-container-highest overflow-hidden rounded-xl bg-surface-container-low shadow-md border border-hairline">
        {!data ? (
          <div className="flex justify-center p-space-xl text-on-surface-variant">
            <Spinner />
          </div>
        ) : meetings.length === 0 ? (
          <EmptyState icon="mic_none" title={query ? 'No meetings match' : 'No meetings yet'} body={query ? undefined : 'Record a meeting with the Tatva extension to get started.'} />
        ) : (
          meetings.map((m) => <MeetingListRow key={m.id} meeting={m} onAsk={(x) => router.push(`/talk?meeting=${x.id}`)} />)
        )}
      </div>
    </div>
  );
}
