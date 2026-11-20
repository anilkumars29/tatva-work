// The signed-in user's profile (name, role, email, avatar colour), shown in the
// web app's sidebar and profile menu. Stored as one JSON object in a private
// Supabase Storage bucket, so it needs no table or migration. Defaults come from
// the environment (DEMO_OWNER_EMAIL) until the user saves their own.
//
// The profile is linked to the user's own row in `contacts` (contact_id): saving
// the profile copies name, email and role onto that contact, and the voice agent
// resolves "me" / "myself" to the profile email.
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
  /** The user's own entry in contacts. */
  contact_id: string | null;
  contact_name?: string | null;
}

const DEFAULTS = (): Profile => ({
  name: 'Anil K.',
  role: 'Project Lead',
  email: process.env.DEMO_OWNER_EMAIL?.trim() ?? '',
  avatar_color: AVATAR_COLORS[0],
  updated_at: null,
  contact_id: null,
});

let cache: { at: number; value: Profile } | null = null;

const firstWord = (s: string) => s.trim().toLowerCase().split(/\s+/)[0] ?? '';

/** The contact row that is the user: the linked id, else same email, else same first name. */
async function findOwnContact(p: Pick<Profile, 'contact_id' | 'email' | 'name'>): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.from('contacts').select('id, name, email');
  if (error || !data) return null;
  const byId = p.contact_id ? data.find((c) => c.id === p.contact_id) : undefined;
  const byEmail = p.email ? data.find((c) => c.email && c.email.toLowerCase() === p.email.toLowerCase()) : undefined;
  const byName = data.filter((c) => firstWord(c.name) === firstWord(p.name));
  const match = byId ?? byEmail ?? (byName.length === 1 ? byName[0] : undefined);
  return match ? { id: match.id, name: match.name } : null;
}

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
  const contact = await findOwnContact(value);
  value = { ...value, contact_id: contact?.id ?? null, contact_name: contact?.name ?? null };
  cache = { at: Date.now(), value };
  return value;
}

/** Copies the profile onto the linked contact (name only if it isn't taken). */
async function syncContact(profile: Profile, contactId: string): Promise<string | null> {
  const patch = { email: profile.email || null, role: profile.role || null };
  const withName = await supabase.from('contacts').update({ ...patch, name: profile.name }).eq('id', contactId).select('name').maybeSingle();
  let name = withName.data?.name ?? null;
  if (withName.error) {
    // contacts.name is unique: keep the old name if another contact has this one.
    const plain = await supabase.from('contacts').update(patch).eq('id', contactId).select('name').maybeSingle();
    if (plain.error) throw new Error(`Profile saved, but your contact entry could not be updated: ${plain.error.message}`);
    name = plain.data?.name ?? null;
  }
  // The voice agent caches contacts for a few seconds.
  const { allContacts } = await import('./voice/data.js');
  allContacts.reset();
  return name;
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

  // Link to the same contact as before (found by the old email/name), so changing
  // the email moves your contact along with it.
  const previous = await getProfile();
  const contact = await findOwnContact(previous);

  const profile: Profile = { name, role, email, avatar_color: color, updated_at: new Date().toISOString(), contact_id: contact?.id ?? null };
  const body = JSON.stringify(profile, null, 2);
  let res = await supabase.storage.from(BUCKET).upload(OBJECT, body, { contentType: 'application/json', upsert: true });
  if (res.error && /bucket not found/i.test(res.error.message)) {
    const created = await supabase.storage.createBucket(BUCKET, { public: false });
    if (created.error && !/already exists/i.test(created.error.message)) throw new Error(created.error.message);
    res = await supabase.storage.from(BUCKET).upload(OBJECT, body, { contentType: 'application/json', upsert: true });
  }
  if (res.error) throw new Error(`Could not save the profile: ${res.error.message}`);
  const contactName = contact ? await syncContact(profile, contact.id) : null;
  const saved = { ...profile, contact_name: contactName };
  cache = { at: Date.now(), value: saved };
  return saved;
}
