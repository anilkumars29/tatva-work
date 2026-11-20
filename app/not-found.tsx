import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/tatva/ui';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-space-md py-space-2xl">
      <div className="flex max-w-md flex-col items-center gap-space-md text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-hairline bg-surface-container-low">
          <Icon name="explore_off" className="text-headline-lg text-on-surface-variant" />
        </span>
        <p className="font-mono text-label-md text-primary-container">404</p>
        <h1 className="font-headline-lg text-headline-lg text-on-surface">This page doesn&apos;t exist</h1>
        <p className="text-body-md text-on-surface-variant">The link may be old, or the meeting may have been deleted. Everything Tatva knows is still a click away.</p>
        <div className="mt-space-sm flex flex-wrap items-center justify-center gap-space-sm">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-5 py-2.5 text-label-md font-semibold text-on-primary hover:bg-primary-fixed"
          >
            <Icon name="grid_view" className="text-body-lg" />
            Go to the dashboard
          </Link>
          <Link
            href="/meetings"
            className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface-container-high px-5 py-2.5 text-label-md text-on-surface hover:border-hairline-strong hover:bg-surface-bright"
          >
            <Icon name="calendar_today" className="text-body-lg" />
            Meetings
          </Link>
        </div>
      </div>
    </div>
  );
}
