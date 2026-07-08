import { ThemeEngine } from './Theme';
import { EventBus } from '../core/EventBus';
import { Store } from '../core/state/Store';
import { Kernel } from '../core/Kernel';
import { Mode } from './modes/Mode';
import { TextMode } from './modes/TextMode';
import { ImageMode } from './modes/ImageMode';
// ... import all modes

export class App {
  private kernel: Kernel;
  private theme: ThemeEngine;
  private eventBus: EventBus;
  private store: Store;
  private currentMode: string = 'text';
  private modeMap: Map<string, Mode> = new Map();

  // DOM refs
  private appContainer: HTMLElement;
  private controlPanel: HTMLElement;
  private outputPanel: HTMLElement;
  private outputTitle: HTMLElement;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    this.eventBus = kernel.getEventBus();
    this.store = kernel.getStore();
    this.theme = new ThemeEngine();

    // Create app shell (if not already in DOM)
    this.appContainer = document.getElementById('app') || this.createAppShell();
    this.controlPanel = document.getElementById('controlPanel') as HTMLElement;
    this.outputPanel = document.querySelector('.output') as HTMLElement;
    this.outputTitle = document.getElementById('outputTitle') as HTMLElement;

    // Register modes
    this.registerModes();
  }

  private createAppShell(): HTMLElement {
    // Minimal shell; will be built if not present
    const app = document.createElement('div');
    app.id = 'app';
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="mark">MAGENAI<span>S</span></div>
          <div class="tag">Mehdi Alireza GENAI Studio · Birth of Wisdom</div>
        </div>
        <div class="topbar-right">
          <button class="ghost-btn" id="introBtn">Introduction</button>
          <button class="ghost-btn" id="historyBtn">History</button>
          <button class="ghost-btn" id="settingsBtn">Keys &amp; Providers</button>
        </div>
      </header>
      <nav class="modes" id="modeNav">
        <!-- mode buttons will be generated -->
      </nav>
      <main>
        <section class="control" id="controlPanel"></section>
        <section class="output">
          <div class="output-header">
            <h2 id="outputTitle">Output</h2>
            <div class="pipeline-trace" id="pipelineTrace"></div>
          </div>
          <div class="stage" id="stage">
            <div class="empty-glyph">◇</div>
            <div class="empty-text">Nothing generated yet. Set a prompt or upload a file on the left and run the pipeline.</div>
          </div>
          <div id="logPanel" style="display:flex; flex-direction:column; gap:4px;"></div>
        </section>
      </main>
      <footer class="statusbar">
        <span id="footerLeft">Ready</span>
        <span id="footerRight">MAGENAIS v2.1</span>
      </footer>
    `;
    document.body.prepend(app);
    return app;
  }

  private registerModes(): void {
    // Instantiate each mode and store in map
    this.modeMap.set('text', new TextMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('image', new ImageMode(this.controlPanel, this.outputPanel, this.kernel));
    // ... register all modes
  }

  /**
   * Initialize the UI: set up event listeners, render initial mode, etc.
   */
  init(): void {
    this.buildModeNav();
    this.setMode('text');
    this.setupGlobalListeners();
  }

  private buildModeNav(): void {
    const nav = document.getElementById('modeNav') || document.querySelector('nav.modes');
    if (!nav) return;
    const modes = [
      { id: 'text', label: 'Text & Voice', num: 1 },
      { id: 'image', label: 'Image', num: 2 },
      { id: 'video', label: 'Video', num: 3 },
      { id: 'audio', label: 'Audio & Music', num: 4 },
      { id: 'data', label: 'Data Analytics', num: 5 },
      { id: 'doc', label: 'Documents', num: 6 },
      { id: 'research', label: 'Research', num: 7 },
      { id: 'game', label: 'Game', num: 8 },
      { id: 'agents', label: 'Agents', num: 9 },
      { id: 'help', label: 'Help', num: 10 },
    ];
    nav.innerHTML = '';
    modes.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.dataset.mode = m.id;
      btn.innerHTML = `<span class="num">${m.num}</span>${m.label}`;
      btn.addEventListener('click', () => this.setMode(m.id));
      nav.appendChild(btn);
    });
  }

  private setMode(modeId: string): void {
    this.currentMode = modeId;
    // Update nav active state
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === modeId);
    });

    // Deactivate all modes, then activate the selected one
    this.modeMap.forEach((mode, id) => {
      if (id === modeId) {
        mode.activate();
        this.outputTitle.textContent = mode.getTitle();
      } else {
        mode.deactivate();
      }
    });

    // Emit event
    this.eventBus.emit('ui:modeChanged', modeId);
  }

  private setupGlobalListeners(): void {
    // History, Settings, Introduction buttons
    const introBtn = document.getElementById('introBtn');
    if (introBtn) introBtn.addEventListener('click', () => this.showIntro());

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.addEventListener('click', () => this.showHistory());

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => this.showSettings());

    // Theme toggle (optional) – we can add a button in topbar
    // For now, we'll use a keyboard shortcut or hidden toggle.
  }

  private showIntro(): void {
    // Use Modal component to show intro content
    // We'll implement a simple modal from components.
  }

  private showHistory(): void {
    // Show history modal
  }

  private showSettings(): void {
    // Show provider manager modal
  }
}
