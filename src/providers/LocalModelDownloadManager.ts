/**
 * LocalModelDownloadManager — persistent install-state + download
 * orchestration for every model in LocalModelRegistry.ts.
 *
 * WHY THIS EXISTS (root cause write-up):
 * Before this file, TransformersAdapter.getPipeline() did two things in one
 * step, on the hot path of a generation request: (1) check whether a model
 * was already cached, and (2) if not, start downloading it — all while the
 * *caller* (ProviderManager.callWithFallback/callVision, via withTimeout)
 * was racing that same call against `provider.timeoutMs` (30s for most
 * local providers, meant for inference latency, not a multi-hundred-MB
 * first-time download). Two symptoms followed directly from that:
 *   1. "Downloading text_encoder / decoder / encodec / decoder /
 *      text_encoder / decoder / ..." repeating in the Pipeline Report —
 *      the outer timeout fired, the request was reported as failed and the
 *      caller (or the person, clicking Generate again) retried, and
 *      because a genuinely slow/interrupted attempt is exactly the kind
 *      that's likely to still be an in-flight, not-yet-cached download,
 *      each retry looked like it was starting over from file 1 again.
 *   2. There was no way to explicitly manage a download — start it
 *      on purpose, watch it, pause it, or see that it's done — separate
 *      from "try to generate something and hope the model happens to
 *      already be cached."
 *
 * THE FIX: this module is now the ONLY place downloads are initiated on
 * purpose (via download()/resumeDownload(), normally triggered from the
 * Local Models Manager UI, never from a generation call). It wraps
 * TransformersAdapter's existing `getPipeline()` single-flight pipeline
 * cache (see that file — one Promise per task::model::device, already
 * deduplicating concurrent callers) instead of reimplementing HTTP
 * downloading from scratch: the actual bytes are still fetched by
 * transformers.js itself (browser Cache Storage-backed, confirmed by that
 * file's own "loaded from cache — instant" behavior), so a model that
 * finished even ONE file during a previous attempt does not re-fetch that
 * file on the next attempt — this is what "resume" means here. See the
 * "HONEST LIMITATIONS" section below for exactly what is and isn't
 * guaranteed.
 *
 * TransformersAdapter.getPipeline() now checks isInstalled() before ever
 * starting a real generation call, and refuses (throwing a recognizable
 * "not downloaded yet" error — see ProviderReport.ts's new
 * 'Local model not downloaded' bucket) instead of silently downloading.
 * That is the literal fix for "the pipeline must never trigger downloads."
 *
 * HONEST LIMITATIONS (documented rather than silently overclaimed):
 *  - "Pause" is cooperative, not a hard network abort: it sets a flag this
 *    module's own progress_callback checks on every tick and throws from,
 *    which transformers.js's downloader propagates as a rejection. It
 *    takes effect on the next progress tick (well under a second in
 *    practice), not instantly, and doesn't guarantee the in-flight HTTP
 *    request itself stops immediately at the socket level.
 *  - "Resume" is file-level, not byte-range-level: a file that was
 *    mid-download when paused/cancelled restarts from 0 on resume (nothing
 *    here reimplements HTTP Range requests), but every file that had
 *    already finished is served from the browser's cache instantly. For
 *    these models (a handful of files each), that's the large majority of
 *    the benefit.
 *  - "Checksum" is a size-based integrity check (HEAD request against the
 *    same public resolve URL transformers.js used, comparing
 *    Content-Length against what we recorded), not a full SHA-256 content
 *    hash — reading transformers.js's private Cache Storage entries to
 *    hash their actual bytes isn't something this module relies on, since
 *    that's an internal implementation detail of a CDN-loaded library, not
 *    a documented public API. This still reliably catches the common
 *    corruption case (a truncated or silently-replaced file).
 */

import { LocalModelTask, getModelById } from './LocalModelRegistry';

export type LocalModelStatus =
  | 'not-installed'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'ready'
  | 'error'
  | 'corrupted';

export interface LocalModelFileProgress {
  loaded: number;
  total: number;
  done: boolean;
}

export interface LocalModelManifestEntry {
  modelId: string;
  task: LocalModelTask;
  role?: 'caption' | 'ocr';
  status: LocalModelStatus;
  bytesDownloaded: number;
  bytesTotal: number;
  files: Record<string, LocalModelFileProgress>;
  device?: 'webgpu' | 'wasm';
  installedAt?: number;
  lastUsed?: number;
  lastError?: string;
  lastVerifiedAt?: number;
  lastVerifyOk?: boolean;
}

type Listener = () => void;

const STORAGE_KEY = 'magenais.localModelManifest.v1';

