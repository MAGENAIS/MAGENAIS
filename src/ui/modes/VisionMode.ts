import { Mode } from './Mode';
import { stripMarkdownForSpeech } from '../../core/textUtils';
import { Config } from '../../core/Config';
import type { ProviderConfig } from '../../providers/types';
import { getVisionModelsForAdapter, type VisionModelDefinition } from '../../providers/VisionModelCatalog';

/** Same rule SettingsModal.ts's isVisionOnly() uses — duplicated here rather than imported since it's a one-line predicate and importing from a UI file into another UI file for a single boolean check isn't worth the coupling. */
function isVisionOnly(p: ProviderConfig): boolean {
  return p.visionOnly === true;
}

export class VisionMode extends Mode {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private liveInterval: number | null = null;
  private analyzing = false;
  /** Currently selected camera deviceId, or null for "system default" — set by the device <select> (item 5: "Select webcam"). */
  private selectedCameraId: string | null = null;

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Camera</label>
        <div id="visionDropZone" style="position:relative; border:1px solid var(--line-bright); border-radius:var(--radius); overflow:hidden; background:var(--bg);">
          <video id="visionVideo" autoplay playsinline muted style="width:100%; display:block; max-height:280px; object-fit:cover;"></video>
          <div id="visionCameraOff" class="empty-text" style="padding:32px 10px 12px; text-align:center;">Camera is off. Click "Start Camera", upload an image, drag &amp; drop one here, or paste (Ctrl/Cmd+V).</div>
        </div>
        <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
          <button class="ghost-btn" id="toggleCameraBtn">Start Camera</button>
          <button class="ghost-btn" id="uploadImageBtn">Upload Image</button>
          <button class="ghost-btn" id="screenshotBtn" title="Capture a screenshot of a tab, window, or your screen">Capture Screenshot</button>
        </div>
        <input type="file" id="visionFileInput" accept="image/*" style="display:none;">
        <div class="field" id="visionCameraDeviceField" style="margin-top:8px; display:none;">
          <label class="field-label">Webcam</label>
          <select id="visionCameraSelect"></select>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Provider <span style="text-transform:none;color:var(--ink-faint);">optional — leave on Auto to race every configured vision provider and use whichever answers first</span></label>
        <select id="visionProviderSelect">
          <option value="">Auto (race all configured vision providers)</option>
        </select>
      </div>
      <div class="field" id="visionModelField" style="display:none;">
        <label class="field-label">Model <span style="text-transform:none;color:var(--ink-faint);">optional — overrides the provider's configured default model for this request</span></label>
        <select id="visionModelSelect">
          <option value="">(provider default)</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label">Ask about what you see <span style="text-transform:none;color:var(--ink-faint);">optional</span></label>
        <textarea id="promptInput" rows="2" placeholder="e.g. What objects are on the table? Read any text you see."></textarea>
      </div>
      <div class="field">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" id="visionSpeakToggle" style="width:auto;">
          <span class="field-label" style="margin:0;">Speak the description aloud</span>
        </label>
      </div>
      <div class="field">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" id="visionLiveToggle" style="width:auto;">
          <span class="field-label" style="margin:0;">Live mode <span style="text-transform:none;color:var(--ink-faint);" id="visionLiveIntervalHint">analyze on an interval, continuously</span></span>
        </label>
      </div>
      <div class="field">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" id="visionOcrToggle" style="width:auto;" checked>
          <span class="field-label" style="margin:0;">Also read text in the image <span style="text-transform:none;color:var(--ink-faint);">local OCR, on by default — only applies to the local captioning fallback, not the cloud providers</span></span>
        </label>
      </div>
      <p class="hint">Works out of the box via a local, in-browser captioning model (Transformers.js) — no key needed. Enable a cloud Vision provider in Keys &amp; Providers (or pick one above) for full open-ended visual Q&amp;A. Image size/quality and the Live mode interval are configurable in Settings → Vision settings. Frames are analyzed on demand, not streamed anywhere.</p>
      <button class="run-btn" id="runBtn">▸ Analyze Frame</button>
    `);

    this.videoEl = document.getElementById('visionVideo') as HTMLVideoElement;
    document.getElementById('toggleCameraBtn')?.addEventListener('click', () => this.toggleCamera());
    document.getElementById('uploadImageBtn')?.addEventListener('click', () => {
      (document.getElementById('visionFileInput') as HTMLInputElement)?.click();
    });
    document.getElementById('visionFileInput')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.analyzeUploadedFile(file);
    });
    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleAnalyze()));
    document.getElementById('visionLiveToggle')?.addEventListener('change', (e) => {
      this.toggleLiveMode((e.target as HTMLInputElement).checked);
    });
    document.getElementById('screenshotBtn')?.addEventListener('click', () => this.runGuarded('screenshotBtn', () => this.captureScreenshot()));
    document.getElementById('visionCameraSelect')?.addEventListener('change', (e) => {
      this.selectedCameraId = (e.target as HTMLSelectElement).value || null;
      if (this.stream) { // already running — restart on the newly picked device
        this.stopCameraStream();
        this.startCameraStream();
      }
    });
    document.getElementById('visionProviderSelect')?.addEventListener('change', () => this.onProviderSelectionChanged());

    this.populateProviderSelect();
    this.wireDragAndDrop();
    this.wirePaste();
    void this.applyLiveIntervalHint();
  }

  /** Item 8 — Provider selector. Populated from every enabled, vision-capable provider (same visionOnly rule Keys & Providers uses) so the list only ever shows options that could actually work right now. */
  private populateProviderSelect(): void {
    const select = document.getElementById('visionProviderSelect') as HTMLSelectElement | null;
    if (!select) return;
    const manager = this.kernel.getProviderManager();
    const providers: ProviderConfig[] = manager.getProviders('text', true).filter(isVisionOnly);
    providers
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    this.onProviderSelectionChanged();
  }

  /** Item 8 — Model selector: swaps in the catalog's models for whichever adapter the selected provider uses (see VisionModelCatalog.ts), or hides itself entirely on "Auto"/no catalog entries. */
  private onProviderSelectionChanged(): void {
    const providerSelect = document.getElementById('visionProviderSelect') as HTMLSelectElement | null;
    const modelField = document.getElementById('visionModelField') as HTMLElement | null;
    const modelSelect = document.getElementById('visionModelSelect') as HTMLSelectElement | null;
    if (!providerSelect || !modelField || !modelSelect) return;

    modelSelect.innerHTML = '<option value="">(provider default)</option>';
    const providerId = providerSelect.value;
    if (!providerId) { modelField.style.display = 'none'; return; }

    const manager = this.kernel.getProviderManager();
    const provider = manager.getProviders('text', false).find((p: ProviderConfig) => p.id === providerId);
    if (!provider) { modelField.style.display = 'none'; return; }

    const models: VisionModelDefinition[] = getVisionModelsForAdapter(provider.adapterId);
    if (models.length === 0) { modelField.style.display = 'none'; return; }

    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.modelId;
      opt.textContent = `${m.name} — ${m.capabilities.ocr ? 'OCR' : 'no OCR'}, ${m.capabilities.documentAnalysis ? 'docs' : 'no docs'}, ${m.capabilities.chartAnalysis ? 'charts' : 'no charts'}`;
      opt.title = m.notes;
      modelSelect.appendChild(opt);
    });
    modelField.style.display = '';
  }

  private async applyLiveIntervalHint(): Promise<void> {
    const hint = document.getElementById('visionLiveIntervalHint');
    if (!hint) return;
    const config = await Config.load();
    const seconds = Math.round(config.vision.continuousIntervalMs / 1000);
    hint.textContent = `analyze every ${seconds}s while on — change the interval in Settings → Vision settings`;
  }

  /** Item 8 — Drag & Drop, onto the camera/preview area. */
  private wireDragAndDrop(): void {
    const zone = document.getElementById('visionDropZone');
    if (!zone) return;
    const highlight = (on: boolean) => { zone.style.outline = on ? '2px dashed var(--accent, #6b8afd)' : 'none'; };
    zone.addEventListener('dragover', (e) => { e.preventDefault(); highlight(true); });
    zone.addEventListener('dragleave', () => highlight(false));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      highlight(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) this.analyzeUploadedFile(file);
    });
  }

  /**
   * Item 8 — Paste Image. Listens on `document` rather than a specific
   * element since a person is as likely to have focus in the prompt
   * textarea as anywhere else when they hit paste, and image-bearing
   * clipboard events don't otherwise conflict with normal text pasting
   * (this only acts when an image item is actually present).
   */
  private wirePaste(): void {
    const handler = (e: ClipboardEvent) => {
      if (!this.outputPanel.isConnected) { document.removeEventListener('paste', handler); return; } // mode was torn down; stop listening
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      if (!item) return;
      const file = item.getAsFile();
      if (file) { e.preventDefault(); this.analyzeUploadedFile(file); }
    };
    document.addEventListener('paste', handler);
  }

  /** Item 8 — Capture Screenshot, via the standard Screen Capture API (person picks a tab/window/screen in the browser's own picker). Grabs exactly one frame, then immediately releases the stream — this is a snapshot tool, not a recording feature. */
  private async captureScreenshot(): Promise<void> {
    if (!('getDisplayMedia' in navigator.mediaDevices)) {
      alert("This browser doesn't support screen capture.");
      return;
    }
    let displayStream: MediaStream | null = null;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = displayStream.getVideoTracks()[0];
      // ImageCapture is the more direct API for "grab one frame", but isn't
      // implemented in every engine (notably Firefox) — draw a single video
      // frame to canvas instead, which works everywhere getDisplayMedia does.
      const tempVideo = document.createElement('video');
      tempVideo.srcObject = displayStream;
      tempVideo.muted = true;
      await tempVideo.play();
      await new Promise((resolve) => requestAnimationFrame(resolve)); // ensure a frame has actually painted
      const canvas = document.createElement('canvas');
      canvas.width = tempVideo.videoWidth || 1280;
      canvas.height = tempVideo.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable.');
      ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
      track.stop();
      displayStream.getTracks().forEach((t) => t.stop());
      const config = await Config.load();
      const dataUrl = await this.resizeDataUrlIfNeeded(canvas.toDataURL('image/jpeg', config.vision.jpegQuality), config);
      await this.runAnalysis(dataUrl);
    } catch (err: any) {
      displayStream?.getTracks().forEach((t) => t.stop());
      if (err?.name !== 'NotAllowedError') alert("Couldn't capture a screenshot — " + err.message);
    }
  }

  /** Item 5 — Select webcam. Populated after permission is granted (device labels are blank until then, per the MediaDevices spec), so this is called once a stream is live. */
  private async populateCameraDeviceSelect(): Promise<void> {
    const field = document.getElementById('visionCameraDeviceField') as HTMLElement | null;
    const select = document.getElementById('visionCameraSelect') as HTMLSelectElement | null;
    if (!field || !select || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');
      if (cameras.length <= 1) { field.style.display = 'none'; return; } // nothing meaningful to choose between
      select.innerHTML = '';
      cameras.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${i + 1}`;
        select.appendChild(opt);
      });
      if (this.selectedCameraId) select.value = this.selectedCameraId;
      field.style.display = '';
    } catch {
      field.style.display = 'none';
    }
  }

  private async startCameraStream(): Promise<void> {
    const btn = document.getElementById('toggleCameraBtn') as HTMLButtonElement;
    const off = document.getElementById('visionCameraOff') as HTMLElement;
    const config = await Config.load();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(this.selectedCameraId ? { deviceId: { exact: this.selectedCameraId } } : { facingMode: 'environment' }),
          frameRate: { ideal: config.vision.cameraFps },
        },
      });
      if (this.videoEl) this.videoEl.srcObject = this.stream;
      off.style.display = 'none';
      btn.textContent = 'Stop Camera';
      void this.populateCameraDeviceSelect();
    } catch (err: any) {
      alert("Couldn't access the camera — " + err.message);
    }
  }

  private stopCameraStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.videoEl) this.videoEl.srcObject = null;
  }

  private async toggleCamera(): Promise<void> {
    const btn = document.getElementById('toggleCameraBtn') as HTMLButtonElement;
    const off = document.getElementById('visionCameraOff') as HTMLElement;
    if (this.stream) {
      this.stopCameraStream();
      off.style.display = '';
      btn.textContent = 'Start Camera';
      this.toggleLiveMode(false);
      (document.getElementById('visionLiveToggle') as HTMLInputElement).checked = false;
      return;
    }
    await this.startCameraStream();
  }

  private toggleLiveMode(on: boolean): void {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
    if (on) {
      if (!this.stream) { alert('Start the camera first.'); return; }
      // Item 7 — Vision settings: the continuous-analysis interval is now a
      // configurable Config.vision.continuousIntervalMs (Settings → Vision
      // settings) rather than a hardcoded constant, defaulting to the same
      // 20s this used before that setting existed.
      Config.load().then((config) => {
        this.liveInterval = window.setInterval(() => {
          if (!this.analyzing) this.handleAnalyze();
        }, config.vision.continuousIntervalMs);
      });
      this.handleAnalyze();
    }
  }

  /** Item 7 — Vision settings: downscales an oversized image to Config.vision.maxImageSizePx (longest edge) at Config.vision.jpegQuality, re-encoding as JPEG unless PNG support is on and the source is already small enough. Camera captures already come out at the video's native resolution via captureFrameAsDataUrl, and uploaded/dropped/pasted files can be arbitrarily large — both funnel through here before being sent to any provider. */
  private async resizeDataUrlIfNeeded(dataUrl: string, config: Awaited<ReturnType<typeof Config.load>>): Promise<string> {
    if (!config.vision.autoResize) return dataUrl;
    const img = new Image();
    const loaded: HTMLImageElement = await new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
    const longestEdge = Math.max(loaded.width, loaded.height);
    if (longestEdge <= config.vision.maxImageSizePx) return dataUrl;
    const scale = config.vision.maxImageSizePx / longestEdge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(loaded.width * scale);
    canvas.height = Math.round(loaded.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(loaded, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', config.vision.jpegQuality);
  }

  private captureFrameAsDataUrl(quality: number): string | null {
    if (!this.videoEl || !this.stream) return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.videoEl.videoWidth || 640;
    canvas.height = this.videoEl.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  private async handleAnalyze(): Promise<void> {
    const config = await Config.load();
    const imageBase64 = this.captureFrameAsDataUrl(config.vision.jpegQuality);
    if (!imageBase64) { alert('Start the camera, upload an image, drag one in, or paste one first.'); return; }
    await this.runAnalysis(await this.resizeDataUrlIfNeeded(imageBase64, config));
  }

  /** Item 7 — Vision settings: rejects files over Config.vision.maxUploadSizeMB client-side, before ever reading/sending them, with a clear message rather than a silent failure or a slow upstream rejection. */
  private async analyzeUploadedFile(file: File): Promise<void> {
    const config = await Config.load();
    const maxBytes = config.vision.maxUploadSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      alert(`That image is ${(file.size / (1024 * 1024)).toFixed(1)}MB, which is over the ${config.vision.maxUploadSizeMB}MB limit set in Settings → Vision settings.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => this.runAnalysis(await this.resizeDataUrlIfNeeded(reader.result as string, config));
    reader.readAsDataURL(file);
  }

  private async runAnalysis(imageBase64: string): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    const speak = (document.getElementById('visionSpeakToggle') as HTMLInputElement)?.checked;
    const includeOcr = (document.getElementById('visionOcrToggle') as HTMLInputElement)?.checked ?? true;
    // Item 8 — Provider/Model selectors: "" (Auto, the default) means
    // both stay undefined, so callVision behaves exactly as it always
    // has — races every configured vision provider.
    const preferredProviderId = (document.getElementById('visionProviderSelect') as HTMLSelectElement)?.value || undefined;
    const model = (document.getElementById('visionModelSelect') as HTMLSelectElement)?.value || undefined;
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) this.renderLoading('Analyzing image…');

    const workflow = {
      id: 'vision-' + Date.now(),
      name: 'Vision',
      graph: {
        nodes: [{
          id: 'vision1',
          type: 'vision' as const,
          label: 'Vision Analyzer',
          config: { includeOcr, preferredProviderId, model },
          inputs: { imageBase64, prompt: prompt || undefined },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { imageBase64, prompt }, (msg, level) => this.appendLog(msg, level));
      const description = result.finalOutput || 'No description returned.';
      if (stage) {
        stage.innerHTML = `
          <div class="result-media">
            <img src="${imageBase64}" style="max-height:200px; border-radius:var(--radius); border:1px solid var(--line-bright); margin-bottom:12px;">
            <div class="result-text">${this.renderMarkdown(description)}</div>
            ${this.renderReadAloudBlock(stripMarkdownForSpeech(description))}
          </div>`;
        this.wireReadAloudControls();
        this.wireCodeCopyButtons(stage);
      }
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'vision', prompt: prompt || '[camera frame]', result: description, resultType: 'text',
      });

      if (speak) {
        // Guarantee the description above is actually painted to the screen
        // before we start speaking it. The DOM write happens synchronously,
        // but without an explicit yield to the browser's render step, a
        // speech provider that resolves quickly (e.g. the browser's own
        // built-in voice, used whenever no keyed TTS provider is configured)
        // could start talking before the text has visibly appeared.
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        try {
          const audioWorkflow = {
            id: 'vision-speech-' + Date.now(),
            name: 'Vision Narration',
            graph: {
              nodes: [{
                id: 'speech1', type: 'speech' as const, label: 'Narrate', config: {},
                inputs: { text: description }, enabled: true,
              }],
              edges: [],
            },
            createdAt: Date.now(), updatedAt: Date.now(),
          };
          const speechResult = await this.kernel.getWorkflowEngine().execute(audioWorkflow, { text: description });
          const url = speechResult.finalOutput;
          if (url === '__BROWSER_TTS_PENDING__') {
            // No keyed provider available — narrate directly via the browser's
            // voice. Unlike the Audio tab (manual Play/Pause/Stop, since a
            // person is looking right at those controls), Vision's "speak"
            // toggle is an explicit opt-in to automatic narration, and the
            // description text is already guaranteed visible above (see the
            // animation-frame wait above), so speaking immediately here is
            // the intended behavior, not the autoplay-before-text bug that
            // affected the Audio tab.
            window.speechSynthesis?.speak(new SpeechSynthesisUtterance(stripMarkdownForSpeech(description)));
          } else if (url) {
            new Audio(url).play();
          }
        } catch {
          // Narration is a nice-to-have; a failure here shouldn't hide the text result already shown.
        }
      }
    } catch (err: any) {
      this.renderError(err);
    } finally {
      this.analyzing = false;
    }
  }

  deactivate(): void {
    this.toggleLiveMode(false);
    this.stopCameraStream();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  getTitle(): string { return 'Vision Output'; }
}
