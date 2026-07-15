import { Mode } from './Mode';

export class GameMode extends Mode {
  private lastGameCode: string | null = null;

  activate(): void {
    this.renderControl(`
      <div class="field">
        <label class="field-label">Game concept</label>
        <textarea id="promptInput" rows="5" placeholder="e.g. A top-down strategy game where you place towers to defend a base from waves of enemies."></textarea>
      </div>
      <div class="field">
        <label class="field-label">Engine</label>
        <div class="chip-group" id="gameEngineChips">
          <span class="chip active" data-val="2d">2D (HTML5 Canvas)</span>
          <span class="chip" data-val="3d">3D (Three.js / WebGL)</span>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Genre hint <span style="text-transform:none;color:var(--ink-faint);">optional</span></label>
        <div class="chip-group" id="gameGenreChips">
          <span class="chip active" data-val="">Let the AI decide</span>
          <span class="chip" data-val="strategy / tower defense">Strategy</span>
          <span class="chip" data-val="platformer">Platformer</span>
          <span class="chip" data-val="top-down exploration">Exploration</span>
          <span class="chip" data-val="puzzle">Puzzle</span>
          <span class="chip" data-val="arcade shooter">Arcade shooter</span>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Complexity</label>
        <div class="chip-group" id="gameComplexityChips">
          <span class="chip" data-val="minimal">Minimal</span>
          <span class="chip active" data-val="standard">Standard</span>
          <span class="chip" data-val="rich">Rich</span>
        </div>
      </div>
      <p class="hint">Generated in two AI passes — HTML/CSS scaffolding, then game-loop JavaScript — matching how the legacy build produced complete, working single-file games.</p>
      <button class="run-btn" id="runBtn">▸ Generate Game</button>
    `);

    ['gameEngineChips', 'gameGenreChips', 'gameComplexityChips'].forEach(groupId => {
      document.querySelectorAll(`#${groupId} .chip`).forEach(chip => {
        chip.addEventListener('click', () => {
          document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        });
      });
    });

    document.getElementById('runBtn')?.addEventListener('click', () => this.runGuarded('runBtn', () => this.handleRun(false)));
  }

  private async handleRun(iterate: boolean): Promise<void> {
    const concept = (document.getElementById('promptInput') as HTMLTextAreaElement)?.value.trim();
    if (!concept) { alert('Describe the game you want.'); return; }
    if (iterate && !this.lastGameCode) { alert('Generate a game first before iterating.'); return; }

    const engine = (document.querySelector('#gameEngineChips .chip.active') as HTMLElement)?.dataset.val || '2d';
    const genre = (document.querySelector('#gameGenreChips .chip.active') as HTMLElement)?.dataset.val || '';
    const complexity = (document.querySelector('#gameComplexityChips .chip.active') as HTMLElement)?.dataset.val || 'standard';

    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = `<div class="spinner"></div><div class="empty-text">${iterate ? 'Applying your change…' : 'Stage 1/2 — building scaffolding…'}</div>`;

    const workflow = {
      id: 'game-' + Date.now(),
      name: 'Game Generation',
      graph: {
        nodes: [{
          id: 'game1',
          type: 'gamegen' as const,
          label: 'Game Generator',
          config: { engine, genre, complexity, iterate, previousCode: this.lastGameCode || undefined },
          inputs: { concept },
          enabled: true,
        }],
        edges: [],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const result = await this.kernel.getWorkflowEngine().execute(workflow, { concept }, (msg, level) => this.appendLog(msg, level));
      const html: string = result.finalOutput;
      this.lastGameCode = html;
      this.renderGame(html);
      this.kernel.getStore().getActions().addHistoryEntry({
        mode: 'game', prompt: concept, result: html, resultType: 'other',
      });
    } catch (err: any) {
      this.renderError(err);
    }
  }

  private renderGame(html: string): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (!stage) return;
    // ROOT CAUSE of "garbage"/mojibake text in generated games (e.g. emoji
    // sprites rendering as "Ã°Å¸Â¡..."): this Blob had no charset, so the
    // browser had no reliable way to know the HTML's emoji/unicode bytes
    // were UTF-8 and could fall back to a different encoding, corrupting
    // every non-ASCII character (exactly the mojibake pattern of UTF-8
    // bytes misread as Latin-1). Declaring the charset here is the fix
    // that actually matters (the <meta charset> tag the generation prompt
    // now also requires is useful defense-in-depth, but the HTTP-level
    // Blob MIME type takes precedence for how the browser decodes it).
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    stage.innerHTML = `
      <div class="result-media" style="margin-bottom:14px;">
        <iframe src="${url}" style="width:100%; height:520px; border:1px solid var(--line); border-radius:8px; background:#000;" sandbox="allow-scripts allow-pointer-lock"></iframe>
        <div class="result-actions" style="margin-top:10px; display:flex; gap:8px;">
          <a href="${url}" download="magenais-game.html"><button class="ghost-btn">Download Game (.html)</button></a>

          <button class="ghost-btn" id="iterateBtn">Iterate on this game</button>
        </div>
      </div>
    `;
    document.getElementById('iterateBtn')?.addEventListener('click', () => {
      const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
      const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
      if (promptInput) {
        promptInput.value = '';
        promptInput.placeholder = 'Describe the change you want (e.g. "make the player faster")';
        promptInput.focus();
      }
      if (runBtn) {
        runBtn.textContent = '▸ Apply Change';
        runBtn.onclick = () => this.runGuarded('runBtn', () => this.handleRun(true));
      }
    });
  }

  deactivate(): void {}
  getTitle(): string { return 'Game Generator'; }
}
