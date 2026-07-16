import { Mode } from './Mode';
import { stripMarkdownForSpeech } from '../../core/textUtils';

export class DocMode extends Mode {
  private uploadedFile: File | null = null;

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Upload document</label>
        <div class="dropzone" id="docDropzone">
          <div class="dz-icon">⎘</div>
          <div class="dz-text">Click or drag a PDF, Word doc, or image</div>
          <div class="dz-sub">Parsed entirely in your browser — never uploaded anywhere</div>
        </div>
        <input type="file" id="docFileInput" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp" style="display:none;">
        <div id="docFileChip"></div>
      </div>
      <div class="field">
        <label class="field-label">What do you want?</label>
        <div class="chip-group" id="docActionChips">
          <span class="chip active" data-val="summary">Summary</span>
          <span class="chip" data-val="qa">Answer a question</span>
        </div>
      </div>
      <div class="field" id="docQuestionField" style="display:none;">
        <label class="field-label">Your question</label>
        <textarea id="promptInput" rows="3" placeholder="e.g. What does section 3 say about liability?"></textarea>
      </div>
      <p class="hint">PDF text via PDF.js, Word via Mammoth.js, images via Tesseract.js OCR — all client-side. Extracted text is then processed through the text AI pipeline.</p>
      <button class="run-btn" id="runBtn">▸ Process Document</button>
    `);

    this.wireDropzone();
    document.querySelectorAll('#docActionChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#docActionChips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const isQa = (chip as HTMLElement).dataset.val === 'qa';
        const field = document.getElementById('docQuestionField') as HTMLElement;
        if (field) field.style.display = isQa ? '' : 'none';
      });
    });
    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleRun()));
  }

  private wireDropzone(): void {
    const zone = document.getElementById('docDropzone') as HTMLElement;
    const input = document.getElementById('docFileInput') as HTMLInputElement;
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) this.setFile(input.files[0]);
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag');
      if (e.dataTransfer?.files[0]) this.setFile(e.dataTransfer.files[0]);
    });
  }

  private setFile(file: File): void {
    this.uploadedFile = file;
    const chipContainer = document.getElementById('docFileChip') as HTMLElement;
    chipContainer.innerHTML = `<div class="file-chip"><span>${file.name}</span><button title="Remove">×</button></div>`;
    chipContainer.querySelector('button')?.addEventListener('click', () => {
      this.uploadedFile = null;
      chipContainer.innerHTML = '';
    });
  }

  private async handleRun(): Promise<void> {
    if (!this.uploadedFile) { alert('Upload a document first.'); return; }
    const action = (document.querySelector('#docActionChips .chip.active') as HTMLElement)?.dataset.val || 'summary';
    const question = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (action === 'qa' && !question) { alert('Enter your question.'); return; }

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Extracting text…</div>';

    const workflow = {
      id: 'doc-' + Date.now(),
      name: 'Document Processing',
      graph: {
        nodes: [{
          id: 'doc1',
          type: 'doc' as const,
          label: 'Document Processor',
          config: { action: action === 'qa' ? 'summary' : action, question: action === 'qa' ? question : undefined },
          inputs: { file: this.uploadedFile },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { file: this.uploadedFile }, (msg, level) => this.appendLog(msg, level));
      const payload = result.finalOutput;
      this.renderResult(payload, action === 'qa' ? question : undefined);
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'doc',
        prompt: action === 'qa' ? question : `[${this.uploadedFile.name}] summary`,
        result: typeof payload === 'string' ? payload : payload?.summary,
        resultType: 'text',
      });
    } catch (err: any) {
      this.renderError(err);
    }
  }

  private renderResult(payload: any, question?: string): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (!stage) return;
    const extracted = typeof payload === 'string' ? payload : payload?.extractedText;
    const summary = typeof payload === 'string' ? null : payload?.summary;
    const summaryError = typeof payload === 'string' ? null : payload?.summaryError;
    let html = '';
    if (question) {
      html += `<p class="field-label">Question</p><div class="doc-summary-block" style="margin-bottom:14px;"><div class="result-text">${this.escapeHtml(question)}</div></div>`;
    }
    if (summary) {
      html += `<p class="field-label">${question ? 'Answer' : 'Summary'}</p><div class="doc-summary-block" style="margin-bottom:18px;"><div class="result-text">${this.renderMarkdown(summary)}</div>${this.renderReadAloudBlock(stripMarkdownForSpeech(summary), question ? 'Read Answer Aloud' : 'Read Summary Aloud')}</div>`;
    } else if (summaryError) {
      // RUNTIME AUDIT FIX (Phase 3 #6): text extraction can succeed even
      // when AI summarization/QA fails (no provider configured, every
      // fallback provider down, etc.) — Node.ts's DocNodeExecutor now
      // returns the extracted text plus this error note instead of
      // throwing and losing the extracted text entirely. Show it as a
      // clear, dismissable notice rather than silently having no
      // summary section and no explanation why.
      html += `<div class="doc-summary-block" style="margin-bottom:18px; border-left: 3px solid var(--warn, #d97706); padding-left:12px;"><p class="field-label" style="color:var(--warn, #d97706);">${question ? 'Answer' : 'Summary'} unavailable</p><div class="result-text" style="opacity:0.85;">Text extraction succeeded, but AI processing failed: ${summaryError}. The extracted text below is still available.</div></div>`;
    }
    if (extracted) {
      html += `<details class="adv"><summary>Extracted text (${extracted.length.toLocaleString()} characters)</summary><div class="adv-body"><div class="result-text" style="white-space:pre-wrap; max-height:340px; overflow:auto;">${this.escapeHtml(extracted.slice(0, 20000))}</div></div></details>`;
    }
    stage.innerHTML = html || '<div class="empty-text">No text could be extracted.</div>';
    this.wireReadAloudControls();
    this.wireCodeCopyButtons(stage);
  }

  deactivate(): void {
    // Stop any in-progress read-aloud playback when leaving the tab.
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }
  getTitle(): string { return 'Documents'; }
}
