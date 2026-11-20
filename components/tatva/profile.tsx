'use client';

// The signed-in user's profile (server: GET/PUT /api/profile), shared by the
// sidebar card, the header avatar menu, the dashboard greeting and "mine" checks.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/lib/tatva';

export interface Profile {
  name: string;
  role: string;
  email: string;
  avatar_color: string;
  updated_at: string | null;
  /** Your own row in Contacts (kept in sync when the profile is saved). */
  contact_id?: string | null;
  contact_name?: string | null;
}

export const AVATAR_COLORS: { value: string; label: string }[] = [
  { value: '#fef105', label: 'Yellow' },
  { value: '#5ee6a8', label: 'Mint' },
  { value: '#7cc4ff', label: 'Sky' },
  { value: '#b79cff', label: 'Violet' },
  { value: '#ff8f85', label: 'Coral' },
  { value: '#9b9ba3', label: 'Slate' },
];

/** "Anil K." -> "AK", "Anil" -> "A". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** True when an action item owner ("Anil", "Anil K.") is the profile's person. */
export function ownerIsMe(owner: string | null | undefined, profile: Profile | null): boolean {
  if (!owner || !profile) return false;
  const me = firstName(profile.name).toLowerCase();
  return !!me && owner.trim().toLowerCase().split(/\s+/)[0] === me;
}

interface ProfileCtx {
  profile: Profile | null;
  error: string | null;
  save: (next: Pick<Profile, 'name' | 'role' | 'email' | 'avatar_color'>) => Promise<Profile>;
}

const Ctx = createContext<ProfileCtx>({ profile: null, error: null, save: async () => Promise.reject(new Error('No profile provider')) });

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ profile: Profile }>('/profile')
      .then((r) => setProfile(r.profile))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = useCallback(async (next: Pick<Profile, 'name' | 'role' | 'email' | 'avatar_color'>) => {
    const r = await api<{ profile: Profile }>('/profile', { method: 'PUT', json: next });
    setProfile(r.profile);
    setError(null);
    return r.profile;
  }, []);

  const value = useMemo(() => ({ profile, error, save }), [profile, error, save]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProfile = () => useContext(Ctx);

export function Avatar({ profile, size = 32, className = '' }: { profile: Profile | null; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-[#0a0a0a] ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: profile?.avatar_color ?? '#27272b', letterSpacing: '0.02em' }}
    >
      {profile ? initials(profile.name) : ''}
    </span>
  );
}
