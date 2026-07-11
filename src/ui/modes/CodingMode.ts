import { Mode } from './Mode';

const LANGUAGES = [
  'JavaScript', 'TypeScript', 'HTML/CSS/JS (Web)', 'Python', 'Java', 'C', 'C++',
  'C#', 'Go', 'Rust', 'PHP', 'Swift', 'Kotlin', 'SQL', 'Bash',
];

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}

/** Turns fenced ```lang ... ``` blocks into styled, copyable <pre><code> blocks; everything else stays as plain text. */
function renderMarkdownCode(raw: string): string {
  const parts = raw.split(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g);
  let html = '';
  for (let i = 0; i < parts.length; i += 3) {
    const text = parts[i];
    if (text && text.trim()) {
      html += `<p style="margin:0 0 10px;">${escapeHtml(text.trim()).replace(/\n/g, '<br>')}</p>`;
    }
    const lang = parts[i + 1];
    const code = parts[i + 2];
    if (code !== undefined) {
      html += `
        <div class="code-block" style="position:relative; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-raised); border:1px solid var(--line-bright); border-bottom:none; border-radius:var(--radius) var(--radius) 0 0; padding:6px 10px;">
            <span class="provider-meta">${escapeHtml(lang || 'code')}</span>
            <button class="ghost-btn small copy-code-btn" type="button">Copy</button>
          </div>
          <pre style="margin:0; background:var(--bg); border:1px solid var(--line-bright); border-radius:0 0 var(--radius) var(--radius); padding:12px; overflow-x:auto;"><code>${escapeHtml(code.trim())}</code></pre>
        </div>`;
    }
  }
  return html || `<p>${escapeHtml(raw)}</p>`;
}

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
    document.getElementById('runBtn')?.addEventListener('click', () => this.handleRun());
  }

  private async handleRun(): Promise<void> {
    const request = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!request) { alert('Describe what you want to build.'); return; }
    const language = (document.getElementById('codingLanguage') as HTMLSelectElement)?.value || 'JavaScript';

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Writing code…</div>';

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
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { prompt: request });
      const output = result.finalOutput || 'No output';
      if (stage) {
        stage.innerHTML = `<div class="result-text">${renderMarkdownCode(output)}</div>`;
        stage.querySelectorAll('.copy-code-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const code = btn.closest('.code-block')?.querySelector('code')?.textContent || '';
            navigator.clipboard.writeText(code);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
        });
      }
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'coding', prompt: `[${language}] ${request}`, result: output, resultType: 'text',
      });
    } catch (err: any) {
      if (stage) stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${err.message}</div>`;
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Code Output'; }
}
