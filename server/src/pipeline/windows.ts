// Overlapping text windows for document chunks (pure; unit-tested).
const WINDOW = 900;
const OVERLAP = 150;

/** Splits text into ~WINDOW-char windows, breaking at sentence ends where possible. */
export function windows(text: string, size = WINDOW, overlap = OVERLAP): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const stop = clean.lastIndexOf('. ', end);
      if (stop > start + size * 0.5) end = stop + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
