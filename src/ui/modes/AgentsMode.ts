import { Mode } from './Mode';
import { stripMarkdownForSpeech } from '../../core/textUtils';
import { AgentPipeline, AgentPlanStep, AgentRunSummary } from '../../workflows/AgentPipeline';
import { Persistence } from '../../core/state/Persistence';

export class AgentsMode extends Mode {
  private personas: any[] = [];
  private pipelineSteps: any[] = [];
  private goal: string = '';
  private optimizePrompts: boolean = true;
  private reflectEnabled: boolean = true;
  private agentPipeline!: AgentPipeline;
  // Own namespaced blob, same read-merge-write pattern as ProviderManager/Store
  // (see Persistence.ts) — reuses the existing storage system rather than
  // inventing a new one. Previously this mode's saveState()/loadState() were
  // stubs (personas and pipeline steps vanished on every reload); this is
  // also the bug fix for that.
  private persistence = new Persistence({ type: 'localStorage', namespace: 'magenais:agents-mode' });

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
        <details class="adv" open>
          <summary>Goal → auto-plan</summary>
          <div class="adv-body">
            <div class="field">
              <label class="field-label">Goal</label>
              <textarea id="agentGoal" rows="2" placeholder="e.g. Research the pros and cons of remote work, then write a short summary">${this.escapeHtml(this.goal)}</textarea>
            </div>
            <button class="ghost-btn" id="autoPlanBtn" style="align-self:flex-start;">✦ Auto-plan steps</button>
            <p class="hint">Generates an editable step-by-step plan below — nothing runs until you press Run Pipeline.</p>
          </div>
        </details>
        <div class="field">
          <label class="field-label">Pipeline steps</label>
          <div id="pipelineStepList" style="display:flex; flex-direction:column; gap:10px;"></div>
          <button class="ghost-btn" id="addPipelineStepBtn" style="align-self:flex-start; margin-top:6px;">+ Add step</button>
        </div>
        <p class="hint">Use <code>{{previous}}</code> to reference previous step output. Persona instructions are prepended.</p>
        <div class="field-row">
          <label class="hint" style="display:flex; align-items:center; gap:6px;"><input type="checkbox" id="optimizePromptsChk"> Optimize prompts before sending</label>
          <label class="hint" style="display:flex; align-items:center; gap:6px;"><input type="checkbox" id="reflectChk"> Reflect on each step &amp; retry if needed</label>
        </div>
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

    this.agentPipeline = new AgentPipeline(this.kernel);

    // Load personas and steps from state (or localStorage)
    this.loadState();

    const optimizeChk = document.getElementById('optimizePromptsChk') as HTMLInputElement;
    optimizeChk.checked = this.optimizePrompts;
    optimizeChk.addEventListener('change', () => { this.optimizePrompts = optimizeChk.checked; this.saveState(); });

    const reflectChk = document.getElementById('reflectChk') as HTMLInputElement;
    reflectChk.checked = this.reflectEnabled;
    reflectChk.addEventListener('change', () => { this.reflectEnabled = reflectChk.checked; this.saveState(); });

    const goalInput = document.getElementById('agentGoal') as HTMLTextAreaElement;
    goalInput.addEventListener('input', () => { this.goal = goalInput.value; this.saveState(); });

