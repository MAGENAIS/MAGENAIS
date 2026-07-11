/**
 * Generation History modal. Reads from Store's history slice (populated by
 * each Mode via kernel.getStore().getActions().addHistoryEntry(...) after a
 * successful generation) and lets the user browse or clear it.
 */
import { Kernel } from '../core/Kernel';
import { HistoryEntry } from '../core/state/Actions';

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export class HistoryModal {
  private kernel: Kernel;
  private onReload?: (entry: HistoryEntry) => void;

  constructor(kernel: Kernel, onReload?: (entry: HistoryEntry) => void) {
    this.kernel = kernel;
    this.onReload = onReload;
  }

  open(): void {
    this.ensureDom();
    this.render();
    document.getElementById('historyModal')?.classList.add('open');
  }

  private close(): void {
    document.getElementById('historyModal')?.classList.remove('open');
  }

  private ensureDom(): void {
    if (document.getElementById('historyModal')) return;
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'historyModal';
    el.innerHTML = `
      <div class="modal" style="max-width:720px;">
        <button class="modal-close" id="closeHistory">×</button>
        <h3>Generation History</h3>
        <p class="hint">Stored only on this device (browser local storage). Click any item to reload it.</p>
        <div id="historyGrid" style="display:flex; flex-direction:column; gap:8px; max-height:420px; overflow-y:auto;"></div>
        <div class="divider"></div>
        <button class="ghost-btn small" id="clearHistoryBtn" style="border-color:var(--rust); color:var(--rust);">Clear history</button>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('#closeHistory')?.addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    el.querySelector('#clearHistoryBtn')?.addEventListener('click', () => {
      if (!confirm('Clear all generation history on this device?')) return;
      this.kernel.getStore().getActions().clearHistory();
      this.render();
    });
  }

  private render(): void {
    const grid = document.getElementById('historyGrid');
    if (!grid) return;
    const entries: HistoryEntry[] = this.kernel.getStore().getState().history || [];

    if (entries.length === 0) {
      grid.innerHTML = '<p class="hint">Nothing generated yet — your history will appear here after you run something.</p>';
      return;
    }

    grid.innerHTML = '';
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'provider-row';
      row.style.cursor = 'pointer';

      let preview = '';
      if (entry.resultType === 'image' && typeof entry.result === 'string') {
        preview = `<img src="${entry.result}" style="max-height:64px; border-radius:4px; margin-top:6px;">`;
      } else if (entry.resultType === 'video' && typeof entry.result === 'string') {
        preview = `<video src="${entry.result}" style="max-height:64px; border-radius:4px; margin-top:6px;" muted></video>`;
      } else if (typeof entry.result === 'string') {
        preview = `<div class="provider-meta" style="margin-top:4px; -webkit-line-clamp:2; display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(entry.result.slice(0, 180))}</div>`;
      }

      row.innerHTML = `
        <div class="provider-row-top">
          <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
            <span class="provider-name">${escapeHtml(entry.mode)} · ${escapeHtml((entry.prompt || '').slice(0, 60))}</span>
            <span class="provider-meta">${timeAgo(entry.timestamp)}</span>
          </div>
        </div>
        ${preview}
      `;
      row.addEventListener('click', () => {
        this.onReload?.(entry);
        this.close();
      });
      grid.appendChild(row);
    });
  }
}
