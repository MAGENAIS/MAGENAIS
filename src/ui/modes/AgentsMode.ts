import { Mode } from './Mode';
import { NODE_PRIMARY_INPUT_KEY } from '../../workflows/nodeInputKeys';
import { stripMarkdownForSpeech } from '../../core/textUtils';

export class AgentsMode extends Mode {
  private personas: any[] = [];
  private pipelineSteps: any[] = [];

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Section</label>
        <div class="chip-group" id="agentsSectionChips">
          <span class="chip active" data-val="pipeline">Pipeline</span>
          <span class="chip" data-val="personas">Personas</span>
        </div>
      </div>
      <div id="personasPanel" style="display:none;">
        <div class="field">
          <label class="field-label">Saved personas</label>
          <div id="personaList" style="display:flex; flex-direction:column; gap:8px;"></div>
        </div>
        <details class="adv" open>
          <summary>New persona</summary>
          <div class="adv-body">
            <div class="field">
              <label class="field-label">Name</label>
              <input type="text" id="personaName" placeholder="e.g. Skeptical Editor">
            </div>
            <div class="field">
              <label class="field-label">Instructions</label>
              <textarea id="personaInstructions" rows="4" placeholder="You are a meticulous technical editor..."></textarea>
            </div>
            <div class="field-row">
              <div class="field">
                <label class="field-label">Model</label>
                <select id="personaModel">
                  <option value="openai">openai</option>
                  <option value="mistral">mistral</option>
                  <option value="claude">claude</option>
                  <option value="deepseek">deepseek</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label">Temperature</label>
                <input type="number" id="personaTemp" min="0" max="2" step="0.1" value="0.7">
              </div>
            </div>
            <button class="ghost-btn" id="savePersonaBtn" style="align-self:flex-start;">Save persona</button>
          </div>
        </details>
        <p class="hint">Personas are reusable instruction-sets for pipeline steps.</p>
      </div>
      <div id="pipelinePanel">
        <div class="field">
          <label class="field-label">Pipeline steps</label>
          <div id="pipelineStepList" style="display:flex; flex-direction:column; gap:10px;"></div>
          <button class="ghost-btn" id="addPipelineStepBtn" style="align-self:flex-start; margin-top:6px;">+ Add step</button>
        </div>
        <p class="hint">Use <code>{{previous}}</code> to reference previous step output. Persona instructions are prepended.</p>
        <button class="run-btn" id="runBtn">▸ Run Pipeline</button>
      </div>
    `);

    // Section switching
    document.querySelectorAll('#agentsSectionChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#agentsSectionChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const section = (chip as HTMLElement).dataset.val;
        document.getElementById('personasPanel')!.style.display = section === 'personas' ? '' : 'none';
        document.getElementById('pipelinePanel')!.style.display = section === 'pipeline' ? '' : 'none';
      });
    });

    // Load personas and steps from state (or localStorage)
    this.loadState();

    // Persona save
    document.getElementById('savePersonaBtn')?.addEventListener('click', () => {
      const name = (document.getElementById('personaName') as HTMLInputElement)?.value.trim();
      const instructions = (document.getElementById('personaInstructions') as HTMLTextAreaElement)?.value.trim();
      if (!name || !instructions) { alert('Give the persona a name and instructions.'); return; }
      const model = (document.getElementById('personaModel') as HTMLSelectElement)?.value || 'openai';
      const temp = parseFloat((document.getElementById('personaTemp') as HTMLInputElement)?.value || '0.7');
      this.personas.push({ id: 'p-' + Date.now(), name, instructions, model, temp });
      this.saveState();
      this.renderPersonas();
      this.renderPipelineSteps();
    });

    // Add pipeline step
    document.getElementById('addPipelineStepBtn')?.addEventListener('click', () => {
      this.pipelineSteps.push({ id: 'step-' + Date.now(), modeType: 'text', promptTemplate: '', personaId: '' });
      this.saveState();
      this.renderPipelineSteps();
    });

    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleGenerate()));

    // Initial render
    this.renderPersonas();
    this.renderPipelineSteps();
  }

  private loadState(): void {
    // In a real implementation, load from store (e.g., kernel.getStore())
    // For now we use a simple in-memory array
    if (!this.personas.length) {
      // default example
      this.personas = [];
      // ROOT CAUSE of "prompt box already has example text in it when the tab
      // opens": this seeded the step's actual promptTemplate value (not just
      // its placeholder) with example copy, so it rendered as real content in
      // the textarea (line 191 binds `${step.promptTemplate}` verbatim) that
      // had to be manually deleted before typing. The textarea already shows
      // the same example via its `placeholder` attribute below, which is the
      // correct place for hint text — it displays only when empty and clears
      // itself the moment the user starts typing.
      this.pipelineSteps = [{ id: 'step1', modeType: 'research', promptTemplate: '', personaId: '' }];
    }
  }

  private saveState(): void {
    // Save to store if needed
  }

  private renderPersonas(): void {
    const list = document.getElementById('personaList') as HTMLElement;
    if (!list) return;
    if (!this.personas.length) {
      list.innerHTML = '<p class="hint">No personas saved yet.</p>';
      return;
    }
    list.innerHTML = '';
    this.personas.forEach(p => {
      const card = document.createElement('div');
      card.className = 'file-chip';
      card.style.alignItems = 'flex-start';
      card.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px; overflow:hidden;">
          <b style="color:var(--ink);">${p.name}</b>
          <span style="color:var(--ink-faint); font-size:10.5px;">${p.instructions.slice(0,80)}${p.instructions.length>80?'…':''}</span>
        </div>
        <button title="Remove">×</button>
      `;
      card.querySelector('button')?.addEventListener('click', () => {
        this.personas = this.personas.filter(x => x.id !== p.id);
        this.saveState();
        this.renderPersonas();
        this.renderPipelineSteps();
      });
      list.appendChild(card);
    });
  }

  private renderPipelineSteps(): void {
    const list = document.getElementById('pipelineStepList') as HTMLElement;
    if (!list) return;
    list.innerHTML = '';
    // Every type here must (a) be a real NodeType the engine can execute,
    // and (b) accept a plain text prompt as its primary input, since that's
    // the only input field this step UI offers. 'doc-summarize' was never a
    // valid NodeType (the engine has no executor for it — every step using
    // it failed outright); 'audio' is speech-to-text, which needs an audio
    // FILE as input, not a text prompt, so it never made sense here either.
    // 'speech' (text-to-speech) fits the same shape as the others.
    const typeOptions = ['research', 'text', 'coding', 'image', 'speech', 'gamegen'].map(t =>
      `<option value="${t}">${t}</option>`
    ).join('');
    this.pipelineSteps.forEach((step, idx) => {
      const card = document.createElement('div');
      card.style.border = '1px solid var(--line-bright)';
      card.style.borderRadius = 'var(--radius)';
      card.style.padding = '10px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '8px';

      const personaOptions = `<option value="">No persona</option>` +
        this.personas.map(p => `<option value="${p.id}" ${p.id===step.personaId?'selected':''}>${p.name}</option>`).join('');

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="field-label" style="margin:0;">Step ${idx+1}</span>
          <button class="ghost-btn small" data-action="remove">Remove</button>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Type</label>
            <select data-field="modeType">${typeOptions}</select>
          </div>
          <div class="field">
            <label class="field-label">Persona</label>
            <select data-field="personaId">${personaOptions}</select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Prompt ${idx>0?'<span style="text-transform:none;color:var(--ink-faint);">use {{previous}}</span>':''}</label>
          <textarea data-field="promptTemplate" rows="3" placeholder="${idx===0 ? 'e.g. Latest research on solid-state batteries' : 'e.g. Write a short summary of: {{previous}}'}">${step.promptTemplate}</textarea>
        </div>
      `;

      card.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        this.pipelineSteps = this.pipelineSteps.filter(s => s.id !== step.id);
        this.saveState();
        this.renderPipelineSteps();
      });
      const modeSelect = card.querySelector('[data-field="modeType"]') as HTMLSelectElement;
      modeSelect.value = step.modeType;
      modeSelect.addEventListener('change', () => { step.modeType = modeSelect.value; this.saveState(); });

      const personaSelect = card.querySelector('[data-field="personaId"]') as HTMLSelectElement;
      personaSelect.value = step.personaId;
      personaSelect.addEventListener('change', () => { step.personaId = personaSelect.value; this.saveState(); });

      const promptTextarea = card.querySelector('[data-field="promptTemplate"]') as HTMLTextAreaElement;
      promptTextarea.value = step.promptTemplate;
      promptTextarea.addEventListener('input', () => { step.promptTemplate = promptTextarea.value; this.saveState(); });

      list.appendChild(card);
    });
  }

  private async handleGenerate(): Promise<void> {
    if (!this.pipelineSteps.length) { alert('Add at least one pipeline step.'); return; }

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Running pipeline...</div>';

    try {
      // Build a workflow that executes the pipeline sequentially
      // We'll use the workflow engine's ability to chain nodes.
      // For simplicity, we'll create a single workflow with all steps as separate nodes, connected in series.
      const graph = {
        nodes: this.pipelineSteps.map((step, idx) => {
          const nodeId = step.id || 'step-' + idx;
          const prevId = idx > 0 ? (this.pipelineSteps[idx - 1].id || 'step-' + (idx - 1)) : null;
          // ROOT CAUSE (reported: Agents tab shows no real result): the
          // step-editor UI explicitly tells users to type "{{previous}}"
          // to reference the prior step's output (see renderPipelineSteps'
          // placeholder text/label above) — but this builder used to send
          // step.promptTemplate to the LLM completely verbatim, so
          // "{{previous}}" was never substituted with anything; the model
          // just saw the literal text "{{previous}}". Translating it into
          // the engine's own `${nodeId}` reference syntax (now supported
          // even embedded inside a larger string — see
          // GraphUtils.resolveInputs) makes the documented placeholder
          // actually work.
          const promptWithRefs = prevId
            ? step.promptTemplate.replace(/\{\{\s*previous\s*\}\}/gi, `\${${prevId}}`)
            : step.promptTemplate;
          const inputKey = NODE_PRIMARY_INPUT_KEY[step.modeType as import('../../workflows/types').NodeType] || 'prompt';
          return {
            id: nodeId,
            type: step.modeType as any,
            label: `Step ${idx + 1}`,
            config: { model: 'openai', temp: 0.7 },
            inputs: { [inputKey]: promptWithRefs },
            enabled: true,
          };
        }),
        edges: this.pipelineSteps.slice(1).map((step, idx) => ({
          from: this.pipelineSteps[idx].id || 'step-' + idx,
          to: step.id || 'step-' + (idx+1),
        })),
      };
      const workflow = {
        id: 'pipe-' + Date.now(),
        name: 'Pipeline',
        graph,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const result = await this.kernel.getWorkflowEngine().execute(workflow, {}, (msg, level) => this.appendLog(msg, level));
      // Display results
      let html = '';
      result.nodeResults.forEach((nr, idx) => {
        const step = this.pipelineSteps[idx];
        const personaLabel = step.personaId ? ' (' + (this.personas.find(p=>p.id===step.personaId)?.name || '') + ')' : '';
        let body: string;
        let readAloudText: string | null = null;
        if (nr.status === 'failed') {
          const div = document.createElement('div');
          div.textContent = nr.error || 'unknown error';
          body = `<div class="result-text" style="color:var(--rust);">Failed: ${div.innerHTML}</div>`;
        } else if (typeof nr.output === 'string' && nr.output.startsWith('blob:')) {
          body = step.modeType === 'image'
            ? `<div class="result-media"><img src="${nr.output}" style="max-height:220px; border-radius:var(--radius);"></div>`
            : `<div class="result-media"><audio src="${nr.output}" controls></audio></div>`;
        } else {
          // ROOT CAUSE (reported: Agents tab always shows "[object
          // Object]" instead of a result): this used to interpolate
          // `nr.output` directly into a template literal — fine for a
          // string, but for any structured result (an object, an
          // {url:...} media reference, etc.) JS's implicit toString()
          // coercion on a plain object literally produces the string
          // "[object Object]". Render text as text, and stringify
          // anything else properly instead of relying on that coercion.
          const textOutput = typeof nr.output === 'string'
            ? nr.output
            : (nr.output && typeof nr.output === 'object' && typeof (nr.output as any).url === 'string')
              ? (nr.output as any).url
              : JSON.stringify(nr.output, null, 2);
          body = `<div class="result-text">${this.renderMarkdown(textOutput)}</div>`;
          // Only offer read-aloud for genuinely spoken-word-worthy text
          // output (not a bare URL and not raw JSON from a non-text step).
          if (typeof nr.output === 'string' && !nr.output.startsWith('http')) {
            readAloudText = textOutput;
          }
        }
        html += `<div class="doc-summary-block" style="margin-bottom:16px;">
          <p class="field-label" style="margin-bottom:6px;">Step ${idx+1} — ${step.modeType}${personaLabel}</p>
          ${body}
          ${readAloudText ? this.renderReadAloudBlock(stripMarkdownForSpeech(readAloudText), `Read Step ${idx + 1} Aloud`) : ''}
        </div>`;
      });
      if (stage) stage.innerHTML = html;
      this.wireReadAloudControls();
      this.wireCodeCopyButtons(stage);
    } catch (err: any) {
      this.renderError(err);
    }
  }

  deactivate(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
  getTitle(): string { return 'Pipeline Results'; }
}
