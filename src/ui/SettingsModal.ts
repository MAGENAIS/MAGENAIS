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
  getRegistryDefaultId,
} from '../providers/LocalModelRegistry';
import { disposeModelPipelines, detectDevice as detectTransformersDevice } from '../providers/adapters/TransformersAdapter';
import { LOCAL_ADAPTER_IDS, getRoutingMode, setRoutingMode, RoutingMode } from '../providers/RoutingMode';
import {
  download as downloadLocalModel,
  pauseDownload as pauseLocalModelDownload,
  resumeDownload as resumeLocalModelDownload,
  cancelDownload as cancelLocalModelDownload,
  verifyInstalled as verifyLocalModelInstalled,
  getEntry as getLocalModelManifestEntry,
  onManifestChange,
  formatBytes as formatLocalModelBytes,
  getStorageInfo,
} from '../providers/LocalModelDownloadManager';
import { isInCooldown, cooldownRemainingLabel, cooldownReasonLabel } from '../providers/HealthCooldown';
import { Config } from '../core/Config';
import { Logger } from '../core/Logger';

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

// 'vision' is a UI-only pseudo-category, not a ProviderType (see the
// visionOnly doc comment in types.ts for why the underlying type system
// deliberately doesn't have one). It exists here so a person browsing Keys
// & Providers can find/manage vision-only entries (e.g.
// builtin-transformers-vision) as their own group instead of them being
// mixed into the 'text' filter, which is exactly the bug being fixed below:
// isVisionOnly() reuses the identical `!p.visionOnly` rule that
// ProviderManager.callWithFallback already applies at call time (see
// registry/Manager.ts), so the UI and the runtime agree on what counts as
// "text" instead of each having their own notion of it.
const TYPE_FILTERS: Array<{ value: ProviderType | 'all' | 'vision'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'text', label: 'Text' },
  { value: 'vision', label: 'Vision' },
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

/** Same rule ProviderManager.callWithFallback uses to exclude vision-only entries from real text calls — see the comment above. */
function isVisionOnly(p: ProviderConfig): boolean {
  return p.visionOnly === true;
}

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

