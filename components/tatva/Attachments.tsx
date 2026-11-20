'use client';

// Meeting attachments: PDFs and images added by upload button, drag and drop
// anywhere on the meeting page, or pasting a screenshot (Ctrl+V). Each file is
// read by the server (PDF text / vision model for images), indexed for Pooja,
// and summarised in the meeting's Google Doc.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { api, fileSize, relativeDateTime, uploadTarget } from '@/lib/tatva';
import { DialogFrame, Icon, Spinner, useTatvaUi } from './ui';

export interface Attachment {
  id: string;
  created_at: string;
  meeting_id: string;
  name: string;
  mime: string;
  kind: 'pdf' | 'image';
  bytes: number | null;
  pages: number | null;
  label: string | null;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  summary: string | null;
  chunk_count: number;
  preview_url: string | null;
  text_content?: string | null;
  meeting_title?: string;
  meeting_date?: string | null;
}

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp';
const MAX_PDF = 25 * 1024 * 1024;
const MAX_IMAGE = 15 * 1024 * 1024;

const isAllowed = (f: File) => /^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type) || /\.(pdf|png|jpe?g|webp)$/i.test(f.name);
const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name);

/** Pasted screenshots arrive as "image.png": give them a readable, unique name. */
function pastedName(file: File, index: number): string {
  if (file.name && !/^image\.(png|jpe?g|webp)$/i.test(file.name)) return file.name;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png';
  return `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}${index ? ` (${index + 1})` : ''}.${ext}`;
}

