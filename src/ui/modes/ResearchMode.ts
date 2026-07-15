import { Mode } from './Mode';
import { stripMarkdownForSpeech } from '../../core/textUtils';

const SOURCES = [
  { key: 'semanticscholar', label: 'Semantic Scholar' },
  { key: 'openalex', label: 'OpenAlex' },
  { key: 'arxiv', label: 'arXiv' },
];

export class ResearchMode extends Mode {
  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Research question</label>
        <textarea id="promptInput" rows="4" placeholder="e.g. What's the current evidence on CRISPR-based gene therapy for sickle cell disease?"></textarea>
      </div>
      <div class="field">
        <label class="field-label">Sources to query <span style="text-transform:none;color:var(--ink-faint);">each runs independently, in parallel</span></label>
        <div class="chip-group" id="researchSourceChips">
          ${SOURCES.map(s => `<span class="chip active" data-val="${s.key}">${s.label}</span>`).join('')}
        </div>
      </div>
      <div class="field">
        <label class="field-label">Papers per source</label>
        <div class="slider-row">
          <input type="range" id="researchCount" min="3" max="15" step="1" value="6">
          <span class="slider-val" id="researchCountVal">6</span>
        </div>
      </div>
      <p class="hint">Each enabled source acts as an independent agent gathering real papers from free public APIs; results are merged, de-duplicated, and ranked by citation count before a synthesis pass writes the final answer.</p>
      <button class="run-btn" id="runBtn">▸ Run Research</button>
    `);

    document.querySelectorAll('#researchSourceChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const active = document.querySelectorAll('#researchSourceChips .chip.active').length;
        if (chip.classList.contains('active') && active <= 1) return; // keep at least one enabled
        chip.classList.toggle('active');
      });
    });
    const countInput = document.getElementById('researchCount') as HTMLInputElement;
    countInput?.addEventListener('input', () => {
      const val = document.getElementById('researchCountVal');
      if (val) val.textContent = countInput.value;
    });

    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleRun()));
  }

  private async handleRun(): Promise<void> {
    const query = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!query) { alert('Enter a research question.'); return; }
    const enabledSources = Array.from(document.querySelectorAll('#researchSourceChips .chip.active'))
      .map(c => (c as HTMLElement).dataset.val)
      .filter(Boolean) as string[];
    const limitPerSource = parseInt((document.getElementById('researchCount') as HTMLInputElement)?.value || '6', 10);

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Gathering sources…</div>';

    const workflow = {
      id: 'research-' + Date.now(),
      name: 'Research',
      graph: {
        nodes: [{
          id: 'research1',
          type: 'research' as const,
          label: 'Research Agent',
          config: { sources: enabledSources, limitPerSource },
          inputs: { query },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { query });
      this.renderResult(result.finalOutput);
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'research', prompt: query, result: result.finalOutput?.summary, resultType: 'text',
      });
    } catch (err: any) {
      this.renderError(err);
    }
  }

  private renderResult(payload: any): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (!stage) return;
    const { papers, sourceStatus, summary } = payload || {};
    let html = '';
    if (sourceStatus) {
      html += `<div class="chip-group" style="margin-bottom:12px;">${sourceStatus.map((s: any) =>
        `<span class="chip ${s.status === 'ok' ? 'active' : ''}" style="${s.status === 'fail' ? 'opacity:.5;' : ''}">${s.name} ${s.status === 'ok' ? '✓' : '✕'}</span>`
      ).join('')}</div>`;
    }
    if (summary) {
      html += `<div class="doc-summary-block" style="margin-bottom:18px;"><div class="result-text">${summary}</div>${this.renderReadAloudBlock(stripMarkdownForSpeech(summary), 'Read Summary Aloud')}</div>`;
    }
    if (papers?.length) {
      html += `<p class="field-label">Sources (${papers.length})</p>`;
      html += papers.slice(0, 20).map((p: any) => `
        <div class="paper-card" style="border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:8px;">
          <div style="font-weight:600;">${p.title || 'Untitled'}</div>
          <div style="color:var(--ink-faint); font-size:.85em;">${p.authors || 'Unknown authors'} · ${p.year || 'n.d.'} · ${p.source}${p.citations != null ? ' · ' + p.citations + ' citations' : ''}</div>
          ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener">View source →</a>` : ''}
        </div>
      `).join('');
    }
    stage.innerHTML = html || '<div class="empty-text">No results.</div>';
    this.wireReadAloudControls();
  }

  deactivate(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
  getTitle(): string { return 'Research'; }
}
