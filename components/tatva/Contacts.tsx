'use client';

import { useMemo, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, downloadText, initials, plural, toCsv } from '@/lib/tatva';
import type { Contact } from './types';
import { ownerIsMe, useProfile, type Profile } from './profile';
import { EmptyState, Icon, Spinner, useTatvaUi } from './ui';

interface Draft {
  id?: string;
  name: string;
  email: string;
  slack_handle: string;
  role: string;
}
const EMPTY: Draft = { name: '', email: '', slack_handle: '', role: '' };

/** Your own contact entry: the one linked to your profile (else same email / first name). */
const isSelf = (c: Contact, profile: Profile | null) =>
  !!profile &&
  (profile.contact_id
    ? c.id === profile.contact_id
    : profile.email && c.email
      ? profile.email.toLowerCase() === c.email.toLowerCase()
      : ownerIsMe(c.name, profile));

export default function Contacts() {
  const { toast } = useTatvaUi();
  const { profile } = useProfile();
  const { data, error, reload } = useApi<{ contacts: Contact[] }>('/contacts');
  const status = useApi<{ composio: Record<string, boolean> }>('/status');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const contacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.contacts ?? []).filter((c) => !q || [c.name, c.email, c.role, c.slack_handle].some((v) => v?.toLowerCase().includes(q)));
  }, [data, query]);

  const reachable = (data?.contacts ?? []).filter((c) => c.email).length;
  const workspace = status.data?.composio;
  const workspaceOk = workspace ? workspace.gmail && workspace.googlecalendar : null;

  const open = (c?: Contact) => {
    setFormError(null);
    setDraft(c ? { id: c.id, name: c.name, email: c.email ?? '', slack_handle: c.slack_handle ?? '', role: c.role ?? '' } : EMPTY);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    const body = { name: draft.name, email: draft.email, slack_handle: draft.slack_handle || null, role: draft.role || null };
    try {
      if (draft.id) await api(`/contacts/${draft.id}`, { method: 'PATCH', json: body });
      else await api('/contacts', { method: 'POST', json: body });
      toast(draft.id ? `Saved ${draft.name}.` : `Added ${draft.name}. Pooja can now email and invite them.`, 'success');
      setDraft(null);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const rows = data?.contacts ?? [];
    downloadText(
      `tatva-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([['Name', 'Email', 'Slack handle', 'Role'], ...rows.map((c) => [c.name, c.email, c.slack_handle ? `@${c.slack_handle}` : '', c.role])]),
    );
    toast(`Exported ${plural(rows.length, 'contact')}.`, 'success');
  };

  return (
    <div className="relative flex w-full flex-col">
      <div className="pointer-events-none absolute -top-12 right-24 -z-10 h-96 w-96 rounded-full bg-primary-container/5 blur-3xl" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-space-xl p-space-xl">
        <div className="flex flex-col justify-between gap-space-lg md:flex-row md:items-end">
          <div className="flex flex-col gap-space-xs">
            <div className="mb-1 flex items-center gap-space-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Directory &amp; Team Routing</span>
            </div>
            <h1 className="font-headline-lg text-headline-lg tracking-tight text-on-surface">Contacts</h1>
            <p className="font-body-md text-body-md text-secondary">Tatva uses these to email, invite and mention people</p>
          </div>
          <button
            type="button"
            onClick={() => open()}
            className="group relative flex items-center gap-space-xs rounded-xl bg-primary-container px-space-lg py-space-sm font-label-md text-label-md font-bold tracking-tight text-on-primary transition-all hover:brightness-105 active:scale-[0.98]"
          >
            <Icon name="add" className="text-headline-sm transition-transform duration-200 group-hover:rotate-90" />
            <span>Add contact</span>
          </button>
        </div>

        <div className="grid grid-cols-1 items-center gap-space-md md:grid-cols-12">
          <div className="relative md:col-span-6 lg:col-span-5">
            <Icon name="search" className="pointer-events-none absolute left-space-md top-1/2 -translate-y-1/2 text-headline-sm text-on-surface-variant" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-xl bg-surface-container-low py-space-sm pl-11 pr-space-md font-body-md text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/60 focus:bg-surface-container border border-hairline"
              placeholder="Search by name, role or email..."
              type="text"
            />
          </div>
          <div className="flex items-center justify-start gap-space-sm md:col-span-6 md:justify-end lg:col-span-7">
            <button
              type="button"
              title="Export Contacts"
              aria-label="Export contacts as CSV"
              disabled={!data?.contacts.length}
              onClick={exportCsv}
              className="rounded-xl bg-surface-container-low p-2 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40 border border-hairline"
            >
              <Icon name="file_download" className="text-headline-sm" />
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl border border-hairline">
          <div className="grid grid-cols-12 bg-surface-container-low px-space-lg py-space-md font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
            <div className="col-span-4">Member / Identity</div>
            <div className="col-span-3 hidden sm:block">Email Address</div>
            <div className="col-span-2 hidden md:block">Slack Handle</div>
            <div className="col-span-5 sm:col-span-3 md:col-span-2">Assigned Role</div>
            <div className="col-span-3 text-right sm:col-span-2 md:col-span-1">Actions</div>
          </div>
          <div className="flex flex-col">
            {!data && !error && (
              <div className="flex justify-center p-space-xl text-on-surface-variant">
                <Spinner />
              </div>
            )}
            {error && !data && <EmptyState icon="error" title="Couldn't load contacts" body={error} />}
            {data && contacts.length === 0 && <EmptyState icon="person_search" title={query ? 'No contacts match' : 'No contacts yet'} body={query ? undefined : 'Add your team so Pooja can email and invite them.'} />}
            {contacts.map((c, i) => {
              const self = isSelf(c, profile);
              return (
                <div
                  key={c.id}
                  className={`group grid grid-cols-12 items-center px-space-lg py-space-md transition-colors hover:bg-surface-container-low/60 ${
                    self ? 'bg-surface-container-low/40' : i % 2 ? 'bg-surface-container-lowest/80' : 'bg-surface-container-lowest'
                  }`}
                >
                  <div className="col-span-4 flex min-w-0 items-center gap-space-md pr-space-xs">
                    <div className="relative shrink-0">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl font-headline-sm text-headline-sm font-bold ${
                          self ? 'bg-primary-container text-on-primary' : 'bg-surface-container-highest text-on-surface shadow-inner'
                        }`}
                      >
                        {initials(c.name)}
                      </div>
                      {self && <span className="absolute -bottom-1 -right-1 rounded bg-surface px-1 font-mono text-[9px] font-bold uppercase tracking-tighter text-primary-container shadow">You</span>}
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate font-label-md text-label-md text-on-surface transition-colors group-hover:text-primary">{c.name}</span>
                        {self && <span className="rounded bg-surface-container px-1.5 py-0.5 font-label-sm text-[10px] font-semibold uppercase tracking-wide text-secondary">Active Account</span>}
                      </div>
                      <span className="truncate font-body-sm text-body-sm text-on-surface-variant sm:hidden">{c.email}</span>
                    </div>
                  </div>
                  <div className="col-span-3 hidden min-w-0 items-center pr-space-xs sm:flex">
                    <span className="truncate font-body-md text-body-md text-on-surface-variant">{c.email ?? '—'}</span>
                  </div>
                  <div className="col-span-2 hidden items-center md:flex">
                    {c.slack_handle ? (
                      <div className="flex items-center gap-1.5 rounded-md bg-surface-container px-2.5 py-1 font-mono font-label-sm text-label-sm text-on-surface">
                        <span className="text-primary-container">@</span>
                        {c.slack_handle}
                      </div>
                    ) : (
                      <span className="font-body-sm text-body-sm text-on-surface-variant">—</span>
                    )}
                  </div>
                  <div className="col-span-5 flex min-w-0 items-center sm:col-span-3 md:col-span-2">
                    {c.role ? (
                      <span className={`inline-flex items-center truncate rounded-lg bg-surface-container-high px-space-sm py-1 font-label-md text-label-md ${self ? 'text-primary-container' : 'text-on-surface'}`}>{c.role}</span>
                    ) : (
                      <span className="font-body-sm text-body-sm text-on-surface-variant">—</span>
                    )}
                  </div>
                  <div className="col-span-3 flex items-center justify-end gap-space-xs sm:col-span-2 md:col-span-1">
                    <button
                      type="button"
                      title="Edit Contact"
                      aria-label={`Edit ${c.name}`}
                      onClick={() => open(c)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-container-high ${self ? 'bg-surface-container text-primary-container' : 'bg-surface-container-low text-on-surface-variant hover:text-primary'}`}
                    >
                      <Icon name="edit" className="text-body-lg" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between bg-surface-container-lowest px-space-lg py-space-sm font-caption text-caption text-on-surface-variant">
            <span>Pooja can email and invite {plural(reachable, 'contact')}</span>
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${workspaceOk ? 'bg-tertiary-fixed' : workspaceOk === false ? 'bg-error' : 'bg-surface-container-highest'}`} />
              <span>{workspaceOk == null ? 'Checking Google Workspace…' : workspaceOk ? 'Gmail & Calendar connected (Composio)' : 'Gmail or Calendar not connected in Composio'}</span>
            </div>
          </div>
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-space-md backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div role="dialog" aria-modal="true" aria-label={draft.id ? 'Edit contact' : 'Add contact'} className="relative flex w-full max-w-lg flex-col gap-space-lg rounded-2xl bg-surface-container-low p-space-xl shadow-2xl border border-hairline">
            <div className="flex items-start justify-between gap-space-md">
              <div className="flex flex-col gap-space-xs">
                <div className="flex items-center gap-space-xs">
                  <span className="h-2 w-2 rounded-full bg-primary-container" />
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary-container">Pooja Routing Sync</span>
                </div>
                <h2 className="font-headline-md text-headline-md tracking-tight text-on-surface">{draft.id ? 'Edit contact' : 'Add contact'}</h2>
                <p className="font-body-md text-body-md leading-snug text-secondary">Add team member details so Pooja can draft emails, send invites and route actions.</p>
              </div>
              <button type="button" aria-label="Close dialog" onClick={() => setDraft(null)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant transition-colors hover:bg-surface-bright hover:text-on-surface">
                <Icon name="close" className="text-headline-sm" />
              </button>
            </div>
            <form
              className="flex flex-col gap-space-md"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <ContactField id="contactName" label="Full Name" note="Required" icon="badge" placeholder="e.g. Vikram Malhotra" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
              <ContactField id="contactEmail" label="Work Email" note="Automated invites" icon="alternate_email" placeholder="vikram@company.com" type="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} required />
              <ContactField id="contactSlack" label="Slack Handle" note="Workspace ping tag" prefix="@" placeholder="vikram" value={draft.slack_handle} onChange={(v) => setDraft({ ...draft, slack_handle: v.replace(/^@/, '') })} mono />
              <ContactField id="contactRole" label="Organizational Role" note="Context tag" icon="hub" placeholder="e.g. Head of Growth / Operations" value={draft.role} onChange={(v) => setDraft({ ...draft, role: v })} />
              <div className="mt-1 flex items-start gap-space-sm rounded-xl bg-surface-container-lowest p-space-sm border border-hairline">
                <Icon name="smart_toy" className="mt-0.5 text-body-md text-on-surface-variant" />
                <p className="font-caption text-caption leading-relaxed text-on-surface-variant">
                  Say &ldquo;email {draft.name.split(' ')[0] || 'Vikram'}&rdquo; and Pooja uses this address. The first name works as a short form.
                </p>
              </div>
              {formError && <p className="font-body-sm text-body-sm text-error">{formError}</p>}
              <div className="flex items-center justify-end gap-space-sm pt-space-xs">
                <button type="button" onClick={() => setDraft(null)} className="rounded-xl bg-surface-container-high px-space-lg py-2.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-bright active:scale-[0.98]">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-space-xl py-2.5 font-label-md text-label-md font-bold tracking-tight text-on-primary transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
                >
                  {saving && <Spinner className="text-body-md" />}
                  Save contact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactField(props: {
  id: string;
  label: string;
  note: string;
  icon?: string;
  prefix?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center justify-between font-label-md text-label-md text-on-surface" htmlFor={props.id}>
        <span>{props.label}</span>
        <span className="font-caption text-caption uppercase tracking-wider text-on-surface-variant">{props.note}</span>
      </label>
      <div className="relative">
        {props.icon && <Icon name={props.icon} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-body-lg text-on-surface-variant" />}
        {props.prefix && <span className="absolute left-3.5 top-1/2 -translate-y-1/2 select-none font-mono text-body-lg font-bold text-primary-container">{props.prefix}</span>}
        <input
          id={props.id}
          type={props.type ?? 'text'}
          required={props.required}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className={`w-full rounded-xl bg-surface-container-lowest py-2.5 pr-space-md font-body-md text-body-md text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 focus:bg-surface-container ${props.prefix ? 'pl-9' : 'pl-11'} ${props.mono ? 'font-mono' : ''} border border-hairline`}
        />
      </div>
    </div>
  );
}