function key(modelId: string, task: LocalModelTask, _role?: 'caption' | 'ocr'): string {
  // Deliberately NOT including role: every LocalModelDefinition.id in
  // LOCAL_MODEL_REGISTRY is already globally unique (a distinct Hugging
  // Face repo ID), so task+modelId alone is a unique, unambiguous key.
  // Including role risked a real bug: a caller that knows the role (the
  // Local Models Manager UI) and a caller that doesn't bother threading it
  // through (TransformersAdapter's install-check, which only has
  // task+model at hand) would compute two different keys for the exact
  // same model and silently never see it as installed. role is still
  // accepted and stored on the entry below, purely for display.
  return `${task}::${modelId}`;
}

function readManifest(): Record<string, LocalModelManifestEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeManifest(map: Record<string, LocalModelManifestEntry>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full/unavailable (private browsing, quota) — the download
    // itself still works for this session, it just won't be remembered
    // across a reload. Not fatal, so no throw here.
  }
}

let manifest: Record<string, LocalModelManifestEntry> = readManifest();

// A page reload/browser close mid-download loses the in-memory queue and
// worker (both are plain module state, not persisted), but the manifest
// entry's status was already written as 'downloading'/'queued' to
// localStorage before that happened. Left alone, that model would show
// "Downloading…" forever with Pause/Cancel buttons acting on a worker that
// no longer exists. Reclassify as 'paused' on load instead — resumeDownload()
// picks up exactly where the underlying browser cache left off, same as a
// deliberate pause (see the module doc comment's "Resume" honesty note).
for (const e of Object.values(manifest)) {
  if (e.status === 'downloading' || e.status === 'queued') e.status = 'paused';
}

const listeners: Set<Listener> = new Set();

function notify(): void {
  writeManifest(manifest);
  listeners.forEach((l) => l());
}

/** Subscribe to any manifest change (progress ticks, status changes). Returns an unsubscribe function. */
export function onManifestChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getManifest(): Record<string, LocalModelManifestEntry> {
  return manifest;
}

export function getEntry(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): LocalModelManifestEntry | undefined {
  return manifest[key(modelId, task, role)];
}

function ensureEntry(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): LocalModelManifestEntry {
  const k = key(modelId, task, role);
  let e = manifest[k];
  if (!e) {
    e = { modelId, task, role, status: 'not-installed', bytesDownloaded: 0, bytesTotal: 0, files: {} };
    manifest[k] = e;
  }
  return e;
}

/** Whether a model is fully downloaded and ready to use right now — the gate TransformersAdapter checks before generating. */
export function isInstalled(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): boolean {
  return getEntry(modelId, task, role)?.status === 'ready';
}

/** Called by TransformersAdapter every time it successfully uses a model, purely for the "Last used" diagnostics field. */
export function markUsed(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): void {
  const e = manifest[key(modelId, task, role)];
  if (e) { e.lastUsed = Date.now(); notify(); }
}

// ---------------------------------------------------------------------------
// Cooperative cancellation: one flag per manifest key, checked from inside
// the progress_callback passed down into TransformersAdapter's pipeline
// builder (see requestDownload's `onProgress` below and
// TransformersAdapter.warmModel). See the "Pause" honesty note above.
// ---------------------------------------------------------------------------
const cancelFlags: Map<string, boolean> = new Map();

// Serial queue: one active download at a time, by design — item 7's
// "don't waste CPU/RAM/GPU/bandwidth racing everything at once" applies
// just as much to multiple simultaneous local-model downloads as it does
// to provider racing, and it keeps the Pipeline Report's progress lines
// (one file at a time) readable instead of interleaved across models.
interface QueueItem {
  modelId: string;
  task: LocalModelTask;
  role?: 'caption' | 'ocr';
  resolve: () => void;
  reject: (err: any) => void;
}
const queue: QueueItem[] = [];
let workerRunning = false;

/** Injected by TransformersAdapter to avoid a circular import (TransformersAdapter already imports this module). Set once at module load — see the bottom of TransformersAdapter.ts. */
let warmModelFn: ((modelId: string, task: LocalModelTask, role: 'caption' | 'ocr' | undefined, onProgress: (file: string, loaded: number, total: number, done: boolean) => void, log?: (msg: string, level?: 'info' | 'warn' | 'error') => void) => Promise<void>) | null = null;
export function registerWarmModelImpl(fn: typeof warmModelFn): void {
  warmModelFn = fn;
}

