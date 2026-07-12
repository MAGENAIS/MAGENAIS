import { Store } from './Store';

export interface HistoryEntry {
  id: string;
  mode: string;
  prompt: string;
  result: any;
  resultType: 'text' | 'image' | 'video' | 'audio' | 'other';
  timestamp: number;
}

// Above this, a media entry is kept working for the current session (its
// blob: URL still renders fine right now) but is NOT embedded into
// persisted history — converting a large video to a base64 data: URL would
// bloat localStorage enough to risk pushing everything else (including
// provider API keys, sharing the same storage key) over quota.
const MAX_PERSISTABLE_MEDIA_BYTES = 2_000_000;

/**
 * blob: URLs from URL.createObjectURL() only resolve for the lifetime of
 * the document that created them — they are NOT valid after a page reload,
 * even though the history *entry* referencing one is happily persisted to
 * localStorage. That's the root cause behind "History loses previous
 * generated content": the entry survives, but every image/video/audio
 * thumbnail and reload silently breaks because the underlying blob is gone.
 * This converts a blob: URL to a self-contained base64 data: URL — which
 * *does* survive JSON.stringify -> localStorage -> reload -> JSON.parse —
 * so history stays genuinely retrievable across sessions.
 */
async function blobUrlToPersistableDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    if (blob.size > MAX_PERSISTABLE_MEDIA_BYTES) return null;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    // Adapter-hosted images (Pollinations, etc.) are already http(s) URLs,
    // not blob: URLs, and don't need conversion — this only ever gets
    // called for actual blob: strings, but stay defensive regardless.
    return null;
  }
}

export class Actions {
  constructor(private store: Store) {}

  // Example actions – will grow in later phases
  setTheme(theme: string): void {
    this.store.dispatch({ type: 'SET_THEME', payload: theme });
  }

  addProvider(provider: any): void {
    this.store.dispatch({ type: 'ADD_PROVIDER', payload: provider });
  }

  addHistoryEntry(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
    const id = 'hist-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    this.store.dispatch({
      type: 'ADD_HISTORY_ENTRY',
      payload: { ...entry, id, timestamp: Date.now() },
    });

    // Fire-and-forget: the entry is already visible/usable immediately via
    // its (still-valid, in this session) blob: URL. In the background,
    // swap in a persistable copy so it's still there after a reload too.
    if (
      (entry.resultType === 'image' || entry.resultType === 'video' || entry.resultType === 'audio') &&
      typeof entry.result === 'string' &&
      entry.result.startsWith('blob:')
    ) {
      blobUrlToPersistableDataUrl(entry.result).then(dataUrl => {
        if (dataUrl) {
          this.store.dispatch({ type: 'UPDATE_HISTORY_ENTRY', payload: { id, patch: { result: dataUrl } } });
        }
        // null means "too large to persist" — leave the entry as-is; it
        // still works for the rest of this session, it just won't survive
        // a reload, which is an honest tradeoff given storage limits
        // rather than a silent failure.
      });
    }
  }

  clearHistory(): void {
    this.store.dispatch({ type: 'CLEAR_HISTORY' });
  }

  // ... more actions
}
