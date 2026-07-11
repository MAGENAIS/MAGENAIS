/**
 * Initial Workflow implementation: a linear step-chain builder. Not a full
 * drag-and-drop graph canvas (that's future work) — but a genuinely
 * functional way to pipe one step's output into the next, e.g.
 * Research -> Text (summarize) -> Speech (narrate), matching the same
 * examples/workflows/summarize-and-narrate.json pattern already shipped.
 */
import { Kernel } from '../core/Kernel';
import { NodeType } from '../workflows/types';

interface StepTypeDef {
  type: NodeType;
  label: string;
  inputKey: string; // the node's primary input field name
  configFields?: Array<{ key: string; label: string; placeholder?: string }>;
}

const STEP_TYPES: StepTypeDef[] = [
  { type: 'text', label: 'Text', inputKey: 'prompt' },
  { type: 'image', label: 'Image', inputKey: 'prompt' },
  { type: 'video', label: 'Video', inputKey: 'prompt' },
  { type: 'speech', label: 'Speech (TTS)', inputKey: 'text', configFields: [{ key: 'voice', label: 'Voice', placeholder: 'alloy' }] },
  { type: 'music', label: 'Music', inputKey: 'prompt' },
  { type: 'coding', label: 'Coding', inputKey: 'prompt', configFields: [{ key: 'language', label: 'Language', placeholder: 'JavaScript' }] },
  { type: 'research', label: 'Research', inputKey: 'query' },
  { type: 'gamegen', label: 'Game', inputKey: 'concept' },
];

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

interface StepUI {
  id: string;
  type: NodeType;
  config: Record<string, string>;
}

export class WorkflowModal {
  private kernel: Kernel;
  private steps: StepUI[] = [];

  constructor(kernel: Kernel) {
    this.kernel = kernel;
  }

  open(): void {
    this.ensureDom();
    if (this.steps.length === 0) {
      this.addStep('text');
    }
    this.renderSteps();
    document.getElementById('workflowModal')?.classList.add('open');
  }

  private close(): void {
    document.getElementById('workflowModal')?.classList.remove('open');
  }

  private ensureDom(): void {
    if (document.getElementById('workflowModal')) return;
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.id = 'workflowModal';
    el.innerHTML = `
      <div class="modal" style="max-width:640px;">
        <button class="modal-close" id="closeWorkflow">×</button>
        <h3>Workflow</h3>
        <p class="hint">Chain steps together — each step's output feeds directly into the next one's input. Example: Research → Text (summarize the findings) → Speech (narrate the summary).</p>
        <div class="field">
          <label class="field-label">Starting input</label>
          <textarea id="wfSeedInput" rows="2" placeholder="e.g. Recent advances in quantum error correction"></textarea>
        </div>
        <div id="wfStepsList" style="display:flex; flex-direction:column; gap:10px; margin:12px 0;"></div>
        <button class="ghost-btn" id="wfAddStepBtn" style="width:100%;">+ Add step</button>
        <div class="divider"></div>
        <button class="run-btn" id="wfRunBtn">▸ Run Workflow</button>
        <div id="wfOutput" style="margin-top:14px; display:flex; flex-direction:column; gap:10px;"></div>
      </div>
    `;
    document.body.appendChild(el);
    el.querySelector('#closeWorkflow')?.addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    el.querySelector('#wfAddStepBtn')?.addEventListener('click', () => {
      this.addStep('text');
      this.renderSteps();
    });
    el.querySelector('#wfRunBtn')?.addEventListener('click', () => this.runWorkflow());
  }

  private addStep(type: NodeType): void {
    this.steps.push({ id: 'step' + Date.now() + Math.random().toString(36).slice(2, 5), type, config: {} });
  }