    // Requirement 2 (Automatic Planning) + Requirement 5 (Tool Selection):
    // turns the free-text goal into an editable step-by-step plan using the
    // same step cards as manual editing — nothing runs until Run Pipeline.
    document.getElementById('autoPlanBtn')?.addEventListener('click', () => this.runGuarded('autoPlanBtn', async () => {
      const goal = goalInput.value.trim();
      if (!goal) { alert('Describe a goal to auto-plan from first.'); return; }
      this.appendLog(`Planning steps for: "${goal}"…`);
      const plan = await this.agentPipeline.planFromGoal(goal, (msg, level) => this.appendLog(msg, level));
      this.pipelineSteps = plan.steps.map((s: AgentPlanStep) => ({
        id: s.id, modeType: s.modeType, promptTemplate: s.promptTemplate, personaId: '',
      }));
      this.saveState();
      this.renderPipelineSteps();
      this.appendLog(`Plan ready — ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}. Review and edit below, then Run Pipeline.`);
    }));

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
      this.pipelineSteps.push({ id: 'step-' + Date.now(), modeType: 'agents', promptTemplate: '', personaId: '' });
      this.saveState();
      this.renderPipelineSteps();
    });

    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleGenerate()));

    // Initial render (synchronous defaults — see loadState below for why
    // this can't simply await the persisted state before first paint)
    this.renderPersonas();
    this.renderPipelineSteps();

    // ROOT CAUSE FIX (bug discovered during this pass): saveState()/loadState()
    // were both no-op stubs — personas and pipeline steps silently vanished on
    // every reload despite the UI implying they were saved (the persona list
    // even calls itself "Saved personas"). Persistence (see Persistence.ts,
    // the same read/write pattern ProviderManager and Store already use) is
    // async, so the synchronous defaults above still render immediately —
    // this just overlays the persisted state on top once it's loaded, same
    // as how a real page-load-then-hydrate flow works elsewhere in the app.
    this.persistence.load().then((saved: any) => {
      if (!saved) return;
      if (Array.isArray(saved.personas)) this.personas = saved.personas;
      if (Array.isArray(saved.pipelineSteps) && saved.pipelineSteps.length) this.pipelineSteps = saved.pipelineSteps;
      if (typeof saved.goal === 'string') this.goal = saved.goal;
      if (typeof saved.optimizePrompts === 'boolean') this.optimizePrompts = saved.optimizePrompts;
      if (typeof saved.reflectEnabled === 'boolean') this.reflectEnabled = saved.reflectEnabled;

      const goalInput = document.getElementById('agentGoal') as HTMLTextAreaElement | null;
      if (goalInput) goalInput.value = this.goal;
      const optimizeChk = document.getElementById('optimizePromptsChk') as HTMLInputElement | null;
      if (optimizeChk) optimizeChk.checked = this.optimizePrompts;
      const reflectChk = document.getElementById('reflectChk') as HTMLInputElement | null;
      if (reflectChk) reflectChk.checked = this.reflectEnabled;

      this.renderPersonas();
      this.renderPipelineSteps();
    }).catch(() => { /* best-effort — defaults from loadState() above still stand */ });
  }

  private loadState(): void {
    // Synchronous defaults, shown immediately while the real persisted
    // state (if any) loads asynchronously — see the .then() block above.
    if (!this.personas.length) {
      this.personas = [];
      // ROOT CAUSE of "prompt box already has example text in it when the tab
      // opens": this seeded the step's actual promptTemplate value (not just
      // its placeholder) with example copy, so it rendered as real content in
      // the textarea (line 191 binds `${step.promptTemplate}` verbatim) that
      // had to be manually deleted before typing. The textarea already shows
      // the same example via its `placeholder` attribute below, which is the
      // correct place for hint text — it displays only when empty and clears
      // itself the moment the user starts typing.
      this.pipelineSteps = [{ id: 'step1', modeType: 'agents', promptTemplate: '', personaId: '' }];
    }
  }

  private saveState(): void {
    this.persistence.save({
      personas: this.personas,
      pipelineSteps: this.pipelineSteps,
      goal: this.goal,
      optimizePrompts: this.optimizePrompts,
      reflectEnabled: this.reflectEnabled,
    }).catch(() => { /* Persistence.save already handles/logs its own failure modes */ });
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
    //
    // 'agents' (general task) is listed first and is the default for new
    // steps — see AgentNodeExecutor in Node.ts. 'research' is deliberately
    // NOT a general-purpose option: it is a literal academic-paper-only
    // pipeline (Semantic Scholar/OpenAlex/arXiv), so it's labeled
    // explicitly here to avoid the exact bug that was reported — a
    // non-literature task like "book a flight" being sent to it, matching
    // nothing, and falling through to an unrelated Wikipedia summary.
    const typeLabels: Record<string, string> = {
      agents: 'agent (general task)',
      research: 'research (academic papers only)',
      text: 'text',
      coding: 'coding',
      image: 'image',
      speech: 'speech (text-to-speech)',
      gamegen: 'gamegen',
    };
    const typeOptions = ['agents', 'research', 'text', 'coding', 'image', 'speech', 'gamegen'].map(t =>
      `<option value="${t}">${typeLabels[t]}</option>`
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
          <textarea data-field="promptTemplate" rows="3" placeholder="${idx===0 ? 'e.g. Draft a project plan for launching a podcast' : 'e.g. Write a short summary of: {{previous}}'}">${step.promptTemplate}</textarea>
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
    if (stage) this.renderLoading('Running pipeline...');

    try {
      // Requirement 9 ("avoid duplicate logic"): both manually-authored and
      // auto-planned pipelines run through the same AgentPipeline.runSteps —
      // it builds/executes one single-node workflow per step (reusing the
      // real WorkflowEngine + NodeRegistry executors exactly as before) and
      // additionally handles {{previous}} substitution, prompt optimization,
      // reflection-driven retry, and skip/continue between steps.
      const planSteps: AgentPlanStep[] = this.pipelineSteps.map((step, idx) => ({
        id: step.id || 'step-' + idx,
        title: `Step ${idx + 1}`,
        modeType: step.modeType,
        promptTemplate: step.promptTemplate,
        personaId: step.personaId || undefined,
      }));
      const { nodeResults, summary } = await this.agentPipeline.runSteps({
        goal: this.goal || planSteps[0]?.promptTemplate || '',
        steps: planSteps,
        personas: this.personas,
        optimizePrompts: this.optimizePrompts,
        reflect: this.reflectEnabled,
        log: (msg, level) => this.appendLog(msg, level),
      });

      // Display results — same rendering shape as before (status/output per
      // step), plus a bit of new context (attempts, provider, reflection).
      let html = '';
      nodeResults.forEach((nr, idx) => {
        const step = this.pipelineSteps[idx];
        const personaLabel = step?.personaId ? ' (' + (this.personas.find(p => p.id === step.personaId)?.name || '') + ')' : '';
        const meta: string[] = [];
        if (nr.attempts > 1) meta.push(`${nr.attempts} attempts`);
        if (nr.providerUsed) meta.push(this.escapeHtml(nr.providerUsed));
        if (nr.reflection && !nr.reflection.acceptable) meta.push('reflection: needs review');
        const metaLabel = meta.length ? ` <span style="color:var(--ink-faint); font-weight:400;">(${meta.join(', ')})</span>` : '';

        let body: string;
        let readAloudText: string | null = null;
        if (nr.status === 'skipped') {
          body = `<div class="result-text" style="color:var(--ink-faint);">Skipped — ${this.escapeHtml(nr.error || 'no input available.')}</div>`;
        } else if (nr.status === 'failed') {
          const div = document.createElement('div');
          div.textContent = nr.error || 'unknown error';
          body = `<div class="result-text" style="color:var(--rust);">Failed: ${div.innerHTML}</div>`;
        } else if (typeof nr.output === 'string' && nr.output.startsWith('blob:')) {
          body = nr.modeType === 'image'
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
          <p class="field-label" style="margin-bottom:6px;">Step ${idx + 1} — ${nr.modeType}${personaLabel}${metaLabel}</p>
          ${body}
          ${readAloudText ? this.renderReadAloudBlock(stripMarkdownForSpeech(readAloudText), `Read Step ${idx + 1} Aloud`) : ''}
        </div>`;
      });
      html += this.renderExecutionSummary(summary);
      if (stage) stage.innerHTML = html;
      this.wireReadAloudControls();
      this.wireCodeCopyButtons(stage);
    } catch (err: any) {
      this.renderError(err);
    }
  }

  /** Requirement 8 (Execution Summary): a compact report shown after every
   *  run — plan size, completed/skipped/failed counts, timing, which
   *  providers actually served the steps, and the final result. Collapsed
   *  by default (details/summary) so it doesn't compete with the actual
   *  step output above it, matching this app's existing "report lives
   *  below the result, closed unless it needs attention" convention (see
   *  Mode.ts's #logDetails). */
  private renderExecutionSummary(summary: AgentRunSummary): string {
    const seconds = (summary.durationMs / 1000).toFixed(1);
    const providerList = summary.providersUsed.length ? summary.providersUsed.map(p => this.escapeHtml(p)).join(', ') : 'n/a';
    return `
      <details class="adv" style="margin-top:4px;">
        <summary>Execution summary — ${summary.completedSteps}/${summary.planSteps} steps completed in ${seconds}s</summary>
        <div class="adv-body">
          <p class="hint" style="margin:0 0 4px;"><b>Goal:</b> ${this.escapeHtml(summary.goal || '(none)')}</p>
          <p class="hint" style="margin:0 0 4px;"><b>Plan:</b> ${summary.planSteps} step(s) — ${summary.completedSteps} completed, ${summary.skippedSteps} skipped, ${summary.failedSteps} failed</p>
          <p class="hint" style="margin:0 0 4px;"><b>Duration:</b> ${seconds}s</p>
          <p class="hint" style="margin:0;"><b>Provider(s) used:</b> ${providerList}</p>
        </div>
      </details>`;
  }

  deactivate(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
  getTitle(): string { return 'Pipeline Results'; }
}
