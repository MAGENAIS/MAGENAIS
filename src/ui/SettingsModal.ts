/**
 * Universal Provider Manager — the Keys & Providers settings modal.
 * Lets the user view every registered provider, enter/save an API key,
 * enable/disable, edit every field, duplicate, delete, add a custom
 * provider, or reset to defaults. This is the UI half of ProviderManager,
 * which already had all the underlying data methods but no way for a
 * person to actually reach them.
 */
import { Kernel } from '../core/Kernel';
import { ProviderConfig, ProviderType } from '../providers/types';
import { DEFAULT_PROVIDERS } from '../providers/defaultProviders';

const TYPE_FILTERS: Array<{ value: ProviderType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio (STT)' },
  { value: 'speech', label: 'Speech (TTS)' },
  { value: 'music', label: 'Music' },
  { value: 'coding', label: 'Coding' },
  { value: 'agents', label: 'Agents' },
  { value: 'mcp', label: 'MCP' },
  { value: 'research', label: 'Research' },
  { value: 'gamegen', label: 'Game Generation' },
];

const ADAPTER_OPTIONS = [
  'openai-compatible', 'openai', 'groq', 'together', 'deepinfra', 'openrouter',
  'falai', 'replicate', 'deepgram', 'assemblyai', 'playht', 'huggingface',
  'pollinations', 'anthropic', 'gemini', 'elevenlabs', 'puter', 'browser-speech',
  'internal-fallback',
];

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

function blankProvider(): ProviderConfig {
  return {
    id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    name: 'New Provider',
    type: 'text',
    adapterId: 'openai-compatible',
    baseUrl: '',
    authType: 'bearer',
    authHeaderName: 'Authorization',
    defaultModel: '',
    timeoutMs: 30000,
    retries: 1,
    priority: 50,
    enabled: false,
    isBuiltIn: false,
    isPreset: false,
    noKeyNeeded: false,
  };
}

export class SettingsModal {
  private kernel: Kernel;
  private activeFilter: ProviderType | 'all' = 'all';

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  open(): void {
    this.ensureDom();
    this.renderList();
    document.getElementById('settingsModal')?.classList.add('open');
  }

  private close(): void {
    document.getElementById('settingsModal')?.classList.remove('open');
  }