  private renderSteps(): void {
    const list = document.getElementById('wfStepsList');
    if (!list) return;
    list.innerHTML = '';
    this.steps.forEach((step, i) => {
      const def = STEP_TYPES.find(t => t.type === step.type)!;
      const row = document.createElement('div');
      row.className = 'provider-row';
      row.innerHTML = `
        <div class="provider-row-top">
          <span class="provider-name">Step ${i + 1}${i === 0 ? ' <span class="provider-meta">(uses Starting input)</span>' : ' <span class="provider-meta">(uses previous step\'s output)</span>'}</span>
          ${this.steps.length > 1 ? '<button class="ghost-btn small" data-action="remove">Remove</button>' : ''}
        </div>
        <select data-action="type">
          ${STEP_TYPES.map(t => `<option value="${t.type}" ${t.type === step.type ? 'selected' : ''}>${t.label}</option>`).join('')}
        </select>
        <div class="step-config-fields"></div>
      `;
      const configContainer = row.querySelector('.step-config-fields') as HTMLElement;
      const renderConfigFields = () => {
        configContainer.innerHTML = (def.configFields || []).map(f => `
          <input type="text" data-config-key="${f.key}" placeholder="${f.label}${f.placeholder ? ' (e.g. ' + f.placeholder + ')' : ''}" value="${escapeHtml(step.config[f.key] || '')}" style="margin-top:6px;">
        `).join('');
        configContainer.querySelectorAll('[data-config-key]').forEach((input) => {
          input.addEventListener('change', () => {
            const key = (input as HTMLElement).dataset.configKey!;
            step.config[key] = (input as HTMLInputElement).value;
          });
        });
      };
      renderConfigFields();

      row.querySelector('[data-action="type"]')?.addEventListener('change', (e) => {
        step.type = (e.target as HTMLSelectElement).value as NodeType;
        step.config = {};
        this.renderSteps();
      });
      row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
        this.steps = this.steps.filter(s => s.id !== step.id);
        this.renderSteps();
      });

      list.appendChild(row);
    });
  }

  private async runWorkflow(): Promise<void> {
    const seed = (document.getElementById('wfSeedInput') as HTMLTextAreaElement)?.value.trim();
    if (!seed) { alert('Enter a starting input.'); return; }
    const output = document.getElementById('wfOutput');
    if (output) output.innerHTML = '<div class="spinner"></div><div class="empty-text">Running workflow…</div>';

    const nodes = this.steps.map((step, i) => {
      const def = STEP_TYPES.find(t => t.type === step.type)!;
      const inputValue = i === 0 ? seed : `\${${this.steps[i - 1].id}}`;
      return {
        id: step.id,
        type: step.type,
        label: def.label,
        config: step.config,
        inputs: { [def.inputKey]: inputValue },
        enabled: true,
      };
    });
    const edges = this.steps.slice(1).map((step, i) => ({ from: this.steps[i].id, to: step.id }));

    const workflow = {
      id: 'wf-' + Date.now(),
      name: 'Custom Workflow',
      graph: { nodes, edges },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { prompt: seed });
      if (output) {
        output.innerHTML = result.nodeResults.map((nr: any, i: number) => {
          const def = STEP_TYPES.find(t => t.type === this.steps[i]?.type);
          const val = nr.output;
          let rendered: string;
          if (nr.status === 'failed') {
            rendered = `<span style="color:var(--rust);">Failed: ${escapeHtml(nr.error || 'unknown error')}</span>`;
          } else if (typeof val === 'string' && val.startsWith('blob:')) {
            rendered = def?.type === 'image'
              ? `<img src="${val}" style="max-height:160px; border-radius:var(--radius);">`
              : `<audio src="${val}" controls></audio>`;
          } else if (val && typeof val === 'object' && val.url) {
            rendered = `<video src="${val.url}" controls style="max-height:200px;"></video>`;
          } else {
            rendered = `<div class="result-text">${escapeHtml(String(val ?? '')).slice(0, 2000)}</div>`;
          }
          return `<div><p class="field-label">Step ${i + 1} — ${def?.label || nr.nodeId}</p>${rendered}</div>`;
        }).join('');
      }
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'workflow', prompt: seed, result: result.finalOutput, resultType: 'other',
      });
    } catch (err: any) {
      if (output) output.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${err.message}</div>`;
    }
  }
}