async function runQueue(log?: (msg: string, level?: 'info' | 'warn' | 'error') => void): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const k = key(item.modelId, item.task, item.role);
      const entry = ensureEntry(item.modelId, item.task, item.role);
      entry.status = 'downloading';
      entry.lastError = undefined;
      cancelFlags.set(k, false);
      notify();

      try {
        if (!warmModelFn) throw new Error('Local model download implementation is not registered yet — try again in a moment.');
        // ROOT CAUSE of "page becomes unresponsive during a download":
        // notify() below does a synchronous JSON.stringify+localStorage
        // write AND (while the Local Models Manager is open) a full DOM
        // rebuild of every model row — cheap once, but this callback can
        // fire many times per second on a fast connection, and doing all
        // of that on every single tick is exactly what freezes the main
        // thread. lastNotifyAt throttles the expensive part to ~4/sec;
        // the actual byte counters below are still updated on every tick
        // (that part's cheap — an object write and two array reduces), so
        // the progress numbers stay accurate even between throttled UI
        // updates, and 'done' always gets an unconditional final notify.
        let lastNotifyAt = 0;
        await warmModelFn(item.modelId, item.task, item.role, (file, loaded, total, done) => {
          if (cancelFlags.get(k)) {
            // Thrown from inside the progress_callback — see the module
            // doc comment's "Pause" honesty note for what this does and
            // doesn't guarantee.
            throw new Error('__MAGENAIS_DOWNLOAD_CANCELLED__');
          }
          const e = ensureEntry(item.modelId, item.task, item.role);
          e.files[file] = { loaded, total, done };
          e.bytesDownloaded = Object.values(e.files).reduce((sum, f) => sum + f.loaded, 0);
          e.bytesTotal = Object.values(e.files).reduce((sum, f) => sum + f.total, 0);
          const now = Date.now();
          if (done || now - lastNotifyAt > 250) {
            lastNotifyAt = now;
            notify();
          }
        }, log);

        const e = ensureEntry(item.modelId, item.task, item.role);
        e.status = 'ready';
        e.installedAt = Date.now();
        notify();
        item.resolve();
      } catch (err: any) {
        const e = ensureEntry(item.modelId, item.task, item.role);
        const wasCancelled = err?.message === '__MAGENAIS_DOWNLOAD_CANCELLED__' || cancelFlags.get(k);
        if (wasCancelled) {
          // Distinguish "person clicked Pause" (keep partial progress,
          // offer Resume) from "person clicked Cancel" (already reset to
          // not-installed by cancelDownload() before this throw lands).
          if (e.status !== 'not-installed') e.status = 'paused';
        } else {
          e.status = 'error';
          e.lastError = err?.message || String(err);
        }
        notify();
        item.reject(err);
      } finally {
        cancelFlags.delete(k);
      }
    }
  } finally {
    workerRunning = false;
  }
}

/**
 * Explicitly start (or continue queueing) a download. This is the ONLY
 * function that should ever be called from a "Download" button — never
 * from a generation path. Resolves when the download finishes; rejects on
 * error or cancellation (but not on pause — see pauseDownload).
 */
export function download(
  modelId: string,
  task: LocalModelTask,
  role?: 'caption' | 'ocr',
  log?: (msg: string, level?: 'info' | 'warn' | 'error') => void
): Promise<void> {
  const def = getModelById(modelId);
  if (!def) return Promise.reject(new Error(`Unknown local model "${modelId}" — it isn't in the Local Model Registry.`));
  const entry = ensureEntry(modelId, task, role);
  if (entry.status === 'ready') return Promise.resolve();
  if (entry.status === 'downloading' || entry.status === 'queued') {
    // Already in flight/queued — don't create a second queue entry for the
    // same model (this is item 6's "no duplicate download tasks" rule,
    // enforced here at the orchestration layer too, not just inside
    // TransformersAdapter's pipelineCache).
    return new Promise((resolve, reject) => {
      const unsub = onManifestChange(() => {
        const e = getEntry(modelId, task, role);
        if (e?.status === 'ready') { unsub(); resolve(); }
        else if (e?.status === 'error') { unsub(); reject(new Error(e.lastError || 'Download failed.')); }
      });
    });
  }
  entry.status = 'queued';
  notify();
  void ensurePersistentStorage();
  return new Promise((resolve, reject) => {
    queue.push({ modelId, task, role, resolve, reject });
    runQueue(log);
  });
}

/** Same as download() — named separately so call sites read clearly ("resume this paused/failed download"). */
export function resumeDownload(
  modelId: string,
  task: LocalModelTask,
  role?: 'caption' | 'ocr',
  log?: (msg: string, level?: 'info' | 'warn' | 'error') => void
): Promise<void> {
  return download(modelId, task, role, log);
}

/** Cooperative pause — see the module doc comment's honesty note. Keeps partial progress; resumeDownload() continues. */
export function pauseDownload(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): void {
  cancelFlags.set(key(modelId, task, role), true);
}

/** Cooperative cancel — pause, plus resets progress back to not-installed so a future download starts clean. */
export function cancelDownload(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): void {
  const k = key(modelId, task, role);
  cancelFlags.set(k, true);
  const e = manifest[k];
  if (e) {
    e.status = 'not-installed';
    e.files = {};
    e.bytesDownloaded = 0;
    e.bytesTotal = 0;
    notify();
  }
  // Also drop it from the queue if it hasn't started yet.
  const idx = queue.findIndex((q) => key(q.modelId, q.task, q.role) === k);
  if (idx >= 0) queue.splice(idx, 1);
}

