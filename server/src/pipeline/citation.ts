// How Pooja and search results name a file shared in a meeting. Pure (unit-tested).

/** `the slide "Pricing.png" shared in Q4 Vendor Review`, `the PDF "Plan.pdf" shared in …`. */
export function attachmentCitation(meta: { name?: unknown; kind?: unknown; label?: unknown }, meetingTitle: string): string {
  const what = meta.kind === 'pdf' ? 'PDF' : typeof meta.label === 'string' && meta.label ? meta.label : 'image';
  return `the ${what} "${String(meta.name ?? 'attachment')}" shared in ${meetingTitle}`;
}
