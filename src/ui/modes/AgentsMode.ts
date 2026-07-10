import { Mode } from './Mode';

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
      this.pipelineSteps.push({ id: 'step-' + Date.now(), modeType: 'text', promptTemplate: '{{previous}}', personaId: '' });
      this.saveState();
      this.renderPipelineSteps();
    });

    document.getElementById('runBtn')?.addEventListener('click', () => this.handleGenerate());

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
      this.pipelineSteps = [{ id: 'step1', modeType: 'research', promptTemplate: 'Latest research on {{previous}}', personaId: '' }];
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
    const typeOptions = ['research', 'text', 'doc-summarize', 'image', 'audio'].map(t =>
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
        nodes: this.pipelineSteps.map((step, idx) => ({
          id: step.id || 'step-' + idx,
          type: step.modeType as any,
          label: `Step ${idx+1}`,
          config: { model: 'openai', temp: 0.7 },
          inputs: { prompt: step.promptTemplate },
          enabled: true,
        })),
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
      const result = await this.kernel.getWorkflowEngine().execute(workflow, {});
      // Display results
      let html = '';
      result.nodeResults.forEach((nr, idx) => {
        const step = this.pipelineSteps[idx];
        html += `<div class="doc-summary-block" style="margin-bottom:16px;">
          <p class="field-label" style="margin-bottom:6px;">Step ${idx+1} — ${step.modeType}${step.personaId ? ' (' + (this.personas.find(p=>p.id===step.personaId)?.name || '') + ')' : ''}</p>
          <div class="result-text">${nr.output}</div>
        </div>`;
      });
      if (stage) stage.innerHTML = html;
    } catch (err: any) {
      if (stage) stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${err.message}</div>`;
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Pipeline Results'; }
}