  private ensureDom(): void {
    if (document.getElementById('settingsModal')) return;

    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'settingsModal';
    el.innerHTML = `
      <div class="modal" style="max-width:760px;">
        <button class="modal-close" id="closeSettings">×</button>
        <h3>Universal Provider Manager</h3>
        <p class="hint">Every provider — built-in, preset, or custom — lives in one registry. Add, edit, duplicate, or delete anything.
          <b style="color:var(--ink-dim);">Keys are saved on this device (browser local storage)</b>
          so you don't need to re-enter them next time — they're only ever sent directly to the
          provider you're calling. On a shared computer, use "Clear device data" before you leave.</p>

        <div class="chip-group" id="providerTypeFilterChips">
          ${TYPE_FILTERS.map(f => `<span class="chip${f.value === 'all' ? ' active' : ''}" data-val="${f.value}">${f.label}</span>`).join('')}
        </div>

        <div id="providerList" style="display:flex; flex-direction:column; gap:8px; max-height:380px; overflow-y:auto;"></div>

        <div class="divider"></div>
        <button class="ghost-btn" id="addProviderBtn" style="width:100%;">+ Add custom provider</button>

        <div class="divider"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="ghost-btn small" id="resetProvidersBtn">Reset to defaults</button>
          <button class="ghost-btn small" id="clearDeviceDataBtn" style="border-color:var(--rust); color:var(--rust);">Clear device data</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('#closeSettings')?.addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => {
      if (e.target === el) this.close();
    });

    el.querySelectorAll('#providerTypeFilterChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        el.querySelectorAll('#providerTypeFilterChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeFilter = (chip as HTMLElement).dataset.val as ProviderType | 'all';
        this.renderList();
      });
    });

    el.querySelector('#addProviderBtn')?.addEventListener('click', () => this.openEditor(blankProvider(), true));
    el.querySelector('#resetProvidersBtn')?.addEventListener('click', () => this.handleReset());
    el.querySelector('#clearDeviceDataBtn')?.addEventListener('click', () => this.handleClearData());
  }

  private renderList(): void {
    const list = document.getElementById('providerList');
    if (!list) return;

    const manager = this.kernel.getProviderManager();
    const providers = manager
      .getProviders(this.activeFilter === 'all' ? undefined : this.activeFilter)
      .sort((a: ProviderConfig, b: ProviderConfig) => a.priority - b.priority);

    if (providers.length === 0) {
      list.innerHTML = '<p class="hint">No providers in this category yet.</p>';
      return;
    }

    list.innerHTML = '';
    providers.forEach((p: ProviderConfig) => {
      const row = document.createElement('div');
      row.className = 'provider-row';

      const statusColor = p.enabled ? 'var(--moss)' : 'var(--ink-faint)';
      const keyStatus = p.noKeyNeeded
        ? '<span class="key-status set">no key needed</span>'
        : p.apiKey
          ? '<span class="key-status set">key set</span>'
          : '<span class="key-status unset">no key set</span>';
      const builtInBadge = p.isBuiltIn ? ' · <span style="color:var(--azure);">built-in</span>' : '';

      row.innerHTML = `
        <div class="provider-row-top">
          <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
            <span class="provider-name" style="color:${statusColor};">${escapeHtml(p.name)}</span>
            <span class="provider-meta">${escapeHtml(p.type)} · priority ${p.priority} · ${keyStatus}${builtInBadge}</span>
          </div>
          <label style="display:flex; align-items:center; gap:5px; cursor:pointer; flex-shrink:0;">
            <input type="checkbox" data-action="toggle" ${p.enabled ? 'checked' : ''} style="width:auto;">
          </label>
        </div>
        ${p.noKeyNeeded ? '' : `
        <div class="key-row">
          <div style="display:flex; gap:6px;">
            <input type="password" data-action="apiKey" placeholder="API key" value="${escapeHtml(p.apiKey || '')}" style="flex:1;">
            <button class="ghost-btn small" data-action="toggleVisibility" type="button" title="Show or hide the key">👁</button>
          </div>
        </div>`}
        <div style="display:flex; gap:6px;">
          <button class="ghost-btn small" data-action="edit">Edit</button>
          <button class="ghost-btn small" data-action="duplicate">Duplicate</button>
          ${p.isBuiltIn ? '' : '<button class="ghost-btn small" data-action="delete">Delete</button>'}
        </div>
      `;

      row.querySelector('[data-action="toggle"]')?.addEventListener('change', (e) => {
        manager.setEnabled(p.id, (e.target as HTMLInputElement).checked);
        this.renderList();
      });

      const keyInput = row.querySelector('[data-action="apiKey"]') as HTMLInputElement | null;
      if (keyInput) {
        const save = () => {
          manager.updateProvider(p.id, { apiKey: keyInput.value.trim() });
          this.renderList();
        };
        keyInput.addEventListener('blur', save);
        keyInput.addEventListener('keydown', (e) => {
          if ((e as KeyboardEvent).key === 'Enter') { keyInput.blur(); }
        });
      }
      row.querySelector('[data-action="toggleVisibility"]')?.addEventListener('click', () => {
        if (keyInput) keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      });

      row.querySelector('[data-action="edit"]')?.addEventListener('click', () => this.openEditor(p, false));
      row.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => {
        const clone: ProviderConfig = {
          ...p,
          id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          name: p.name + ' (copy)',
          isBuiltIn: false,
          isPreset: false,
        };
        manager.addProvider(clone);
        this.renderList();
      });
      row.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
        manager.removeProvider(p.id);
        this.renderList();
      });

      list.appendChild(row);
    });
  }

  /** Full field-by-field provider editor — used for both "Edit" and "Add custom provider". */
  private openEditor(provider: ProviderConfig, isNew: boolean): void {
    let modal = document.getElementById('providerEditModal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'providerEditModal';
    modal.innerHTML = `
      <div class="modal" style="max-width:560px;">
        <button class="modal-close" id="closeProviderEdit">×</button>
        <h3>${isNew ? 'Add Provider' : 'Edit Provider'}</h3>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Name</label>
            <input type="text" id="pe-name" value="${escapeHtml(provider.name)}">
          </div>
          <div class="field">
            <label class="field-label">Priority <span class="opt">lower runs first</span></label>
            <input type="number" id="pe-priority" value="${provider.priority}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Type</label>
            <select id="pe-type">
              ${TYPE_FILTERS.filter(f => f.value !== 'all').map(f => `<option value="${f.value}" ${f.value === provider.type ? 'selected' : ''}>${f.label}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Adapter</label>
            <select id="pe-adapterId">
              ${ADAPTER_OPTIONS.map(a => `<option value="${a}" ${a === provider.adapterId ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Base URL</label>
          <input type="text" id="pe-baseUrl" value="${escapeHtml(provider.baseUrl || '')}" placeholder="https://api.example.com/v1">
        </div>
        <div class="field">
          <label class="field-label">API key <span class="opt">leave blank if not required</span></label>
          <input type="password" id="pe-apiKey" value="${escapeHtml(provider.apiKey || '')}">
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Auth type</label>
            <select id="pe-authType">
              <option value="bearer" ${provider.authType === 'bearer' ? 'selected' : ''}>Bearer token</option>
              <option value="header" ${provider.authType === 'header' ? 'selected' : ''}>Custom header</option>
              <option value="query" ${provider.authType === 'query' ? 'selected' : ''}>Query param</option>
              <option value="none" ${provider.authType === 'none' ? 'selected' : ''}>None</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">Auth field name</label>
            <input type="text" id="pe-authFieldName" value="${escapeHtml(provider.authHeaderName || provider.authQueryParam || 'Authorization')}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Default model</label>
            <input type="text" id="pe-defaultModel" value="${escapeHtml(provider.defaultModel || '')}">
          </div>
          <div class="field">
            <label class="field-label">Timeout (ms)</label>
            <input type="number" id="pe-timeoutMs" value="${provider.timeoutMs || 30000}">
          </div>
        </div>
        <label style="display:flex; align-items:center; gap:6px; margin:10px 0; cursor:pointer;">
          <input type="checkbox" id="pe-noKeyNeeded" style="width:auto;" ${provider.noKeyNeeded ? 'checked' : ''}>
          <span class="field-label" style="margin:0;">No API key needed</span>
        </label>
        <div class="field">
          <label class="field-label">Notes <span class="opt">optional</span></label>
          <textarea id="pe-notes" rows="2">${escapeHtml(provider.notes || '')}</textarea>
        </div>
        <button class="run-btn" id="saveProviderBtn">${isNew ? 'Add provider' : 'Save changes'}</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.classList.add('open');

    const m = modal;
    m.querySelector('#closeProviderEdit')?.addEventListener('click', () => m.remove());
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });

    m.querySelector('#saveProviderBtn')?.addEventListener('click', () => {
      const authType = (document.getElementById('pe-authType') as HTMLSelectElement).value as ProviderConfig['authType'];
      const authFieldName = (document.getElementById('pe-authFieldName') as HTMLInputElement).value.trim();
      const updated: ProviderConfig = {
        ...provider,
        name: (document.getElementById('pe-name') as HTMLInputElement).value.trim() || 'Unnamed Provider',
        priority: parseInt((document.getElementById('pe-priority') as HTMLInputElement).value, 10) || 50,
        type: (document.getElementById('pe-type') as HTMLSelectElement).value as ProviderType,
        adapterId: (document.getElementById('pe-adapterId') as HTMLSelectElement).value,
        baseUrl: (document.getElementById('pe-baseUrl') as HTMLInputElement).value.trim(),
        apiKey: (document.getElementById('pe-apiKey') as HTMLInputElement).value.trim() || undefined,
        authType,
        authHeaderName: authType === 'header' || authType === 'bearer' ? authFieldName : provider.authHeaderName,
        authQueryParam: authType === 'query' ? authFieldName : provider.authQueryParam,
        defaultModel: (document.getElementById('pe-defaultModel') as HTMLInputElement).value.trim() || undefined,
        timeoutMs: parseInt((document.getElementById('pe-timeoutMs') as HTMLInputElement).value, 10) || 30000,
        noKeyNeeded: (document.getElementById('pe-noKeyNeeded') as HTMLInputElement).checked,
        notes: (document.getElementById('pe-notes') as HTMLTextAreaElement).value.trim() || undefined,
        enabled: isNew ? true : provider.enabled,
      };

      if (!updated.name || !updated.baseUrl) {
        alert('Name and Base URL are required.');
        return;
      }

      const manager = this.kernel.getProviderManager();
      if (isNew) {
        manager.addProvider(updated);
      } else {
        manager.updateProvider(provider.id, updated);
      }
      m.remove();
      this.renderList();
    });
  }

  private handleReset(): void {
    if (!confirm('Reset all providers to defaults? Any custom providers and saved API keys will be lost.')) return;
    this.kernel.getProviderManager().resetToDefaults(DEFAULT_PROVIDERS).then(() => this.renderList());
  }

  private handleClearData(): void {
    if (!confirm('Clear all saved provider data (including API keys) from this device? This cannot be undone.')) return;
    this.kernel.getProviderManager().clearAllData().then(() => this.renderList());
  }
}
