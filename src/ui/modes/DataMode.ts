import { Mode } from './Mode';

declare const Chart: any;

export class DataMode extends Mode {
  private parsedData: any = null;
  private uploadedFile: File | null = null;

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Upload spreadsheet / CSV</label>
        <div class="dropzone" id="dataDropzone">
          <div class="dz-icon">⊞</div>
          <div class="dz-text">Click or drag a .csv, .xlsx, or .xls file</div>
          <div class="dz-sub">Parsed entirely in your browser</div>
        </div>
        <input type="file" id="dataFileInput" accept=".csv,.xlsx,.xls" style="display:none;">
        <div id="dataFileChip"></div>
      </div>
      <div class="field">
        <label class="field-label">Ask about your data <span style="text-transform:none;color:var(--ink-faint);">optional</span></label>
        <textarea id="promptInput" rows="4" placeholder="e.g. What's the trend in column B over time?"></textarea>
      </div>
      <div class="field">
        <label class="field-label">Auto-chart column <span style="text-transform:none;color:var(--ink-faint);">optional — pick a numeric column</span></label>
        <select id="chartColumn"><option value="">Auto-detect first numeric column</option></select>
      </div>
      <p class="hint">Parsing runs locally via SheetJS.</p>
      <button class="run-btn" id="runBtn">▸ Analyze Data</button>
    `);

    this.wireDropzone();
    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleGenerate()));
  }

  private wireDropzone(): void {
    const zone = document.getElementById('dataDropzone') as HTMLElement;
    const input = document.getElementById('dataFileInput') as HTMLInputElement;
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) this.handleFile(input.files[0]);
    });
    // drag/drop
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag');
      if (e.dataTransfer?.files[0]) this.handleFile(e.dataTransfer.files[0]);
    });
  }

  private async handleFile(file: File): Promise<void> {
    try {
      // Use legacy parseSpreadsheetFile
      const { parseSpreadsheetFile } = await import('../../workflows/legacy/data');
      this.parsedData = await parseSpreadsheetFile(file);
      this.uploadedFile = file;
      // Show file chip
      const chipContainer = document.getElementById('dataFileChip') as HTMLElement;
      chipContainer.innerHTML = `<div class="file-chip"><span>${file.name}</span><button title="Remove">×</button></div>`;
      chipContainer.querySelector('button')?.addEventListener('click', () => {
        this.parsedData = null;
        this.uploadedFile = null;
        chipContainer.innerHTML = '';
      });
      // Populate column select
      const sel = document.getElementById('chartColumn') as HTMLSelectElement;
      sel.innerHTML = '<option value="">Auto-detect first numeric column</option>';
      this.parsedData.headers.forEach((h: string, idx: number) => {
        const opt = document.createElement('option');
        opt.value = idx.toString();
        opt.textContent = h || `Column ${idx+1}`;
        sel.appendChild(opt);
      });
      // Show preview in output
      this.renderDataPreview(this.parsedData);
    } catch (err: any) {
      alert('Failed to parse file: ' + err.message);
    }
  }

  private renderDataPreview(parsed: any): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (!stage) return;
    const previewRows = parsed.rows.slice(0, 12);
    let html = `<div class="hint" style="margin-bottom:10px;">Loaded <b style="color:var(--ink-dim);">${parsed.rows.length} rows × ${parsed.headers.length} columns</b> from sheet "${parsed.sheetName}".</div>`;
    html += `<div class="table-scroll"><table class="data-preview"><thead><tr>` + parsed.headers.map((h: string) => `<th>${h}</th>`).join('') + `</tr></thead><tbody>`;
    previewRows.forEach((row: any[]) => {
      html += '<tr>' + parsed.headers.map((_: any, i: number) => `<td>${row[i] ?? ''}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table></div>';
    stage.innerHTML = html;
  }

  private async handleGenerate(): Promise<void> {
    if (!this.parsedData) { alert('Upload a spreadsheet first.'); return; }
    const prompt = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    const colSelect = document.getElementById('chartColumn') as HTMLSelectElement;
    const colIdx = colSelect.value !== '' ? parseInt(colSelect.value, 10) : this.findFirstNumericColumn();

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = '<div class="spinner"></div><div class="empty-text">Analyzing data...</div>';

    try {
      // Compute stats and chart data (using legacy functions)
      const { computeColumnStats } = await import('../../workflows/legacy/data');
      let stats = null, chartData = null;
      if (colIdx >= 0) {
        stats = computeColumnStats(this.parsedData, colIdx);
        const values = this.parsedData.rows.map((r: any[]) => parseFloat(r[colIdx])).filter((v: number) => !isNaN(v));
        const labels = values.map((_: any, i: number) => String(i+1));
        chartData = { colName: this.parsedData.headers[colIdx] || `Column ${colIdx+1}`, values, labels };
      }
      let aiText = null;
      let aiError: string | null = null;
      if (prompt) {
        // Use workflow to get AI answer
        const workflow = {
          id: 'data-' + Date.now(),
          name: 'Data Analysis',
          graph: {
            nodes: [{
              id: 'data1',
              type: 'data' as const,
              label: 'Data Analyzer',
              config: { prompt },
              inputs: { file: this.parsedData },
              enabled: true,
            }],
            edges: [],
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        // RUNTIME AUDIT FIX (same class as DocNodeExecutor's extraction/summary
        // split): `stats` and `chartData` above are computed locally and have
        // nothing to do with the AI provider chain — but this call was
        // previously un-caught inside the outer try/catch, so when every text
        // provider failed (no keys configured, all fallbacks down), the whole
        // handleGenerate() aborted to the generic error screen and the stats/
        // chart the user actually asked to see were thrown away along with the
        // failed AI request. Catching just this step means an unavailable AI
        // analyzer degrades to "show the stats and chart, note that the
        // question couldn't be answered" instead of hiding a real result.
        try {
          const result = await this.kernel.getWorkflowEngine().execute(workflow, { file: this.parsedData, prompt }, (msg, level) => this.appendLog(msg, level));
          aiText = result.finalOutput;
          this.kernel.getStore().getActions().addHistoryEntry({
            mode: 'data', prompt, result: aiText, resultType: 'text',
          });
        } catch (err: any) {
          aiError = err?.message || String(err);
          this.appendLog(`Stats/chart are ready, but answering your question failed: ${aiError}`, 'warn');
        }
      }
      // Render result with stats, chart, AI text
      this.renderDataResult(stats, chartData, aiText, aiError);
    } catch (err: any) {
      this.renderError(err);
    }
  }

  private findFirstNumericColumn(): number {
    const headers = this.parsedData.headers;
    for (let i = 0; i < headers.length; i++) {
      const sample = this.parsedData.rows.slice(0, 20).map((r: any[]) => parseFloat(r[i])).filter((v: number) => !isNaN(v));
      if (sample.length > this.parsedData.rows.slice(0, 20).length * 0.5) return i;
    }
    return -1;
  }

  private renderDataResult(stats: any, chartData: any, aiText: string | null, aiError?: string | null): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (!stage) return;
    let html = '';
    if (stats) {
      html += `<div class="stat-cards" style="margin-bottom:16px;">
        <div class="stat-card"><div class="label">Rows</div><div class="value">${stats.count}</div></div>
        <div class="stat-card"><div class="label">Average</div><div class="value">${stats.avg.toFixed(2)}</div></div>
        <div class="stat-card"><div class="label">Max</div><div class="value">${stats.max}</div></div>
        <div class="stat-card"><div class="label">Min</div><div class="value">${stats.min}</div></div>
      </div>`;
    }
    if (aiText) {
      html += `<div class="doc-summary-block" style="margin-bottom:16px;"><div class="result-text">${aiText}</div></div>`;
    } else if (aiError) {
      html += `<div class="doc-summary-block" style="margin-bottom:16px; border-left: 3px solid var(--warn, #d97706); padding-left:12px;"><p class="field-label" style="color:var(--warn, #d97706);">Answer unavailable</p><div class="result-text" style="opacity:0.85;">${aiError}. Stats${chartData ? ' and chart' : ''} below are still available.</div></div>`;
    }
    if (chartData) {
      html += `<div class="chart-wrap"><canvas id="dataChart" height="160"></canvas></div>`;
    }
    stage.innerHTML = html;
    if (chartData && typeof Chart !== 'undefined') {
      const ctx = (document.getElementById('dataChart') as HTMLCanvasElement | null)?.getContext('2d');
      if (ctx) {
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: chartData.labels,
            datasets: [{ label: chartData.colName, data: chartData.values, borderColor: '#e8a23d', backgroundColor: 'rgba(232,162,61,0.15)', tension: 0.25, fill: true }]
          },
          options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#9aa49c' } } },
            scales: {
              x: { ticks: { color: '#5b645e' }, grid: { color: '#292e2b' } },
              y: { ticks: { color: '#5b645e' }, grid: { color: '#292e2b' } }
            }
          }
        });
      }
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Data Analytics'; }
}
