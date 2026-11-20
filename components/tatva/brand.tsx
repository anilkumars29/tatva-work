// Tatva brand marks as inline SVG (crisp at any size, colour from CSS).
import { BRAND_YELLOW, WAVE_PATH, WAVE_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from './brand-paths';

/** The waveform alone, filled with currentColor. */
export function TatvaWave({ className = '' }: { className?: string }) {
  return (
    <svg viewBox={WAVE_VIEWBOX} className={className} aria-hidden="true" focusable="false">
      <path d={WAVE_PATH} fill="currentColor" />
    </svg>
  );
}

/** The app mark: black waveform on the brand yellow, rounded square. */
export function TatvaMark({ className = '', title = 'Tatva' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label={title}>
      <rect width="512" height="512" rx="112" fill={BRAND_YELLOW} />
      <path d={WAVE_PATH} fill="#0A0A0A" stroke="#0A0A0A" strokeWidth="22" strokeLinejoin="round" transform={`translate(66 256) scale(${(380 / 934).toFixed(5)})`} />
    </svg>
  );
}

/** The TATVA wordmark (A drawn as Λ, as in the logo), filled with currentColor. */
export function TatvaWordmark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={className} role="img" aria-label="Tatva">
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}

/** Mark + wordmark, for places with room (sidebar header). */
export function TatvaLockup({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <TatvaMark className="h-8 w-8 shrink-0" />
      <TatvaWordmark className="h-[13px] w-auto text-on-surface" />
    </span>
  );
}