/** Opens (or downloads) an attachment through a short-lived signed URL. */
export async function openAttachment(id: string, download: boolean) {
  // Open the tab first (keeps the click's user activation), then point it at the signed URL.
  const tab = download ? null : window.open('about:blank', '_blank');
  try {
    const { url } = await api<{ url: string }>(`/attachments/${id}/url${download ? '?download=1' : ''}`);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export function StatusPill({ a }: { a: Pick<Attachment, 'status' | 'error'> }) {
  if (a.status === 'processing')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary-container/10 px-2 py-0.5 text-caption text-primary-container">
        <Spinner className="text-[12px]" /> Processing
      </span>
    );
  if (a.status === 'failed')
    return (
      <span title={a.error ?? undefined} className="inline-flex items-center gap-1 rounded-full bg-error-container/50 px-2 py-0.5 text-caption text-error">
        <Icon name="error" className="text-[12px]" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-fixed/10 px-2 py-0.5 text-caption text-tertiary-fixed">
      <Icon name="check" className="text-[12px]" /> Indexed
    </span>
  );
}

export function AttachmentThumb({ a, className = '' }: { a: Pick<Attachment, 'kind' | 'preview_url' | 'name' | 'pages'>; className?: string }) {
  if (a.kind === 'image' && a.preview_url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a.preview_url} alt={a.name} loading="lazy" className={`h-full w-full object-cover ${className}`} />;
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-container-lowest text-on-surface-variant ${className}`}>
      <Icon name={a.kind === 'pdf' ? 'picture_as_pdf' : 'image'} className="text-[28px]" />
      <span className="font-mono text-caption">{a.kind === 'pdf' ? `PDF${a.pages ? ` · ${a.pages}p` : ''}` : 'Image'}</span>
    </div>
  );
}

/** Preview: the image itself (or a PDF link) plus what Tatva read from it. */
export function AttachmentPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const { toast } = useTatvaUi();
  const { data, error } = useApi<{ attachment: Attachment }>(`/attachments/${id}`);
  const a = data?.attachment;
  return (
    <DialogFrame title={a?.name ?? 'Attachment'} icon={a?.kind === 'pdf' ? 'picture_as_pdf' : 'image'} onClose={onClose}>
      {error && <p className="text-body-sm text-error">{error}</p>}
      {!a && !error && (
        <p className="flex items-center gap-2 text-body-sm text-on-surface-variant">
          <Spinner /> Loading…
        </p>
      )}
      {a && (
        <div className="flex max-h-[70vh] flex-col gap-space-md overflow-y-auto">
          {a.kind === 'image' && a.preview_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.preview_url} alt={a.name} className="max-h-[45vh] w-full rounded-lg border border-hairline bg-surface-container-lowest object-contain" />
          )}
          <div className="flex flex-wrap items-center gap-2 text-caption text-on-surface-variant">
            <StatusPill a={a} />
            <span className="font-mono">{fileSize(a.bytes)}</span>
            {a.label && <span className="rounded bg-surface-container-high px-1.5 py-0.5 capitalize">{a.label}</span>}
            {a.pages ? <span className="font-mono">{a.pages} pages</span> : null}
            {a.chunk_count ? <span className="font-mono">{a.chunk_count} chunks</span> : null}
          </div>
          {a.summary && <p className="text-body-md text-on-surface">{a.summary}</p>}
          {a.status === 'failed' && a.error && <p className="rounded-lg border border-error/30 bg-error-container/30 p-space-sm text-body-sm text-error">{a.error}</p>}
          {a.text_content && (
            <div className="flex flex-col gap-1">
              <span className="text-label-sm uppercase text-on-surface-variant">What Tatva read {a.kind === 'image' ? '(vision model)' : '(PDF text)'}</span>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-surface-container-lowest p-space-sm font-mono text-body-sm text-on-surface-variant">{a.text_content}</pre>
            </div>
          )}
          <div className="flex justify-end gap-space-sm">
            {a.kind === 'pdf' && (
              <button type="button" onClick={() => openAttachment(a.id, false).catch((e) => toast(e.message, 'error'))} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-container-high px-space-md py-2 text-label-md text-on-surface hover:bg-surface-bright">
                <Icon name="open_in_new" className="text-body-lg" /> Open PDF
              </button>
            )}
            <button type="button" onClick={() => openAttachment(a.id, true).catch((e) => toast(e.message, 'error'))} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-container-high px-space-md py-2 text-label-md text-on-surface hover:bg-surface-bright">
              <Icon name="download" className="text-body-lg" /> Download
            </button>
          </div>
        </div>
      )}
    </DialogFrame>
  );
}

interface Upload {
  key: string;
  name: string;
  bytes: number;
  progress: number;
  error?: string;
}

async function uploadOne(meetingId: string, file: File, name: string, onProgress: (p: number) => void): Promise<Attachment> {
  const target = await uploadTarget();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', target.url(`/meetings/${meetingId}/attachments`));
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { attachment?: Attachment; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // proxy error page
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.attachment) resolve(body.attachment);
      else reject(new Error(body.error ?? (xhr.status === 413 ? 'File is too large.' : `Upload failed (${xhr.status}).`)));
    };
    xhr.onerror = () => reject(new Error('Upload failed: the Tatva server is not reachable.'));
    xhr.send(form);
  });
}

export function MeetingAttachments({ meetingId, meetingTitle }: { meetingId: string; meetingTitle: string }) {
  const { toast, confirm } = useTatvaUi();
  const { data, error, reload } = useApi<{ attachments: Attachment[] }>(`/meetings/${meetingId}/attachments`, {
    refreshMs: (d) => (d?.attachments.some((a) => a.status === 'processing') ? 2500 : undefined),
  });
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [flash, setFlash] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const add = useCallback(
    async (files: File[], source: 'paste' | 'drop' | 'pick') => {
      const accepted: File[] = [];
      for (const f of files) {
        if (!isAllowed(f)) toast(`${f.name || 'That file'}: only PDFs and PNG, JPG or WebP images can be attached.`, 'error');
        else if (f.size > (isImage(f) ? MAX_IMAGE : MAX_PDF)) toast(`${f.name}: too large (max ${isImage(f) ? 15 : 25} MB).`, 'error');
        else accepted.push(f);
      }
      if (!accepted.length) return;
      if (source === 'paste') {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      await Promise.all(
        accepted.map(async (file, i) => {
          const name = source === 'paste' ? pastedName(file, i) : file.name;
          const key = `${Date.now()}-${i}-${name}`;
          setUploads((u) => [...u, { key, name, bytes: file.size, progress: 0 }]);
          try {
            await uploadOne(meetingId, file, name, (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))));
            setUploads((u) => u.filter((x) => x.key !== key));
            await reload();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: msg } : x)));
            toast(`${name}: ${msg}`, 'error');
          }
        }),
      );
      if (source === 'paste') toast(accepted.length === 1 ? 'Screenshot attached. Tatva is reading it…' : `${accepted.length} files attached. Tatva is reading them…`, 'success');
    },
    [meetingId, reload, toast],
  );

  // Ctrl+V anywhere on the meeting page (files only; text pastes are left alone).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void add(files, 'paste');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [add]);

  // Drag files anywhere over the page.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void add([...(e.dataTransfer?.files ?? [])], 'drop');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [add]);

  const remove = (a: Attachment) =>
    confirm({
      title: 'Delete attachment',
      icon: 'delete',
      tone: 'danger',
      confirmLabel: 'Delete',
      body: (
        <>
          Delete <span className="text-on-surface">{a.name}</span>? The file, its text in the knowledge base and its line in the meeting&apos;s Google Doc are removed.
        </>
      ),
      run: async () => {
        await api(`/attachments/${a.id}`, { method: 'DELETE' });
        await reload();
        return `Deleted ${a.name}.`;
      },
    });

  const retry = async (a: Attachment) => {
    try {
      await api(`/attachments/${a.id}/retry`, { method: 'POST' });
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const list = data?.attachments ?? [];
  const indexed = list.filter((a) => a.status === 'ready').length;

  return (
    <section
      aria-label="Attachments"
      className={`flex flex-col gap-space-md rounded-xl border bg-surface-container-low p-space-lg shadow-md transition-colors ${flash ? 'border-primary-container/60' : 'border-hairline'}`}
    >
      <div className="flex flex-col justify-between gap-space-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-space-sm">
          <Icon name="attach_file" className="text-headline-sm text-on-surface-variant" />
          <h2 className="text-headline-sm text-on-surface">Attachments ({list.length})</h2>
          {list.length > 0 && <span className="text-caption text-on-surface-variant">{indexed} indexed for Pooja</span>}
        </div>
        <div className="flex items-center gap-space-sm">
          <span className="hidden items-center gap-1 text-caption text-on-surface-variant md:inline-flex">
            <kbd className="rounded border border-hairline bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px]">Ctrl</kbd>+
            <kbd className="rounded border border-hairline bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px]">V</kbd> to paste a screenshot
          </span>
          <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-container-high px-space-md py-2 text-label-md text-on-surface hover:bg-surface-bright">
            <Icon name="upload" className="text-body-lg" /> Add files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              void add([...(e.target.files ?? [])], 'pick');
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}

      {list.length === 0 && uploads.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-hairline-strong px-space-md py-space-lg text-center hover:border-outline hover:bg-surface-container"
        >
          <Icon name="add_photo_alternate" className="text-[28px] text-on-surface-variant" />
          <span className="text-label-md text-on-surface">Drop slides, screenshots or PDFs shared in this meeting</span>
          <span className="text-body-sm text-on-surface-variant">or paste a screenshot with Ctrl+V. Tatva reads them so Pooja can answer from them.</span>
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-space-md sm:grid-cols-2">
          {list.map((a) => (
            <article key={a.id} className="group flex flex-col overflow-hidden rounded-lg border border-hairline bg-surface-container">
              <button type="button" onClick={() => setPreview(a.id)} className="relative block aspect-[16/9] w-full overflow-hidden border-b border-hairline bg-surface-container-lowest" aria-label={`Preview ${a.name}`}>
                <AttachmentThumb a={a} className="transition-transform duration-300 group-hover:scale-[1.02]" />
                <span className="absolute left-2 top-2 rounded-full bg-black/75 backdrop-blur">
                  <StatusPill a={a} />
                </span>
              </button>
              <div className="flex flex-1 flex-col gap-1 p-space-sm">
                <p className="truncate text-label-md text-on-surface" title={a.name}>
                  {a.name}
                </p>
                <p className="flex items-center gap-1.5 text-caption text-on-surface-variant">
                  <span className="font-mono">{fileSize(a.bytes)}</span>
                  <span>·</span>
                  <span className={a.kind === 'pdf' ? '' : 'capitalize'}>{a.kind === 'pdf' ? `PDF, ${a.pages ?? '?'} pages` : (a.label ?? 'image')}</span>
                  <span>·</span>
                  <span>{relativeDateTime(a.created_at)}</span>
                </p>
                <p className="line-clamp-2 min-h-[36px] text-body-sm text-on-surface-variant">
                  {a.status === 'failed' ? <span className="text-error">{a.error}</span> : a.status === 'processing' ? (a.kind === 'image' ? 'Reading the image…' : 'Extracting text…') : a.summary}
                </p>
                <div className="mt-auto flex items-center gap-1 pt-1">
                  <button type="button" onClick={() => setPreview(a.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
                    <Icon name="visibility" className="text-body-md" /> Preview
                  </button>
                  <button type="button" onClick={() => openAttachment(a.id, true).catch((e) => toast(e.message, 'error'))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
                    <Icon name="download" className="text-body-md" /> Download
                  </button>
                  {a.status === 'failed' && (
                    <button type="button" onClick={() => void retry(a)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
                      <Icon name="refresh" className="text-body-md" /> Retry
                    </button>
                  )}
                  <button type="button" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete" className="ml-auto inline-flex items-center rounded-md p-1.5 text-on-surface-variant hover:bg-error-container/40 hover:text-error">
                    <Icon name="delete" className="text-body-lg" />
                  </button>
                </div>
              </div>
            </article>
          ))}
          {uploads.map((u) => (
            <article key={u.key} className="flex flex-col overflow-hidden rounded-lg border border-dashed border-hairline-strong bg-surface-container">
              <div className="flex aspect-[16/9] items-center justify-center bg-surface-container-lowest">
                {u.error ? <Icon name="error" className="text-[28px] text-error" /> : <Spinner className="text-[28px] text-on-surface-variant" />}
              </div>
              <div className="flex flex-col gap-1.5 p-space-sm">
                <p className="truncate text-label-md text-on-surface">{u.name}</p>
                {u.error ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-caption text-error" title={u.error}>
                      {u.error}
                    </p>
                    <button type="button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className="text-caption text-on-surface-variant hover:text-on-surface">
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-container-highest">
                      <div className="h-full rounded-full bg-primary-container transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                    </div>
                    <p className="font-mono text-caption text-on-surface-variant">
                      Uploading {Math.round(u.progress * 100)}% · {fileSize(u.bytes)}
                    </p>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-space-sm rounded-2xl border-2 border-dashed border-primary-container/70 bg-surface-container-low px-space-2xl py-space-xl shadow-2xl">
            <Icon name="file_upload" className="text-[40px] text-primary-container" />
            <p className="text-headline-sm text-on-surface">Drop to attach to {meetingTitle}</p>
            <p className="text-body-sm text-on-surface-variant">PDFs and PNG, JPG or WebP images</p>
          </div>
        </div>
      )}

      {preview && <AttachmentPreview id={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
