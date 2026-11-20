// Client helpers for the Tatva server (proxied at /tatva/* -> server /api/*).

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(`/tatva${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON (e.g. proxy error page)
  }
  if (!response.ok) {
    const message =
      (data as { error?: string; say?: string } | null)?.error ??
      (data as { say?: string } | null)?.say ??
      (response.status === 500 && !data ? 'The Tatva server is not reachable. Is `pnpm run dev` running in server/?' : `Request failed (${response.status})`);
    throw new ApiError(message, response.status);
  }
  return data as T;
}

// ------------------------------------------------------------------ formatting

const TZ = 'Asia/Kolkata';

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase();
}

function ymd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** "Today, 11:00" / "Yesterday, 16:30" / "18 Nov, 14:00". */
export function relativeDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  const today = ymd(new Date());
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const day = ymd(date);
  if (day === today) return `Today, ${time}`;
  if (day === yesterday) return `Yesterday, ${time}`;
  return `${new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' }).format(date)}, ${time}`;
}

/** "Mon 23 Nov, 11:00 AM". */
export function eventDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "Fri 21 Nov" for a YYYY-MM-DD date; "Today" / "Tomorrow" when close. */
export function dueLabel(date: string | null | undefined, text?: string | null): string {
  if (!date) return text ?? '';
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86_400_000));
  if (date === today) return 'Today';
  if (date === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

export function todayYmd(): string {
  return ymd(new Date());
}

/** "32 min", "49 sec", "1 h 05 min". */
export function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "3h 20m" / "17 min". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "12:40" from seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** CSV text with proper quoting, for client-side downloads. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const v = cell == null ? '' : String(cell);
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    )
    .join('\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 1536 -> "1.5 KB", 2_400_000 -> "2.3 MB". */
export function fileSize(bytes: number | null | undefined): string {
  const n = Number(bytes ?? 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
