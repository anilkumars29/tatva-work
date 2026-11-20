import { freeMemory, rssMb } from '../memory.js';

// One heavy job at a time across the whole server (meetings and attachments):
// transcription uploads, LLM extraction and local embeddings each need tens of
// MB, and the instance has 512 MB. Running them back to back keeps the peak at
// "model + one step" and also keeps Groq's per-minute limits predictable.
let tail: Promise<void> = Promise.resolve();
let pending = 0;

export function runJob(label: string, job: () => Promise<void>): void {
  pending++;
  tail = tail
    .then(job)
    .catch((err) => console.error(`[jobs] ${label} crashed:`, err))
    .finally(() => {
      pending--;
      freeMemory();
      console.log(`[jobs] ${label} finished (rss ${rssMb()} MB, ${pending} queued)`);
    });
}

export const queuedJobs = () => pending;
