/**
 * Keys & Providers settings modal.
 * Lets the user view every registered provider, enter/save an API key,
 * enable/disable it, add a custom provider, or reset to defaults —
 * this is the UI half of ProviderManager, which already had all the
 * underlying data methods but no way for a person to actually reach them.
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

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
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
        <h3>Keys &amp; Providers</h3>
        <p class="hint">Every provider — built-in, preset, or custom — lives in one registry.
          <b style="color:var(--ink-dim);">Keys are saved on this device (browser local storage)</b>
          so you don't need to re-enter them next time — they're only ever sent directly to the
          provider you're calling. On a shared computer, use "Clear device data" before you leave.</p>

        <div class="chip-group" id="providerTypeFilterChips">
          ${TYPE_FILTERS.map(f => `<span class="chip${f.value === 'all' ? ' active' : ''}" data-val="${f.value}">${f.label}</span>`).join('')}
        </div>

        <div id="providerList" style="display:flex; flex-direction:column; gap:8px; max-height:380px; overflow-y:auto;"></div>

        <div class="divider"></div>
        <details class="adv" id="addProviderPanel">
          <summary>+ Add custom provider</summary>
          <div class="adv-body">
            <div class="field-row">
              <div class="field">
                <label class="field-label">Name</label>
                <input type="text" id="np-name" placeholder="My Provider">
              </div>
              <div class="field">
                <label class="field-label">Type</label>
                <select id="np-type">
                  ${TYPE_FILTERS.filter(f => f.value !== 'all').map(f => `<option value="${f.value}">${f.label}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label class="field-label">Base URL</label>
              <input type="text" id="np-baseUrl" placeholder="https://api.example.com/v1">
            </div>
            <div class="field-row">
              <div class="field">
                <label class="field-label">Adapter</label>
                <select id="np-adapterId">
                  <option value="openai-compatible">openai-compatible (generic REST)</option>
                  <option value="huggingface">huggingface</option>
                  <option value="anthropic">anthropic</option>
                  <option value="gemini">gemini</option>
                  <option value="elevenlabs">elevenlabs</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label">Default model</label>
                <input type="text" id="np-defaultModel" placeholder="e.g. gpt-4o-mini">
              </div>
            </div>
            <div class="field">
              <label class="field-label">API key <span class="opt">optional at creation</span></label>
              <input type="password" id="np-apiKey" placeholder="sk-...">
            </div>
            <button class="ghost-btn" id="createProviderBtn">Add provider</button>
          </div>
        </details>

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

    el.querySelector('#createProviderBtn')?.addEventListener('click', () => this.handleCreateProvider());
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
            <button class="ghost-btn small" data-action="toggleVisibility" type="button">👁</button>
          </div>
        </div>`}
        ${p.isBuiltIn ? '' : '<div><button class="ghost-btn small" data-action="delete">Delete</button></div>'}
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

      row.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
        manager.removeProvider(p.id);
        this.renderList();
      });

      list.appendChild(row);
    });
  }

  private handleCreateProvider(): void {
    const name = (document.getElementById('np-name') as HTMLInputElement)?.value.trim();
    const type = (document.getElementById('np-type') as HTMLSelectElement)?.value as ProviderType;
    const baseUrl = (document.getElementById('np-baseUrl') as HTMLInputElement)?.value.trim();
    const adapterId = (document.getElementById('np-adapterId') as HTMLSelectElement)?.value;
    const defaultModel = (document.getElementById('np-defaultModel') as HTMLInputElement)?.value.trim();
    const apiKey = (document.getElementById('np-apiKey') as HTMLInputElement)?.value.trim();

    if (!name || !baseUrl) {
      alert('Name and Base URL are required.');
      return;
    }

    const provider: ProviderConfig = {
      id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      name,
      type,
      adapterId,
      baseUrl,
      authType: 'bearer',
      defaultModel: defaultModel || undefined,
      apiKey: apiKey || undefined,
      timeoutMs: 30000,
      retries: 1,
      priority: 50,
      enabled: true,
      isBuiltIn: false,
      isPreset: false,
    };
    this.kernel.getProviderManager().addProvider(provider);
    this.renderList();

    ['np-name', 'np-baseUrl', 'np-defaultModel', 'np-apiKey'].forEach(id => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = '';
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
