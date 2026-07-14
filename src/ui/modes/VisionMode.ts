import { Mode } from './Mode';

export class VisionMode extends Mode {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private liveInterval: number | null = null;
  private analyzing = false;

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Camera</label>
        <div style="position:relative; border:1px solid var(--line-bright); border-radius:var(--radius); overflow:hidden; background:var(--bg);">
          <video id="visionVideo" autoplay playsinline muted style="width:100%; display:block; max-height:280px; object-fit:cover;"></video>
          <div id="visionCameraOff" class="empty-text" style="padding:40px 10px; text-align:center;">Camera is off. Click "Start Camera" to begin.</div>
        </div>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="ghost-btn" id="toggleCameraBtn">Start Camera</button>
          <button class="ghost-btn" id="uploadImageBtn">Upload Image Instead</button>
        </div>
        <input type="file" id="visionFileInput" accept="image/*" style="display:none;">
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
          <span class="field-label" style="margin:0;">Live mode <span style="text-transform:none;color:var(--ink-faint);">analyze every 8 seconds</span></span>
        </label>
      </div>
      <p class="hint">Vision uses your Anthropic or Google Gemini key (same one used for Text &amp; Voice) — both support real image understanding. Frames are analyzed on demand, not streamed anywhere.</p>
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
  }

  private async toggleCamera(): Promise<void> {
    const btn = document.getElementById('toggleCameraBtn') as HTMLButtonElement;
    const off = document.getElementById('visionCameraOff') as HTMLElement;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      if (this.videoEl) this.videoEl.srcObject = null;
      off.style.display = '';
      btn.textContent = 'Start Camera';
      this.toggleLiveMode(false);
      (document.getElementById('visionLiveToggle') as HTMLInputElement).checked = false;
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (this.videoEl) this.videoEl.srcObject = this.stream;
      off.style.display = 'none';
      btn.textContent = 'Stop Camera';
    } catch (err: any) {
      alert("Couldn't access the camera — " + err.message);
    }
  }

  private toggleLiveMode(on: boolean): void {
    if (this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = null;
    }
    if (on) {
      if (!this.stream) { alert('Start the camera first.'); return; }
      this.liveInterval = window.setInterval(() => {
        if (!this.analyzing) this.handleAnalyze();
      }, 8000);
      this.handleAnalyze();
    }
  }

  private captureFrameAsDataUrl(): string | null {
    if (!this.videoEl || !this.stream) return null;
    const canvas = document.createElement('canvas');
    canvas.width = this.videoEl.videoWidth || 640;
    canvas.height = this.videoEl.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  private async handleAnalyze(): Promise<void> {
    const imageBase64 = this.captureFrameAsDataUrl();
    if (!imageBase64) { alert('Start the camera or upload an image first.'); return; }
    await this.runAnalysis(imageBase64);
  }

  private async analyzeUploadedFile(file: File): Promise<void> {
    const reader = new FileReader();
    reader.onload = () => this.runAnalysis(reader.result as string);
    reader.readAsDataURL(file);
  }

  private async runAnalysis(imageBase64: string): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    const speak = (document.getElementById('visionSpeakToggle') as HTMLInputElement)?.checked;
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Analyzing image…</div>';

    const workflow = {
      id: 'vision-' + Date.now(),
      name: 'Vision',
      graph: {
        nodes: [{
          id: 'vision1',
          type: 'vision' as const,
          label: 'Vision Analyzer',
          config: {},
          inputs: { imageBase64, prompt: prompt || undefined },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { imageBase64, prompt });
      const description = result.finalOutput || 'No description returned.';
      if (stage) {
        stage.innerHTML = `
          <div class="result-media">
            <img src="${imageBase64}" style="max-height:200px; border-radius:var(--radius); border:1px solid var(--line-bright); margin-bottom:12px;">
            <div class="result-text">${description}</div>
          </div>`;
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
          if (url && url !== '__BROWSER_TTS_PLAYED__') {
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
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  getTitle(): string { return 'Vision Output'; }
}
