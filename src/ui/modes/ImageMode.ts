import { Mode } from './Mode';

export class ImageMode extends Mode {
  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Prompt</label>
        <textarea id="promptInput" rows="5" placeholder="A low-poly Achaemenid palace at golden hour..."></textarea>
      </div>
      <div class="field">
        <label class="field-label">Style</label>
        <div class="chip-group" id="imageStyleChips">
          <span class="chip active" data-val="">None</span>
          <span class="chip" data-val="photorealistic, ultra detailed, 8k, sharp focus, professional photography">Photoreal</span>
          <span class="chip" data-val="anime style, cel shaded, vibrant colors, detailed line art">Anime</span>
          <span class="chip" data-val="oil painting, fine art, painterly brushstrokes, gallery quality">Painterly</span>
          <span class="chip" data-val="low poly 3d render, clean geometry, soft studio lighting">Low-poly 3D</span>
          <span class="chip" data-val="pixel art, 16-bit, crisp pixels, retro game aesthetic">Pixel art</span>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label">Width</label>
          <select id="imgWidth">
            <option value="768">768</option>
            <option value="1024" selected>1024</option>
            <option value="1280">1280</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Height</label>
          <select id="imgHeight">
            <option value="768">768</option>
            <option value="1024" selected>1024</option>
            <option value="1280">1280</option>
            <option value="720">720</option>
          </select>
        </div>
      </div>
      <details class="adv" open>
        <summary>Quality</summary>
        <div class="adv-body">
          <div class="field">
            <label class="field-label">Model</label>
            <select id="imgModel">
              <option value="flux" selected>flux (best quality, recommended)</option>
              <option value="gptimage">gptimage (high fidelity, needs key)</option>
              <option value="turbo">turbo (fast, lower detail)</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">Seed <span style="text-transform:none;color:var(--ink-faint);">blank = random</span></label>
            <input type="text" id="imgSeed" placeholder="e.g. 42">
          </div>
        </div>
      </details>
      <p class="hint">Pipeline: image.pollinations.ai → gen.pollinations.ai → Hugging Face</p>
      <button class="run-btn" id="runBtn">▸ Generate Image</button>
    `);

    this.wireChips();
    const runBtn = document.getElementById('runBtn');
    runBtn?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleGenerate()));
  }

  private wireChips(): void {
    document.querySelectorAll('#imageStyleChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#imageStyleChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  }

  private async handleGenerate(): Promise<void> {
    const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!prompt) { alert('Enter a prompt.'); return; }
    const styleChip = document.querySelector('#imageStyleChips .chip.active') as HTMLElement;
    const style = styleChip?.dataset.val || '';
    const finalPrompt = style ? `${prompt}, ${style}` : prompt;
    const width = (document.getElementById('imgWidth') as HTMLSelectElement)?.value || '1024';
    const height = (document.getElementById('imgHeight') as HTMLSelectElement)?.value || '1024';
    const model = (document.getElementById('imgModel') as HTMLSelectElement)?.value || 'flux';
    const seed = (document.getElementById('imgSeed') as HTMLInputElement)?.value.trim() || undefined;

    // Build a workflow with an image node
    const workflow = {
      id: 'img-' + Date.now(),
      name: 'Image Generation',
      graph: {
        nodes: [{
          id: 'img1',
          type: 'image' as const,
          label: 'Image Generator',
          config: { model, width: parseInt(width), height: parseInt(height), seed },
          inputs: { prompt: finalPrompt },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Generating image...</div>';

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { prompt: finalPrompt });
      const url = result.finalOutput;
      if (stage) {
        stage.innerHTML = `
          <div class="result-media">
            <img src="${url}" alt="Generated image">
            <div class="result-actions">
              <a href="${url}" download="magen-image.png"><button class="ghost-btn">Download PNG</button></a>
              <button class="ghost-btn" id="regenBtn">Regenerate</button>
            </div>
          </div>`;
        document.getElementById('regenBtn')?.addEventListener('click', () => this.runGuarded('regenBtn', () => this.handleGenerate()));
      }
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'image', prompt: finalPrompt, result: url, resultType: 'image',
      });
    } catch (err: any) {
      if (stage) stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${err.message}</div>`;
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Image Output'; }
}
