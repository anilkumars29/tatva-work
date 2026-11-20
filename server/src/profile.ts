// The signed-in user's profile (name, role, email, avatar colour), shown in the
// web app's sidebar and profile menu. Stored as one JSON object in a private
// Supabase Storage bucket, so it needs no table or migration. Defaults come from
// the environment (DEMO_OWNER_EMAIL) until the user saves their own.
import { supabase } from './supabase.js';

const BUCKET = 'settings';
const OBJECT = 'profile.json';

export const AVATAR_COLORS = ['#fef105', '#5ee6a8', '#7cc4ff', '#b79cff', '#ff8f85', '#9b9ba3'] as const;

export interface Profile {
  name: string;
  role: string;
  email: string;
  avatar_color: string;
  updated_at: string | null;
}

const DEFAULTS = (): Profile => ({
  name: 'Anil K.',
  role: 'Project Lead',
  email: process.env.DEMO_OWNER_EMAIL?.trim() ?? '',
  avatar_color: AVATAR_COLORS[0],
  updated_at: null,
});

let cache: { at: number; value: Profile } | null = null;

export async function getProfile(): Promise<Profile> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const { data, error } = await supabase.storage.from(BUCKET).download(OBJECT);
  let value = DEFAULTS();
  if (!error && data) {
    try {
      value = { ...value, ...(JSON.parse(await data.text()) as Partial<Profile>) };
    } catch {
      // A corrupt file falls back to the defaults.
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Validates and saves; returns the stored profile or throws a user-facing message. */
export async function saveProfile(input: Record<string, unknown>): Promise<Profile> {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const name = text(input.name);
  const role = text(input.role);
  const email = text(input.email);
  const color = text(input.avatar_color).toLowerCase();
  if (!name || name.length > 60) throw new Error('Name is required (up to 60 characters).');
  if (role.length > 60) throw new Error('Role can be up to 60 characters.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address does not look right.');
  if (!(AVATAR_COLORS as readonly string[]).includes(color)) throw new Error('Pick one of the avatar colours.');

  const profile: Profile = { name, role, email, avatar_color: color, updated_at: new Date().toISOString() };
  const body = JSON.stringify(profile, null, 2);
  let res = await supabase.storage.from(BUCKET).upload(OBJECT, body, { contentType: 'application/json', upsert: true });
  if (res.error && /bucket not found/i.test(res.error.message)) {
    const created = await supabase.storage.createBucket(BUCKET, { public: false });
    if (created.error && !/already exists/i.test(created.error.message)) throw new Error(created.error.message);
    res = await supabase.storage.from(BUCKET).upload(OBJECT, body, { contentType: 'application/json', upsert: true });
  }
  if (res.error) throw new Error(`Could not save the profile: ${res.error.message}`);
  cache = { at: Date.now(), value: profile };
  return profile;
}
