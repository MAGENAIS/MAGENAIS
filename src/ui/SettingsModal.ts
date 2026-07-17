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
import { ProviderValidator } from '../config/ProviderValidator';
import {
  LocalModelTask,
  getModelsForTask,
  getSelectedModelId,
  setSelectedModelId,
  getModelById,
} from '../providers/LocalModelRegistry';
import { disposeModelPipelines } from '../providers/adapters/TransformersAdapter';

/**
 * Maps a ProviderConfig backed by TransformersAdapter to the
 * (task, role) pair LocalModelRegistry indexes models by — based on
 * `type`/`visionOnly`, not on the provider's `id`, so this still works for
 * a duplicated/custom copy of a built-in transformers provider (whose id
 * won't match 'builtin-transformers-*'). Returns null for any provider not
 * backed by the 'transformers' adapter, since only that adapter reads from
 * the registry.
 */
function localTaskForProvider(provider: ProviderConfig): { task: LocalModelTask; role?: 'caption' | 'ocr' } | null {
  if (provider.adapterId !== 'transformers') return null;
  if (provider.type === 'text' && provider.visionOnly) return { task: 'image-to-text', role: 'caption' };
  if (provider.type === 'text') return { task: 'text-generation' };
  if (provider.type === 'audio') return { task: 'automatic-speech-recognition' };
  if (provider.type === 'music') return { task: 'text-to-audio' };
  if (provider.type === 'embeddings') return { task: 'feature-extraction' };
  return null;
}

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

