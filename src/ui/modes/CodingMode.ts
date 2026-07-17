import { Mode } from './Mode';

const LANGUAGES = [
  'JavaScript', 'TypeScript', 'HTML/CSS/JS (Web)', 'Python', 'Java', 'C', 'C++',
  'C#', 'Go', 'Rust', 'PHP', 'Swift', 'Kotlin', 'SQL', 'Bash',
];

export class CodingMode extends Mode {
  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">What do you want to build?</label>
        <textarea id="promptInput" rows="6" placeholder="e.g. A function that validates an email address, with unit tests."></textarea>
      </div>
      <div class="field">
        <label class="field-label">Language</label>
        <select id="codingLanguage">
          ${LANGUAGES.map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>
      <p class="hint">Runs through the same text-provider fallback chain as Text &amp; Voice — any capable model can write code, so no separate setup is needed beyond your usual text provider key.</p>
      <button class="run-btn" id="runBtn">▸ Generate Code</button>
    `);
    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleRun()));
  }

  private async handleRun(): Promise<void> {
    const request = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!request) { alert('Describe what you want to build.'); return; }
    const language = (document.getElementById('codingLanguage') as HTMLSelectElement)?.value || 'JavaScript';

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) this.renderLoading('Writing code…');

    const workflow = {
      id: 'coding-' + Date.now(),
      name: 'Coding',
      graph: {
        nodes: [{
          id: 'code1',
          type: 'coding' as const,
          label: 'Code Generator',
          config: { language },
          inputs: { prompt: request },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { prompt: request }, (msg, level) => this.appendLog(msg, level));
      const output = result.finalOutput || 'No output';
      if (stage) {
        stage.innerHTML = `<div class="result-text">${this.renderMarkdown(output)}</div>`;
        this.wireCodeCopyButtons(stage);
      }
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'coding', prompt: `[${language}] ${request}`, result: output, resultType: 'text',
      });
    } catch (err: any) {
      this.renderError(err);
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Code Output'; }
}