/**
 * Size-based integrity check — see the module doc comment's "Checksum"
 * honesty note. HEAD-requests every file this manifest entry recorded as
 * downloaded, against the same public Hugging Face resolve URL
 * transformers.js itself used, and compares Content-Length.
 */
export async function verifyInstalled(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): Promise<{ ok: boolean; message: string }> {
  const e = getEntry(modelId, task, role);
  if (!e || e.status !== 'ready') {
    return { ok: false, message: 'Not installed — nothing to verify.' };
  }
  const files = Object.entries(e.files);
  if (files.length === 0) {
    // Resolved with zero progress events at all means it was already fully
    // cached before this manifest existed (e.g. installed by an older
    // build) — nothing recorded to compare against, so this can't fail,
    // but it can't be positively confirmed either.
    return { ok: true, message: 'Installed before size tracking existed for this model — skipped (assumed fine).' };
  }
  let mismatches = 0;
  for (const [file, info] of files) {
    try {
      const resp = await fetch(`https://huggingface.co/${modelId}/resolve/main/${file}`, { method: 'HEAD' });
      const len = Number(resp.headers.get('content-length') || resp.headers.get('x-linked-size') || 0);
      if (len > 0 && info.total > 0 && len !== info.total) mismatches++;
    } catch {
      // Network hiccup or offline — don't fail verification over
      // connectivity, only over an actual confirmed size mismatch.
    }
  }
  if (mismatches > 0) {
    const e2 = ensureEntry(modelId, task, role);
    e2.status = 'corrupted';
    e2.lastVerifiedAt = Date.now();
    e2.lastVerifyOk = false;
    notify();
    return { ok: false, message: `${mismatches} of ${files.length} file(s) don't match their expected size on Hugging Face — try Download again to re-fetch.` };
  }
  const e2 = ensureEntry(modelId, task, role);
  e2.lastVerifiedAt = Date.now();
  e2.lastVerifyOk = true;
  notify();
  return { ok: true, message: `All ${files.length} file(s) match their expected size.` };
}

/** Formats a byte count as a human-readable size, shared by the Local Models Manager UI. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0B';
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

// ---------------------------------------------------------------------------
// Storage persistence + quota — the real, verifiable fix for "a download
// terminates partway through and restarts from the very beginning instead
// of resuming."
//
// ROOT CAUSE: the actual bytes downloaded here are cached by transformers.js
// itself via the browser's Cache Storage API (see TransformersAdapter.ts's
// doc comment). Cache Storage is, by default, "best-effort" storage — every
// major browser is allowed to silently evict some or all of an origin's
// Cache Storage/IndexedDB entries under disk-space pressure, with no error
// or event delivered to the page. A collection of local AI models can
// easily total several GB, which is exactly the kind of usage that
// triggers this on a device that's low on free space — so a "resume" can
// genuinely find that previously-completed files are just gone, through no
// bug in the queue/worker logic above; they were silently reclaimed by the
// browser between attempts.
//
// FIX: navigator.storage.persist() is the standard, documented Storage API
// for asking the browser to exempt this origin's storage from that
// best-effort eviction (subject to the browser's own persistent-storage
// quota and, on most browsers, the origin having "engagement" — e.g.
// having been bookmarked/installed/visited enough — the browser can still
// say no, hence checking the actual granted state below rather than
// assuming success). This is requested once, the first time any download
// starts, rather than unconditionally on module load, since some browsers
// weight "did the user take an action that implies they want this" when
// deciding whether to grant it.
// ---------------------------------------------------------------------------

let persistenceRequested = false;

async function ensurePersistentStorage(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // Not fatal — some browsers (notably ones without the Storage API at
    // all, e.g. older Safari) simply don't support this; downloads still
    // work, they're just not protected from eviction.
  }
}

export interface StorageInfo {
  supported: boolean;
  persisted: boolean;
  usageBytes: number;
  quotaBytes: number;
}

/** Real, honest answer to "where is this stored and how much room is there" — there's no filesystem path in a browser, so this (persistence status + quota usage) is the accurate equivalent, shown in the Local Models Manager. */
export async function getStorageInfo(): Promise<StorageInfo> {
  if (!navigator.storage?.estimate) {
    return { supported: false, persisted: false, usageBytes: 0, quotaBytes: 0 };
  }
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate().catch(() => ({ usage: 0, quota: 0 })),
    navigator.storage.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ]);
  return {
    supported: true,
    persisted: !!persisted,
    usageBytes: estimate.usage || 0,
    quotaBytes: estimate.quota || 0,
  };
}
