import { Mode } from './Mode';

export class VideoMode extends Mode {
  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Prompt</label>
        <textarea id="promptInput" rows="5" placeholder="A drone shot slowly rising over a misty mountain valley..."></textarea>
      </div>
      <div class="field">
        <label class="field-label">Duration</label>
        <div class="slider-row">
          <input type="range" id="vidDuration" min="2" max="8" step="1" value="4">
          <span class="slider-val" id="vidDurationVal">4s</span>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Aspect ratio</label>
        <div class="chip-group" id="vidAspectChips">
          <span class="chip active" data-val="16:9">16:9</span>
          <span class="chip" data-val="9:16">9:16</span>
          <span class="chip" data-val="1:1">1:1</span>
        </div>
      </div>
      <details class="adv" open>
        <summary>Quality</summary>
        <div class="adv-body">
          <div class="field">
            <label class="field-label">Model</label>
            <select id="vidModel">
              <option value="wan" selected>wan (best free-tier real video)</option>
              <option value="seedance">seedance (higher quality, may require paid credits)</option>
              <option value="nova-reel">nova-reel (Amazon, longer clips up to 120s)</option>
              <option value="veo">veo (Google, alpha – often paid-only)</option>
            </select>
          </div>
          <label class="field-label" style="cursor:pointer; flex-direction:row; justify-content:flex-start; gap:6px;">
            <input type="checkbox" id="vidFallbackOK" checked style="width:auto;">Allow Ken-Burns fallback if no video model responds
          </label>
        </div>
      </details>
      <div id="vidKeyWarning"></div>
      <p class="hint">Pipeline: Custom endpoint → gen.pollinations.ai/video → Hugging Face → animated still fallback</p>
      <button class="run-btn" id="runBtn">▸ Generate Video</button>
    `);

    // Slider
    const durSlider = document.getElementById('vidDuration') as HTMLInputElement;
    const durVal = document.getElementById('vidDurationVal') as HTMLElement;
    durSlider?.addEventListener('input', () => { if (durVal) durVal.textContent = durSlider.value + 's'; });

    // Aspect chips
    document.querySelectorAll('#vidAspectChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#vidAspectChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });

    // Key warning (simplified)
    const warnDiv = document.getElementById('vidKeyWarning');
    if (warnDiv) {
      // Check if Pollinations key exists (from provider manager)
      const hasPollKey = this.kernel.getProviderManager().getProviders('video', true)
        .some(p => p.adapterId === 'pollinations' && p.apiKey);
      warnDiv.innerHTML = !hasPollKey
        ? '<p class="hint" style="color:var(--rust); border:1px solid var(--rust); border-radius:var(--radius); padding:8px 10px;">No Pollinations key set – real AI video will fall back to pan/zoom still. Add a key in Keys &amp; Providers.</p>'
        : '<p class="hint" style="color:var(--ink-faint);">Pollinations key present – video generation may still require Pollen balance.</p>';
    }

    document.getElementById('runBtn')?.addEventListener('click', () => this.handleGenerate());
  }

  private async handleGenerate(): Promise<void> {
    const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!prompt) { alert('Enter a prompt.'); return; }
    const duration = parseInt((document.getElementById('vidDuration') as HTMLInputElement)?.value || '4');
    const aspectChip = document.querySelector('#vidAspectChips .chip.active') as HTMLElement;
    const aspect = aspectChip?.dataset.val || '16:9';
    const model = (document.getElementById('vidModel') as HTMLSelectElement)?.value || 'wan';
    const allowFallback = (document.getElementById('vidFallbackOK') as HTMLInputElement)?.checked ?? true;

    const workflow = {
      id: 'vid-' + Date.now(),
      name: 'Video Generation',
      graph: {
        nodes: [{
          id: 'vid1',
          type: 'video',
          label: 'Video Generator',
          config: { model, duration, aspect, allowFallback },
          inputs: { prompt },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Generating video (may take 30–90s)...</div>';

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { prompt });
      const url = result.finalOutput;
      const isFallback = result.nodeResults.some(n => n.nodeId === 'vid1' && n.output?.isFallback);
      if (stage) {
        stage.innerHTML = `
          <div class="result-media">
            ${isFallback ? `<div class="hint" style="color:var(--rust); border:1px solid var(--rust); border-radius:var(--radius); padding:8px 10px; margin-bottom:4px;"><b>This is a panned still image, not real AI-generated video.</b></div>` : `<div class="hint" style="color:var(--moss);">✓ Real AI-generated video</div>`}
            <video src="${url}" controls autoplay loop muted></video>
            <div class="result-actions">
              <a href="${url}" download="magen-video.webm"><button class="ghost-btn">Download Video</button></a>
            </div>
          </div>`;
      }
    } catch (err: any) {
      if (stage) stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${err.message}</div>`;
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Video Output'; }
}
