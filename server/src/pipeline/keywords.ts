// Keyword boosting for Scribe (Finch keyterms): the user's name, known people
// (contacts and action-item owners) and Indian-English money words, so
// "Meera", "lakh" and "crore" come out right. The fuzzy owner matching in
// extraction stays as the safety net.

export const BASE_KEYWORDS = ['lakh', 'crore', 'Tatva'];
const MAX_KEYWORDS = 50;

/** Pure: dedupes (case-insensitive), drops pronouns/junk, keeps names short, caps the list. */
export function buildKeywords(...lists: (string | null | undefined)[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lists.flat()) {
    const k = (raw ?? '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (k.length < 2 || k.length > 40 || /^(me|i|you|we|us|team|everyone|all|unassigned|tbd|n\/a)$/i.test(k) || /[<>@{}]/.test(k)) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** Names from the profile, contacts and recent action-item owners. Never throws. */
export async function loadKeywords(): Promise<string[]> {
  // Imported here so buildKeywords() stays pure (and testable without a database).
  const [{ getProfile }, { supabase }] = await Promise.all([import('../profile.js'), import('../supabase.js')]);
  const [profile, contacts, owners] = await Promise.all([
    getProfile().catch(() => null),
    supabase.from('contacts').select('name').limit(100),
    supabase.from('action_items').select('owner').not('owner', 'is', null).order('created_at', { ascending: false }).limit(300),
  ]);
  const firstName = (n: string) => n.split(/\s+/)[0];
  const profileNames = profile?.name ? [profile.name.replace(/\.$/, ''), firstName(profile.name)] : [];
  const contactNames = (contacts.data ?? []).flatMap((c: { name: string | null }) => (c.name ? [c.name, firstName(c.name)] : []));
  const ownerNames = (owners.data ?? []).map((o: { owner: string | null }) => o.owner);
  return buildKeywords(BASE_KEYWORDS, profileNames, contactNames, ownerNames);
}
