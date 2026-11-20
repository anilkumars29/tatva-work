// Action item owners (pure, unit-tested).

/** Speakers are unlabelled, so a pronoun is not an owner ("I will..." with no name -> unassigned). */
export function cleanOwner(owner: string | null): string | null {
  const name = owner?.trim();
  if (!name || /^(i|me|myself|we|us|you|they|he|she|someone|somebody|everyone|team|the team|speaker\b.*|unknown|none|n\/a|null)$/i.test(name)) return null;
  return name;
}
