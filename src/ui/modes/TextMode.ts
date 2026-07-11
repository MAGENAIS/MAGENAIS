import { Mode } from './Mode';
import { Button } from '../components/Button';
import { ChipGroup } from '../components/ChipGroup';
import { EventBus } from '../../core/EventBus';
import { wireMicButton } from '../VoiceInput';

export class TextMode extends Mode {
  private promptInput: HTMLTextAreaElement | null = null;
  private generateBtn: Button | null = null;

  activate(): void {
    // Build control panel
    this.renderControl(`
      <div class="field">
        <label class="field-label">Prompt <span style="text-transform:none;letter-spacing:0;">tap mic to speak it</span></label>
        <textarea id="promptInput" rows="6" placeholder="Write a short story..."></textarea>
        <div class="mic-row">
          <button class="mic-btn" id="micBtn" title="Speak your prompt">🎙</button>
          <span class="hint" id="micStatus">Voice input: tap to speak</span>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Style / system tone <span style="text-transform:none; letter-spacing:0; color:var(--ink-faint);">optional</span></label>
        <input type="text" id="textStyle" placeholder="e.g. concise, technical, playful, formal">
      </div>
      <details class="adv">
        <summary>Advanced</summary>
        <div class="adv-body">
          <div class="field">
            <label class="field-label">Preferred model</label>
            <select id="textModel">
              <option value="openai">openai (general)</option>
              <option value="mistral">mistral</option>
              <option value="claude">claude</option>
              <option value="deepseek">deepseek</option>
              <option value="qwen-coder">qwen-coder</option>
            </select>
          </div>
          <div class="slider-row">
            <label class="field-label" style="min-width:90px;">Temperature</label>
            <input type="range" id="textTemp" min="0" max="2" step="0.1" value="0.8">
            <span class="slider-val" id="textTempVal">0.8</span>
          </div>
        </div>
      </details>
      <p class="hint">Pipeline: text.pollinations.ai → Hugging Face → gen.pollinations.ai</p>
      <button class="run-btn" id="runBtn">▸ Generate</button>
    `);

    // Wire up elements
    this.promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
    const runBtn = document.getElementById('runBtn');
    if (runBtn) {
      this.generateBtn = new Button(
        runBtn.parentElement!, // container is the parent
        '▸ Generate',
        'primary',
        false,
        () => this.handleGenerate()
      );
      // Replace the placeholder button with our component
      // For simplicity, we can keep the existing button and attach event listener.
      runBtn.addEventListener('click', () => this.handleGenerate());
    }

    // Temperature slider
    const tempSlider = document.getElementById('textTemp') as HTMLInputElement;
    const tempVal = document.getElementById('textTempVal') as HTMLElement;
    if (tempSlider && tempVal) {
      tempSlider.addEventListener('input', () => {
        tempVal.textContent = tempSlider.value;
      });
    }

    // Mic button — browser speech recognition, falling back to the audio
    // provider chain (see src/ui/VoiceInput.ts)
    const micBtn = document.getElementById('micBtn');
    const micStatus = document.getElementById('micStatus');
    if (micBtn) {
      wireMicButton(this.kernel, micBtn, micStatus, (transcript) => {
        const input = this.promptInput || (document.getElementById('promptInput') as HTMLTextAreaElement);
        if (input) input.value = (input.value ? input.value + ' ' : '') + transcript;
      });
    }
  }

  deactivate(): void {
    // Cleanup any listeners
  }

  getTitle(): string {
    return 'Text / Voice Output';
  }

  private async handleGenerate(): Promise<void> {
    const prompt = this.promptInput?.value || '';
    if (!prompt) {
      // toast
      return;
    }
    // Dispatch workflow via kernel
    const workflowEngine = this.kernel.getWorkflowEngine();
    const store = this.kernel.getStore();

    // We need to create a workflow definition for text generation.
    // For now, we'll use the existing runTextChain from the legacy code.
    // In the future, we'll build a proper workflow.
    // This is a bridge: we can still use the legacy runGeneration function
    // until we fully migrate to workflows.

    // For demonstration, we'll call the legacy function (but we should avoid that).
    // Instead, we can create a workflow on the fly.
    // We'll implement a simple workflow with a single text node.

    // For now, just show a busy state and use the kernel's workflow engine.
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) {
      stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Generating...</div>';
    }

    try {
      // Build a simple workflow with one text node
      const workflow = {
        id: 'temp-' + Date.now(),
        name: 'Text Generation',
        graph: {
          nodes: [
            {
              id: 'text1',
              type: 'text' as const,
              label: 'Text Generator',
              config: {
                model: (document.getElementById('textModel') as HTMLSelectElement)?.value || 'openai',
                temperature: parseFloat((document.getElementById('textTemp') as HTMLInputElement)?.value || '0.8'),
              },
              inputs: { prompt: prompt },
              enabled: true,
            },
          ],
          edges: [],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      // Execute workflow
      const result = await workflowEngine.execute(workflow, { prompt });
      // Display result
      const output = result.finalOutput || 'No output';
      if (stage) {
        stage.innerHTML = `<div class="result-text">${output}</div>`;
        // Add copy/play buttons (similar to legacy)
      }
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'text', prompt, result: output, resultType: 'text',
      });
    } catch (err: any) {
      if (stage) {
        stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${err.message}</div>`;
      }
    }
  }
}
