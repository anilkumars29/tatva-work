'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, TatvaUiProvider } from './ui';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'grid_view' },
  { href: '/meetings', label: 'Meetings', icon: 'calendar_today' },
  { href: '/talk', label: 'Talk to Tatva', icon: 'graphic_eq' },
  { href: '/knowledge', label: 'Knowledge Base', icon: 'dataset' },
  { href: '/tracker', label: 'Tracker', icon: 'check_box' },
  { href: '/contacts', label: 'Contacts', icon: 'group' },
];

/**
 * The Chrome extension's content script marks this page
 * (<html data-tatva-extension="0.3.0">) when it is installed and enabled.
 */
function useExtensionVersion(): string | null | undefined {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => document.documentElement.dataset.tatvaExtension ?? null;
    let tries = 0;
    const id = setInterval(() => {
      const v = read();
      tries++;
      if (v || tries > 10) {
        setVersion(v);
        clearInterval(id);
      }
    }, 300);
    return () => clearInterval(id);
  }, []);
  return version;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const extension = useExtensionVersion();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <TatvaUiProvider>
      <aside className="fixed left-0 top-0 z-50 flex h-screen w-60 select-none flex-col justify-between bg-surface-container-lowest py-space-lg">
        <div className="flex w-full flex-col">
          <Link href="/" className="mb-space-xl flex items-center gap-space-sm px-space-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Tatva Work logo" className="h-8 w-8 object-contain" src="/tatva-logo.svg" />
            <span className="font-headline-sm text-headline-sm font-bold tracking-tight text-on-surface">Tatva Work</span>
          </Link>
          <nav className="flex w-full flex-col gap-space-xs">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-space-sm py-space-sm font-label-md text-label-md transition-colors ${
                    active
                      ? 'border-l-[3px] border-primary-container bg-surface-container-low pl-[21px] pr-space-lg text-primary-container'
                      : 'px-space-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                  }`}
                >
                  <Icon name={item.icon} className={`text-headline-sm ${active ? 'text-primary-container' : ''}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-col gap-space-md px-space-md">
          <div
            className="flex items-center justify-between rounded-lg bg-surface-container-low p-space-sm shadow-[0_1px_8px_rgba(0,0,0,0.4)]"
            title={extension ? `Tatva Work Recorder ${extension}` : 'Install or enable the Tatva Work Recorder extension (extension/ folder) and reload this page.'}
          >
            <div className="flex items-center gap-space-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  extension ? 'bg-tertiary-fixed shadow-[0_0_8px_rgba(111,251,190,0.8)]' : extension === null ? 'bg-on-surface-variant/50' : 'bg-surface-container-highest'
                }`}
              />
              <span className="font-label-sm text-label-sm uppercase tracking-wide text-on-surface">
                {extension ? 'Extension connected' : extension === null ? 'Extension not detected' : 'Checking extension'}
              </span>
            </div>
            <Icon name={extension ? 'cloud_done' : 'cloud_off'} className={`text-body-sm ${extension ? 'text-tertiary' : 'text-on-surface-variant'}`} />
          </div>
          <div className="flex items-center gap-space-sm rounded-lg bg-surface-container p-space-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container font-label-sm text-label-sm font-black text-on-primary">AK</div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-label-md text-label-md text-on-surface">Anil</span>
              <span className="truncate font-caption text-caption text-on-surface-variant">Project Lead</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="pl-60">
        <header className="fixed left-60 right-0 top-0 z-40 flex h-16 items-center justify-end gap-space-md bg-surface/90 px-space-xl backdrop-blur-xl">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container font-label-sm text-label-sm font-black text-on-primary" title="Anil · Project Lead">
            AK
          </div>
        </header>
        <main className="min-h-screen w-full bg-surface pt-16">{children}</main>
      </div>
    </TatvaUiProvider>
  );
}