function blankProvider(type: ProviderType = 'text'): ProviderConfig {
  return {
    id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    name: 'New Provider',
    type,
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
    this.renderLocalModelsList();
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
        <details class="log-details" id="localModelsDetails">
          <summary>Local models (Transformers.js, in-browser)</summary>
          <div style="padding:10px 12px 12px; display:flex; flex-direction:column; gap:10px;">
            <p class="hint">These run entirely on-device — no key, no signup. The main text/vision/audio/embeddings
              models are edited from their provider row above ("Edit" → "Default model"); the three below are
              sub-tasks that share a provider with something else, so they're configured here instead.</p>
            <div id="localModelsList" style="display:flex; flex-direction:column; gap:10px;"></div>
          </div>
        </details>

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

    el.querySelector('#addProviderBtn')?.addEventListener('click', () =>
      this.openEditor(blankProvider(this.activeFilter === 'all' ? 'text' : this.activeFilter), true)
    );
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

      // ROOT CAUSE (reported: "many providers checked/green while not set
      // yet"): this used to color the name green purely from `p.enabled`
      // (the fallback-rotation toggle), regardless of whether the provider
      // actually has a key and can ever be called. Nearly every built-in
      // preset ships `enabled: true` by design (so it activates the moment
      // a key is added, with no second toggle to remember) — but that made
      // an entirely unconfigured install look like a wall of ready, green
      // providers. Color now reflects real usability: green only when it
      // can actually be called right now; amber for "enabled but missing
      // its key"; gray for actually disabled.
      const isUsable = p.enabled && (p.noKeyNeeded || !!p.apiKey);
      const statusColor = isUsable ? 'var(--moss)' : p.enabled ? 'var(--rust)' : 'var(--ink-faint)';
      const keyStatus = p.noKeyNeeded
        ? '<span class="key-status set">no key needed</span>'
        : p.apiKey
          ? '<span class="key-status set">key set</span>'
          : '<span class="key-status unset">no key set — add one below to activate</span>';
      const builtInBadge = p.isBuiltIn ? ' · <span style="color:var(--azure);">built-in</span>' : '';

      row.innerHTML = `
        <div class="provider-row-top">
          <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
            <span class="provider-name" style="color:${statusColor};">${escapeHtml(p.name)}</span>
            <span class="provider-meta">${escapeHtml(p.type)} · priority ${p.priority} · ${keyStatus}${builtInBadge}</span>
          </div>
          <label style="display:flex; align-items:center; gap:5px; cursor:pointer; flex-shrink:0;" title="${p.noKeyNeeded || p.isBuiltIn || p.apiKey ? 'Enable or disable this provider' : 'Enabled providers activate automatically once you add an API key below'}">
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
          const trimmed = keyInput.value.trim();
          if (trimmed === (p.apiKey || '')) return; // no change, skip the churn
          manager.updateProvider(p.id, { apiKey: trimmed });
          p.apiKey = trimmed;
          // Patch this row's own status text/color in place instead of
          // tearing down and rebuilding the entire provider list (which
          // previously happened on every single blur) — avoids any chance
          // of replacing DOM elements out from under an in-progress click
          // elsewhere in the list.
          const isUsableNow = p.enabled && (p.noKeyNeeded || !!p.apiKey);
          const nameEl = row.querySelector('.provider-name') as HTMLElement | null;
          if (nameEl) nameEl.style.color = isUsableNow ? 'var(--moss)' : p.enabled ? 'var(--rust)' : 'var(--ink-faint)';
          const metaEl = row.querySelector('.key-status') as HTMLElement | null;
          if (metaEl) {
            metaEl.textContent = p.apiKey ? 'key set' : 'no key set — add one below to activate';
            metaEl.className = p.apiKey ? 'key-status set' : 'key-status unset';
          }
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

  /**
   * Renders the three Transformers.js sub-task pickers (summarization,
   * translation, OCR) that don't have their own ProviderConfig row — see
   * localTaskForProvider's doc comment for why those four DO get one and
   * these three don't. Each selection is read/written straight through
   * LocalModelRegistry's own localStorage-backed storage, independent of
   * ProviderManager, since there's no provider row to persist it on.
   */
  private renderLocalModelsList(): void {
    const list = document.getElementById('localModelsList');
    if (!list) return;

    // OCR shares the 'image-to-text' transformers.js task with captioning —
    // captioning's default lives on the builtin-transformers-vision
    // provider row instead (see localTaskForProvider), so only OCR needs a
    // row here.
    const rows: Array<{ label: string; task: LocalModelTask; role?: 'caption' | 'ocr' }> = [
      { label: 'Summarization (used by Documents/Research when summarizing text)', task: 'summarization' },
      { label: 'Translation (English source only, see model notes)', task: 'translation' },
      { label: 'OCR (reading text in images, used by Vision)', task: 'image-to-text', role: 'ocr' },
    ];

    list.innerHTML = '';
    rows.forEach(({ label, task, role }) => {
      const options = getModelsForTask(task, role);
      if (options.length === 0) return;
      const selected = getSelectedModelId(task, role);

      const row = document.createElement('div');
      row.className = 'field';
      row.innerHTML = `
        <label class="field-label">${label}</label>
        <select data-task="${task}" ${role ? `data-role="${role}"` : ''}>
          ${options.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === selected ? 'selected' : ''}>${escapeHtml(m.displayName)}${m.recommended ? ' (recommended)' : ''}</option>`).join('')}
        </select>
        <p class="hint" data-meta style="margin-top:4px;"></p>
      `;
      const select = row.querySelector('select') as HTMLSelectElement;
      const meta = row.querySelector('[data-meta]') as HTMLElement;
      const updateMeta = () => {
        const def = getModelById(select.value);
        meta.textContent = def
          ? `~${def.downloadSizeMB}MB download · ~${def.ramRequirementMB}MB RAM · ${def.quantization}${def.notes ? ` — ${def.notes}` : ''}`
          : '';
      };
      updateMeta();
      select.addEventListener('change', () => {
        const previous = selected;
        setSelectedModelId(task, select.value, role);
        updateMeta();
        if (previous && previous !== select.value) disposeModelPipelines(previous);
      });
      list.appendChild(row);
    });
  }

  /** Full field-by-field provider editor — used for both "Edit" and "Add custom provider". */
  private openEditor(provider: ProviderConfig, isNew: boolean): void {
    let modal = document.getElementById('providerEditModal');
    if (modal) modal.remove();

    const localTask = localTaskForProvider(provider);

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
            <label class="field-label">Default model${localTask ? ' <span class="opt">from the Local Model Registry</span>' : ''}</label>
            ${localTask
              ? `<select id="pe-defaultModel">
                  ${getModelsForTask(localTask.task, localTask.role).map(m => `<option value="${escapeHtml(m.id)}" ${(provider.defaultModel || '') === m.id ? 'selected' : ''}>${escapeHtml(m.displayName)}${m.recommended ? ' (recommended)' : ''}</option>`).join('')}
                </select>
                <p class="hint" id="pe-defaultModel-meta" style="margin-top:4px;"></p>`
              : `<input type="text" id="pe-defaultModel" value="${escapeHtml(provider.defaultModel || '')}">`}
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

    if (localTask) {
      const select = m.querySelector('#pe-defaultModel') as HTMLSelectElement | null;
      const meta = m.querySelector('#pe-defaultModel-meta') as HTMLElement | null;
      const previousModelId = provider.defaultModel;
      const updateMeta = () => {
        if (!select || !meta) return;
        const def = getModelById(select.value);
        meta.textContent = def
          ? `~${def.downloadSizeMB}MB download · ~${def.ramRequirementMB}MB RAM · ${def.quantization} · ${def.backendCompatibility === 'webgpu' ? 'WebGPU required' : def.backendCompatibility === 'both' ? 'WebGPU or WASM/CPU' : 'WASM/CPU'}${def.notes ? ` — ${def.notes}` : ''}`
          : '';
      };
      updateMeta();
      select?.addEventListener('change', () => {
        updateMeta();
        if (previousModelId && previousModelId !== select?.value) {
          disposeModelPipelines(previousModelId);
        }
      });
    }

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
        defaultModel: (document.getElementById('pe-defaultModel') as HTMLInputElement | HTMLSelectElement).value.trim() || undefined,
        timeoutMs: parseInt((document.getElementById('pe-timeoutMs') as HTMLInputElement).value, 10) || 30000,
        noKeyNeeded: (document.getElementById('pe-noKeyNeeded') as HTMLInputElement).checked,
        notes: (document.getElementById('pe-notes') as HTMLTextAreaElement).value.trim() || undefined,
        enabled: isNew ? true : provider.enabled,
      };

      const validation = ProviderValidator.validate(updated);
      if (!validation.valid) {
        alert('Please fix the following before saving:\n\n' + validation.errors.join('\n'));
        return;
      }

      const manager = this.kernel.getProviderManager();
      if (isNew) {
        manager.addProvider(updated);
        // Guarantee the provider that was just added is actually visible:
        // if it was saved under a different type than the modal's current
        // filter (e.g. the Type dropdown was changed before saving), switch
        // the filter to match instead of leaving it hidden in the list.
        if (this.activeFilter !== 'all' && this.activeFilter !== updated.type) {
          this.activeFilter = updated.type;
          document.querySelectorAll('#providerTypeFilterChips .chip').forEach(c => {
            c.classList.toggle('active', (c as HTMLElement).dataset.val === updated.type);
          });
        }
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