/** "3m ago" / "2h ago" — used by the Test button's persisted-result display. */
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
  private activeFilter: ProviderType | 'all' | 'vision' = 'all';
  private unsubscribeManifest: (() => void) | null = null;
  private healthUpdateHandler: (() => void) | null = null;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  open(): void {
    this.ensureDom();
    this.renderList();
    this.renderLocalModelsList();
    void this.renderStorageInfo();
    void this.renderDiagnostics();
    document.getElementById('settingsModal')?.classList.add('open');
    // Live-update download progress/status while the modal is open —
    // unsubscribed in close() so a background download doesn't keep this
    // modal's listener (and its re-renders) alive after the person
    // navigates away.
    if (!this.unsubscribeManifest) {
      this.unsubscribeManifest = onManifestChange(() => { this.renderLocalModelsList(); void this.renderDiagnostics(); void this.renderStorageInfo(); });
    }
    if (!this.healthUpdateHandler) {
      // Debounced — a multi-provider race can fire several
      // 'provider:health-updated' events within milliseconds of each
      // other, and re-rendering the whole diagnostics table on every
      // single one is wasted work for a panel that's just being glanced
      // at, not actively watched frame-by-frame.
      let pending: number | null = null;
      this.healthUpdateHandler = () => {
        if (pending) return;
        pending = window.setTimeout(() => { pending = null; void this.renderDiagnostics(); }, 400);
      };
      this.kernel.getEventBus().on('provider:health-updated', this.healthUpdateHandler);
    }
  }

  /** Opens straight to the Local Models section with a specific model's row expanded/highlighted — used by Mode.ts's "Download it now" button (see ui:openLocalModels in App.ts). */
  focusLocalModel(modelId: string): void {
    this.open();
    const details = document.getElementById('localModelsDetails') as HTMLDetailsElement | null;
    if (details) details.open = true;
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-local-model-id="${CSS.escape(modelId)}"]`) as HTMLElement | null;
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('flash-highlight');
        setTimeout(() => row.classList.remove('flash-highlight'), 2000);
      }
    });
  }

  /** Opens straight to a given provider-type filter (e.g. after a generation failure — see Mode.ts's renderError) so the person lands on exactly the tab that failed instead of the default 'All' view. */
  focusProviderType(type: string): void {
    this.open();
    const chip = document.querySelector(`#providerTypeFilterChips .chip[data-val="${CSS.escape(type)}"]`) as HTMLElement | null;
    chip?.click();
  }


  private close(): void {
    document.getElementById('settingsModal')?.classList.remove('open');
    this.unsubscribeManifest?.();
    this.unsubscribeManifest = null;
    if (this.healthUpdateHandler) {
      this.kernel.getEventBus().off('provider:health-updated', this.healthUpdateHandler);
      this.healthUpdateHandler = null;
    }
  }

  private ensureDom(): void {
    if (document.getElementById('settingsModal')) return;

    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'settingsModal';
    el.innerHTML = `
      <div class="modal settings-modal" style="max-width:760px;">
        <button class="modal-close" id="closeSettings">×</button>
        <h3>Universal Provider Manager</h3>

        <div class="settings-pinned">
          <p class="hint">Every provider — built-in, preset, or custom — lives in one registry. Add, edit, duplicate, or delete anything.
            <b style="color:var(--ink-dim);">Keys are saved on this device (browser local storage)</b>
            so you don't need to re-enter them next time — they're only ever sent directly to the
            provider you're calling. On a shared computer, use "Clear device data" before you leave.</p>

          <div class="field" style="margin-bottom:0;">
            <label class="field-label">Routing mode <span class="opt">which providers are allowed to race for each request</span></label>
            <div class="chip-group" id="routingModeChips">
              <span class="chip" data-mode="hybrid" title="Race every enabled, valid provider in parallel — first response wins. Default; nothing changes for existing setups.">Hybrid (race)</span>
              <span class="chip" data-mode="local" title="Only Transformers.js/WebLLM/Ollama/on-device speech race. Nothing else is contacted, even if enabled.">Local only</span>
              <span class="chip" data-mode="cloud" title="Only non-local (API-key) providers race.">Cloud only</span>
            </div>
          </div>

          <div class="chip-group" id="providerTypeFilterChips">
            ${TYPE_FILTERS.map(f => `<span class="chip${f.value === 'all' ? ' active' : ''}" data-val="${f.value}">${f.label}</span>`).join('')}
          </div>

          <div id="providerList" class="settings-provider-list"></div>

          <button class="ghost-btn" id="addProviderBtn" style="width:100%;">+ Add custom provider</button>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="ghost-btn small" id="resetProvidersBtn">Reset to defaults</button>
            <button class="ghost-btn small" id="clearDeviceDataBtn" style="border-color:var(--rust); color:var(--rust);">Clear device data</button>
          </div>
        </div>

        <div class="settings-accordions">
          <details class="log-details settings-accordion" id="localModelsDetails">
            <summary>Local models (Transformers.js, in-browser)</summary>
            <div class="settings-accordion-body">
              <p class="hint">These run entirely on-device — no key, no signup. The main text/vision/audio/embeddings
                models are edited from their provider row above ("Edit" → "Default model"); the three below are
                sub-tasks that share a provider with something else, so they're configured here instead.</p>
              <p class="hint" style="color:var(--amber, #d8a23f);">On a larger model, your browser may briefly show its own
                "Page Unresponsive" warning while the model finishes initializing after downloading — this is expected on
                slower hardware, not a crash. <b>Don't force-close the tab</b> if you see it; that's the one thing that
                actually loses progress. Just wait, or dismiss the browser's dialog if it offers a "Wait" option.</p>
              <div id="localModelsStorageInfo" class="hint" style="margin:0;"></div>
              <div id="localModelsList" style="display:flex; flex-direction:column; gap:10px;"></div>
            </div>
          </details>

          <details class="log-details settings-accordion" id="diagnosticsDetails">
            <summary>Diagnostics</summary>
            <div class="settings-accordion-body">
              <div id="diagnosticsDeviceInfo" class="hint" style="margin:0;"></div>
              <div id="diagnosticsTable" style="display:flex; flex-direction:column; gap:6px;"></div>

              <div class="divider"></div>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="debugModeToggle">
                <span>Debug mode — verbose logging in the browser console (request IDs, provider/model, latency, tokens, retries, failure reasons)</span>
              </label>
              <p class="hint">Off by default to keep the console quiet during normal use. A failed provider call is always logged
                regardless of this setting — this only adds the successful-call detail on top, for troubleshooting.</p>
            </div>
          </details>
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
        this.activeFilter = (chip as HTMLElement).dataset.val as ProviderType | 'all' | 'vision';
        this.renderList();
      });
    });

    const routingChips = el.querySelectorAll('#routingModeChips .chip');
    const currentMode = getRoutingMode();
    routingChips.forEach(chip => {
      const el2 = chip as HTMLElement;
      el2.classList.toggle('active', el2.dataset.mode === currentMode);
      el2.addEventListener('click', () => {
        routingChips.forEach(c => c.classList.remove('active'));
        el2.classList.add('active');
        setRoutingMode(el2.dataset.mode as RoutingMode);
      });
    });

    el.querySelector('#addProviderBtn')?.addEventListener('click', () => {
      // 'vision' isn't a real ProviderType to store on the new provider —
      // a custom vision-only entry is still stored as type:'text' with
      // visionOnly:true (matching how the built-in one works), so default
      // the editor's Type dropdown to 'text' and let the person tick
      // visionOnly there instead of trying to persist a nonexistent type.
      const startType = this.activeFilter === 'all' || this.activeFilter === 'vision' ? 'text' : this.activeFilter;
      const draft = blankProvider(startType);
      if (this.activeFilter === 'vision') draft.visionOnly = true;
      this.openEditor(draft, true);
    });
    el.querySelector('#resetProvidersBtn')?.addEventListener('click', () => this.handleReset());
    el.querySelector('#clearDeviceDataBtn')?.addEventListener('click', () => this.handleClearData());

    const debugToggle = el.querySelector('#debugModeToggle') as HTMLInputElement | null;
    if (debugToggle) {
      Config.load().then((config) => { debugToggle.checked = config.logLevel === 'debug'; });
      debugToggle.addEventListener('change', async () => {
        const config = await Config.load();
        config.logLevel = debugToggle.checked ? 'debug' : 'info';
        await Config.save(config);
        Logger.configure(config.logLevel);
      });
    }
  }

  private renderList(): void {
    const list = document.getElementById('providerList');
    if (!list) return;

    const manager = this.kernel.getProviderManager();
    let providers: ProviderConfig[];
    if (this.activeFilter === 'vision') {
      // Vision-only entries are stored as type:'text' (see the visionOnly
      // doc comment in types.ts), so pull from the 'text' pool and keep
      // only the vision-only ones — never mixed with genuine text
      // providers, and never duplicated into two tabs at once.
      providers = manager.getProviders('text').filter(isVisionOnly);
    } else if (this.activeFilter === 'text') {
      // Root-cause fix: this used to show every type:'text' row, including
      // vision-only ones — the exact same providers ProviderManager
      // .callWithFallback already excludes at call time (see isVisionOnly's
      // doc comment). The Text tab now agrees with what a Text request can
      // actually use.
      providers = manager.getProviders('text').filter(p => !isVisionOnly(p));
    } else if (this.activeFilter === 'all') {
      providers = manager.getProviders();
    } else {
      providers = manager.getProviders(this.activeFilter);
    }
    providers = providers.sort((a: ProviderConfig, b: ProviderConfig) => a.priority - b.priority);

    if (providers.length === 0) {
      const categoryHelp: Record<string, string> = {
        mcp: "MCP (Model Context Protocol) server integration doesn't have a working adapter in this build yet — there's no backend for this category to actually call, so adding a custom provider here won't do anything until that adapter exists.",
        gamegen: 'There\'s no standardized, ready-to-use game-generation API this app ships pre-configured — "+ Add custom provider" below only helps if you already have a specific game-generation endpoint (self-hosted or third-party) to point it at.',
      };
      list.innerHTML = `<p class="hint">${categoryHelp[this.activeFilter] || 'No providers in this category yet.'}</p>`;
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
      const visionBadge = isVisionOnly(p) ? ' · <span style="color:var(--violet, #8a6fd8);">vision-only</span>' : '';
      const localBadge = LOCAL_ADAPTER_IDS.has(p.adapterId) ? ' · <span style="color:var(--sage, #4a9d6a);">local</span>' : '';
      const cooldownBadge = isInCooldown(p.health)
        ? ` · <span style="color:var(--rust);" title="Repeated failures — this provider is being skipped until it cools down, so it doesn't keep failing the same way on every request.">cooling down (${cooldownRemainingLabel(p.health)} left) — ${escapeHtml(cooldownReasonLabel(p.health!.failureCategory as any))}</span>`
        : '';
      // PHASE 7 — Provider Testing: shows the persisted result of the last
      // "Test" click (ProviderConfig.lastTestResult, saved via
      // ProviderManager.testProvider), so it's still visible after closing
      // and reopening Keys & Providers, not just for the current session.
      const testResultLine = p.lastTestResult
        ? `<div class="provider-meta" data-test-result style="margin-top:2px; color:${p.lastTestResult.ok ? 'var(--moss)' : 'var(--rust)'};">
            ${p.lastTestResult.ok ? '✓' : '✗'} ${escapeHtml(p.lastTestResult.message)}
            ${p.lastTestResult.latencyMs !== undefined ? ` · ${p.lastTestResult.latencyMs}ms` : ''}
            ${p.lastTestResult.healthScore !== undefined ? ` · health ${p.lastTestResult.healthScore}/100` : ''}
            · tested ${timeAgo(p.lastTestResult.testedAt)}
          </div>`
        : '<div class="provider-meta" data-test-result></div>';

      row.innerHTML = `
        <div class="provider-row-top">
          <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
            <span class="provider-name" style="color:${statusColor};">${escapeHtml(p.name)}</span>
            <span class="provider-meta">${escapeHtml(p.type)} · priority ${p.priority} · ${keyStatus}${builtInBadge}${visionBadge}${localBadge}${cooldownBadge}</span>
            ${testResultLine}
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
          <button class="ghost-btn small" data-action="test">Test</button>
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
      const testBtn = row.querySelector('[data-action="test"]') as HTMLButtonElement | null;
      testBtn?.addEventListener('click', async () => {
        const resultEl = row.querySelector('[data-test-result]') as HTMLElement | null;
        testBtn.disabled = true;
        testBtn.textContent = 'Testing…';
        if (resultEl) { resultEl.style.color = 'var(--ink-faint)'; resultEl.textContent = 'Testing…'; }
        try {
          const result = await manager.testProvider(p.id);
          p.lastTestResult = result;
          if (resultEl) {
            resultEl.style.color = result.ok ? 'var(--moss)' : 'var(--rust)';
            resultEl.textContent =
              `${result.ok ? '✓' : '✗'} ${result.message}` +
              (result.latencyMs !== undefined ? ` · ${result.latencyMs}ms` : '') +
              (result.healthScore !== undefined ? ` · health ${result.healthScore}/100` : '') +
              ` · tested just now`;
          }
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = 'Test';
        }
      });
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
   * Diagnostics (item 14) — surfaces data that mostly already existed but
   * was never shown anywhere: ProviderConfig.successRate/averageLatency
   * are smoothed on every real call outcome by Registry.updateHealth (see
   * that file), and timeoutCount was added there in this pass specifically
   * so "how often has this been timing out" has an answer that isn't just
   * "check the console." Local-model rows also show LocalModelDownloadManager's
   * install state, so "why isn't this working" and "is this downloaded"
   * are answered in the same place instead of two different UI sections.
   */
  private async renderDiagnostics(): Promise<void> {
    const deviceInfo = document.getElementById('diagnosticsDeviceInfo');
    const table = document.getElementById('diagnosticsTable');
    if (!deviceInfo || !table) return;

    // Device detection is cheap and cached after the first call (see
    // TransformersAdapter.detectDevice) — safe to trigger here rather than
    // only ever finding out lazily on someone's first real generation.
    if (deviceInfo.textContent === '') deviceInfo.textContent = 'Detecting GPU/WebGPU support…';
    const device = await detectTransformersDevice();
    const heapMB = (performance as any).memory?.usedJSHeapSize
      ? `${((performance as any).memory.usedJSHeapSize / (1024 * 1024)).toFixed(0)}MB`
      : null;
    deviceInfo.innerHTML =
      `Transformers.js backend: <b style="color:${device === 'webgpu' ? 'var(--sage, #4a9d6a)' : 'var(--ink)'};">${device === 'webgpu' ? 'WebGPU (accelerated)' : 'WASM/CPU'}</b>` +
      (heapMB ? ` · JS heap: ${heapMB} <span class="opt">(Chrome only, approximate — doesn't include WASM/GPU memory)</span>` : ' · Memory usage: not exposed by this browser');

    const manager = this.kernel.getProviderManager();
    const providers = manager.getProviders().sort((a: ProviderConfig, b: ProviderConfig) => a.priority - b.priority);
    table.innerHTML = providers.map((p: ProviderConfig) => {
      const health = p.health;
      const statusColor: Record<string, string> = {
        healthy: 'var(--sage, #4a9d6a)', degraded: 'var(--amber, #d8a23f)',
        unhealthy: 'var(--rust)', unknown: 'var(--ink-faint)',
      };
      const status = health?.status || 'unknown';
      const successPct = p.successRate !== undefined ? `${Math.round(p.successRate * 100)}%` : '—';
      const latency = p.averageLatency !== undefined ? `${Math.round(p.averageLatency)}ms` : '—';
      const timeouts = p.timeoutCount || 0;
      const cooldown = health?.cooldownUntil && health.cooldownUntil > Date.now() ? ` · cooling down (${cooldownRemainingLabel(health)})` : '';
      const lastError = health?.lastError ? escapeHtml(health.lastError.slice(0, 80)) + (health.lastError.length > 80 ? '…' : '') : '';

      const localTask = localTaskForProvider(p);
      let installedLine = '';
      if (localTask) {
        const modelId = p.defaultModel || getRegistryDefaultId(localTask.task, localTask.role);
        const entry = modelId ? getLocalModelManifestEntry(modelId, localTask.task, localTask.role) : undefined;
        const s = entry?.status || 'not-installed';
        installedLine = ` · <span style="color:${s === 'ready' ? 'var(--sage, #4a9d6a)' : 'var(--ink-faint)'};">${s === 'ready' ? 'installed' : s === 'not-installed' ? 'not downloaded' : s}</span>`;
      }

      return `
        <div style="display:flex; flex-direction:column; gap:1px; padding:6px 8px; border-radius:6px; background:var(--panel-2, rgba(127,127,127,0.06));">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="width:7px; height:7px; border-radius:50%; background:${statusColor[status]}; flex-shrink:0;"></span>
            <b style="font-size:12px;">${escapeHtml(p.name)}</b>
            <span class="hint" style="margin:0;">${escapeHtml(p.type)}${installedLine}${cooldown}</span>
          </div>
          <div class="hint" style="margin:0; font-family:var(--mono); font-size:10px;">
            success ${successPct} · avg latency ${latency} · timeouts ${timeouts}${lastError ? ` · last error: ${lastError}` : ''}
          </div>
        </div>
      `;
    }).join('');
  }


  /**
   * There is no real filesystem path in a browser — models are cached via
   * the Cache Storage API, not written to a location the person could
   * "browse" to (see the item 4 caveat from earlier in this project). This
   * is the honest equivalent: how much is stored, how much room is left,
   * and — the actually load-bearing part — whether this origin is exempt
   * from the browser's silent best-effort eviction (see
   * LocalModelDownloadManager.ts's storage-persistence doc comment for why
   * that eviction is the real, verifiable explanation for "a download
   * restarts from scratch instead of resuming").
   */
  private async renderStorageInfo(): Promise<void> {
    const el = document.getElementById('localModelsStorageInfo');
    if (!el) return;
    const info = await getStorageInfo();
    if (!info.supported) {
      el.textContent = "This browser doesn't report storage usage — models are still cached normally, just without a usage/quota readout here.";
      return;
    }
    const pct = info.quotaBytes > 0 ? Math.round((info.usageBytes / info.quotaBytes) * 100) : 0;
    const persistedNote = info.persisted
      ? '<span style="color:var(--sage, #4a9d6a);">protected from automatic eviction</span>'
      : '<span style="color:var(--amber, #d8a23f);">NOT protected</span> — the browser may silently clear cached models under low disk space, which is the most common cause of a download appearing to "restart from scratch"';
    el.innerHTML = `Storage used by this site: ${formatLocalModelBytes(info.usageBytes)} of ${formatLocalModelBytes(info.quotaBytes)} available (${pct}%) · ${persistedNote}.`;
  }


  /**
   * Local Models Manager (item 3/4/5 of the local-AI-studio brief) — every
   * Transformers.js task in one place, each with real install-state
   * controls, instead of scattered across individual provider rows with no
   * download management at all. Two kinds of rows:
   *  - Provider-backed (text-generation, caption, ASR, embeddings, music):
   *    the model choice is `ProviderConfig.defaultModel` on the matching
   *    builtin-transformers-* row (see localTaskForProvider) — writing here
   *    goes through the same manager.updateProvider() used by the regular
   *    provider editor, so both stay in sync.
   *  - Registry-only (summarization, translation, OCR): no ProviderConfig
   *    row exists for these (see the old doc comment, preserved below on
   *    ensureRegistryOnlyRow), so the choice is read/written straight
   *    through LocalModelRegistry's own storage, exactly as before.
   * Install state (status/progress/installed-at) for every row comes from
   * LocalModelDownloadManager's manifest, keyed by the selected model ID —
   * switching a row's model swaps which manifest entry its controls act on.
   */
  private renderLocalModelsList(): void {
    const list = document.getElementById('localModelsList');
    if (!list) return;
    const manager = this.kernel.getProviderManager();

    type Row = { label: string; task: LocalModelTask; role?: 'caption' | 'ocr'; providerId?: string };
    const rows: Row[] = [];

    // Provider-backed rows: one per transformers-adapter ProviderConfig.
    manager.getProviders('text').concat(manager.getProviders('audio'), manager.getProviders('music'), manager.getProviders('embeddings' as ProviderType))
      .filter((p: ProviderConfig) => p.adapterId === 'transformers')
      .forEach((p: ProviderConfig) => {
        const t = localTaskForProvider(p);
        if (t) rows.push({ label: `${p.name}`, task: t.task, role: t.role, providerId: p.id });
      });

    // Registry-only rows — no ProviderConfig row backs these (see the doc
    // comment above), so read/write LocalModelRegistry's own storage.
    rows.push(
      { label: 'Summarization (used by Documents/Research when summarizing text)', task: 'summarization' },
      { label: 'Translation (English source only, see model notes)', task: 'translation' },
      { label: 'OCR (reading text in images, used by Vision)', task: 'image-to-text', role: 'ocr' },
    );

    list.innerHTML = '';
    rows.forEach(({ label, task, role, providerId }) => {
      const options = getModelsForTask(task, role);
      if (options.length === 0) return;
      const provider = providerId ? manager.getProviders().find((p: ProviderConfig) => p.id === providerId) : undefined;
      const selected = provider ? (provider.defaultModel || getRegistryDefaultId(task, role) || options[0]?.id) : getSelectedModelId(task, role);
      const def = getModelById(selected || '') || options[0];

      const row = document.createElement('div');
      row.className = 'local-model-row';
      row.dataset.localModelId = def?.id || '';
      row.innerHTML = `
        <label class="field-label">${escapeHtml(label)}</label>
        <select data-task="${task}" ${role ? `data-role="${role}"` : ''} ${providerId ? `data-provider-id="${escapeHtml(providerId)}"` : ''}>
          ${options.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === selected ? 'selected' : ''}>${escapeHtml(m.displayName)}${m.recommended ? ' (recommended)' : ''}</option>`).join('')}
        </select>
        <p class="hint" data-meta style="margin-top:4px;"></p>
        <div data-status-area style="margin-top:6px;"></div>
      `;
      const select = row.querySelector('select') as HTMLSelectElement;
      const meta = row.querySelector('[data-meta]') as HTMLElement;
      const statusArea = row.querySelector('[data-status-area]') as HTMLElement;

      const updateMeta = () => {
        const d = getModelById(select.value);
        meta.textContent = d
          ? `~${d.downloadSizeMB}MB download · ~${d.ramRequirementMB}MB RAM · ${d.quantization}${d.notes ? ` — ${d.notes}` : ''}`
          : '';
      };
      const renderStatus = () => {
        const d = getModelById(select.value);
        if (!d) { statusArea.innerHTML = ''; return; }
        statusArea.innerHTML = this.renderLocalModelStatus(d.id, task, role);
        this.wireLocalModelStatusButtons(statusArea, d.id, task, role);
      };

      updateMeta();
      renderStatus();
      select.addEventListener('change', () => {
        const previous = selected;
        if (providerId) {
          manager.updateProvider(providerId, { defaultModel: select.value });
        } else {
          setSelectedModelId(task, select.value, role);
        }
        row.dataset.localModelId = select.value;
        updateMeta();
        renderStatus();
        if (previous && previous !== select.value) disposeModelPipelines(previous);
      });

      list.appendChild(row);
    });
  }

  /** Renders the status badge + progress bar for one model's manifest entry. */
  private renderLocalModelStatus(modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): string {
    const e = getLocalModelManifestEntry(modelId, task, role);
    const status = e?.status || 'not-installed';
    const badgeColor: Record<string, string> = {
      'not-installed': 'var(--ink-faint)', queued: 'var(--azure)', downloading: 'var(--azure)',
      paused: 'var(--amber, #d8a23f)', ready: 'var(--sage, #4a9d6a)', error: 'var(--rust)', corrupted: 'var(--rust)',
    };
    const label: Record<string, string> = {
      'not-installed': 'Not installed', queued: 'Queued…', downloading: 'Downloading…',
      paused: 'Paused', ready: 'Installed', error: 'Failed', corrupted: 'Corrupted',
    };
    const pct = e && e.bytesTotal > 0 ? Math.round((e.bytesDownloaded / e.bytesTotal) * 100) : 0;
    const sizeLabel = e && e.bytesTotal > 0 ? ` (${formatLocalModelBytes(e.bytesDownloaded)} / ${formatLocalModelBytes(e.bytesTotal)})` : '';
    const installedLabel = status === 'ready' && e?.installedAt ? ` · installed ${timeAgo(e.installedAt)}` : '';
    const errorLabel = (status === 'error' || status === 'corrupted') && e?.lastError ? ` — ${escapeHtml(e.lastError)}` : '';

    const buttons: string[] = [];
    if (status === 'not-installed' || status === 'error' || status === 'corrupted') buttons.push(`<button class="ghost-btn small" data-action="download">Download</button>`);
    if (status === 'downloading' || status === 'queued') buttons.push(`<button class="ghost-btn small" data-action="pause">Pause</button>`, `<button class="ghost-btn small" data-action="cancel">Cancel</button>`);
    if (status === 'paused') buttons.push(`<button class="ghost-btn small" data-action="resume">Resume</button>`, `<button class="ghost-btn small" data-action="cancel">Cancel</button>`);
    if (status === 'ready') buttons.push(`<button class="ghost-btn small" data-action="verify">Verify</button>`, `<button class="ghost-btn small" data-action="cancel">Remove</button>`);

    const bar = (status === 'downloading' || status === 'queued')
      ? `<div class="local-model-progress"><div class="local-model-progress-fill" style="width:${pct}%;"></div></div>`
      : '';

    return `
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="color:${badgeColor[status]}; font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">${label[status]}</span>
        <span class="hint" style="margin:0;">${pct > 0 && (status === 'downloading' || status === 'queued') ? `${pct}%${sizeLabel}` : ''}${installedLabel}${errorLabel}</span>
        <div style="display:flex; gap:6px; margin-left:auto;">${buttons.join('')}</div>
      </div>
      ${bar}
    `;
  }

  private wireLocalModelStatusButtons(container: HTMLElement, modelId: string, task: LocalModelTask, role?: 'caption' | 'ocr'): void {
    container.querySelector('[data-action="download"]')?.addEventListener('click', () => {
      downloadLocalModel(modelId, task, role).catch(() => {}); // failure surfaces via manifest status, not a thrown-away promise rejection
    });
    container.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
      resumeLocalModelDownload(modelId, task, role).catch(() => {});
    });
    container.querySelector('[data-action="pause"]')?.addEventListener('click', () => pauseLocalModelDownload(modelId, task, role));
    container.querySelector('[data-action="cancel"]')?.addEventListener('click', () => cancelLocalModelDownload(modelId, task, role));
    container.querySelector('[data-action="verify"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const original = btn.textContent;
      btn.disabled = true; btn.textContent = 'Verifying…';
      const result = await verifyLocalModelInstalled(modelId, task, role);
      btn.disabled = false; btn.textContent = original;
      alert(result.message); // Deliberately simple — this is a manual, infrequent diagnostic action, not part of the main flow.
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
              : `<div style="display:flex; gap:6px;">
                  <input type="text" id="pe-defaultModel" value="${escapeHtml(provider.defaultModel || '')}" style="flex:1;" list="pe-defaultModel-discovered">
                  ${this.kernel.getProviderManager().adapterSupportsModelDiscovery(provider.adapterId) ? `<button type="button" class="ghost-btn small" id="pe-discoverModels">Discover</button>` : ''}
                </div>
                <datalist id="pe-defaultModel-discovered"></datalist>
                <p class="hint" id="pe-discover-status" style="margin-top:4px;"></p>`}
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
        <label style="display:flex; align-items:center; gap:6px; margin:10px 0; cursor:pointer;" title="For providers that can ONLY caption/analyze images, not answer general text prompts. Keeps it out of the Text fallback chain and lists it under the Vision filter instead.">
          <input type="checkbox" id="pe-visionOnly" style="width:auto;" ${provider.visionOnly ? 'checked' : ''}>
          <span class="field-label" style="margin:0;">Vision-only <span class="opt">image captioning/analysis, not general text</span></span>
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

    m.querySelector('#pe-discoverModels')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const statusEl = m.querySelector('#pe-discover-status') as HTMLElement | null;
      const datalist = m.querySelector('#pe-defaultModel-discovered') as HTMLDataListElement | null;
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = 'Discovering…';
      try {
        const models = await this.kernel.getProviderManager().fetchModelsFor(provider.id);
        if (datalist) datalist.innerHTML = models.map(mid => `<option value="${escapeHtml(mid)}">`).join('');
        if (statusEl) statusEl.textContent = models.length > 0
          ? `Found ${models.length} installed model(s) — start typing in the field above to see suggestions.`
          : 'Connected, but no models are installed yet.';
      } catch (err: any) {
        if (statusEl) statusEl.textContent = err?.message || 'Could not discover models — is the service running?';
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

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
        visionOnly: (document.getElementById('pe-visionOnly') as HTMLInputElement).checked || undefined,
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
        const matchesVisionFilter = this.activeFilter === 'vision' && isVisionOnly(updated);
        if (this.activeFilter !== 'all' && !matchesVisionFilter && this.activeFilter !== updated.type) {
          this.activeFilter = updated.visionOnly ? 'vision' : updated.type;
          document.querySelectorAll('#providerTypeFilterChips .chip').forEach(c => {
            c.classList.toggle('active', (c as HTMLElement).dataset.val === this.activeFilter);
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
