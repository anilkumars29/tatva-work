// Parsing Groq 429 responses (pure, unit-tested).

/** "tokens per day (TPD)" / "requests per day (RPD)" → day; anything else (TPM, RPM) → minute. */
export function rateLimitKind(body: string): 'day' | 'minute' {
  return /per day|\((TPD|RPD|ASD)\)/i.test(body) ? 'day' : 'minute';
}

/** Milliseconds from a retry-after header (seconds) or "try again in 1m58.368s" / "7.66s" / "2h3m" / "250ms". */
export function parseRetryAfter(header: string | null, body: string): number | null {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const m = body.match(/try again in ((?:\d+(?:\.\d+)?(?:ms|[hms])\s*)+)/i)?.[1];
  if (!m) return null;
  const unitMs: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 };
  let ms = 0;
  for (const [, n, unit] of m.matchAll(/(\d+(?:\.\d+)?)(ms|[hms])/g)) ms += Number(n) * unitMs[unit];
  return ms || null;
}
