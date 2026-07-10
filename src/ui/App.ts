/**
 * MAGENAIS UI Application Shell
 * Main entry point for the user interface.
 * Manages modes, themes, event listeners, and global UI state.
 */

import { ThemeEngine } from './Theme';
import { EventBus } from '../core/EventBus';
import { Store } from '../core/state/Store';
import { Kernel } from '../core/Kernel';
import { Logger } from '../core/Logger';

// Import all mode implementations
import { Mode } from './modes/Mode';
import { TextMode } from './modes/TextMode';
import { ImageMode } from './modes/ImageMode';
import { VideoMode } from './modes/VideoMode';
import { AudioMode } from './modes/AudioMode';
import { DataMode } from './modes/DataMode';
import { DocMode } from './modes/DocMode';
import { ResearchMode } from './modes/ResearchMode';
import { GameMode } from './modes/GameMode';
import { AgentsMode } from './modes/AgentsMode';
import { HelpMode } from './modes/HelpMode';

export class App {
  private kernel: Kernel;
  private theme: ThemeEngine;
  private eventBus: EventBus;
  private store: Store;
  private currentModeId: string = 'text';
  private modeMap: Map<string, Mode> = new Map();

  // DOM references
  private appContainer: HTMLElement;
  private controlPanel: HTMLElement;
  private outputPanel: HTMLElement;
  private outputTitle: HTMLElement;
  private statusLeft: HTMLElement;
  private statusRight: HTMLElement;
  private pipelineTrace: HTMLElement;
  private logPanel: HTMLElement;
  private stage: HTMLElement;
  private navContainer: HTMLElement;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    this.eventBus = kernel.getEventBus();
    this.store = kernel.getStore();
    this.theme = new ThemeEngine();

    // Find or create the app shell
    const existingApp = document.getElementById("app");

if (existingApp) {
    existingApp.innerHTML = "";
    this.appContainer = existingApp;
    this.appContainer.innerHTML = this.createAppShell().innerHTML;
} else {
    this.appContainer = this.createAppShell();
    document.body.prepend(this.appContainer);
}

    // Get essential DOM elements
    this.controlPanel = document.getElementById('controlPanel') as HTMLElement;
    this.outputPanel = document.querySelector('.output') as HTMLElement;
    this.outputTitle = document.getElementById('outputTitle') as HTMLElement;
    this.statusLeft = document.getElementById('footerLeft') as HTMLElement;
    this.statusRight = document.getElementById('footerRight') as HTMLElement;
    this.pipelineTrace = document.getElementById('pipelineTrace') as HTMLElement;
    this.logPanel = document.getElementById('logPanel') as HTMLElement;
    this.stage = document.getElementById('stage') as HTMLElement;
    this.navContainer = document.getElementById('modeNav') || document.querySelector('nav.modes') as HTMLElement;

    // Register all modes
    this.registerModes();

    // Set up global event listeners
    this.setupGlobalListeners();

    // Set initial theme (dark)
    this.theme.setTheme('dark');

    // Update status bar
    this.updateStatus('Ready', 'MAGENAIS v2.1');
  }

  private createAppShell(): HTMLElement {
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
          <button class="ghost-btn" id="themeBtn">🌓</button>
          <button class="ghost-btn" id="workflowBtn">📊 Workflow</button>
        </div>
      </header>
      <nav class="modes" id="modeNav"></nav>
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
    return app;
  }

  private registerModes(): void {
    this.modeMap.set('text', new TextMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('image', new ImageMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('video', new VideoMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('audio', new AudioMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('data', new DataMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('doc', new DocMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('research', new ResearchMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('game', new GameMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('agents', new AgentsMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('help', new HelpMode(this.controlPanel, this.outputPanel, this.kernel));
  }

  public init(): void {
    this.buildModeNav();
    this.setMode('text');
    this.setupGlobalListeners();
    // Listen to kernel events
    this.eventBus.on('workflow:started', () => this.updateStatus('Running...', 'Generating...'));
    this.eventBus.on('workflow:finished', () => this.updateStatus('Done', ''));
    this.eventBus.on('workflow:failed', (err) => this.updateStatus('Error: ' + err, ''));
    // Plugin events
    this.eventBus.on('plugin:registerMenu', (menu) => this.handlePluginMenu(menu));
    this.eventBus.on('plugin:registerCommand', (command) => this.handlePluginCommand(command));
    this.eventBus.on('plugin:registerPanel', (panel) => this.handlePluginPanel(panel));
    // Enterprise / AIOS events (optional)
    this.eventBus.on('project:selected', (id) => this.updateStatus(`Project: ${id}`, ''));
    this.eventBus.on('memory:set', ({ key }) => this.logStatus(`Memory updated: ${key}`));
  }

  private buildModeNav(): void {
    if (!this.navContainer) return;
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
    this.navContainer.innerHTML = '';
    modes.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.dataset.mode = m.id;
      btn.innerHTML = `<span class="num">${m.num}</span>${m.label}`;
      btn.addEventListener('click', () => this.setMode(m.id));
      this.navContainer.appendChild(btn);
    });
  }

  private setMode(modeId: string): void {
    if (this.currentModeId === modeId) return;
    const oldMode = this.modeMap.get(this.currentModeId);
    if (oldMode) oldMode.deactivate();

    const newMode = this.modeMap.get(modeId);
    if (!newMode) {
      Logger.warn(`Mode "${modeId}" not found.`);
      return;
    }
    this.currentModeId = modeId;
    newMode.activate();
    this.outputTitle.textContent = newMode.getTitle();

    this.navContainer.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === modeId);
    });

    if (modeId === 'help') {
      this.stage.innerHTML = `
        <div class="empty-glyph">✦</div>
        <div class="empty-text">Read the Help notes on the left for an overview of MAGENAIS.</div>
      `;
    }
    this.eventBus.emit('ui:modeChanged', modeId);
  }

  private setupGlobalListeners(): void {
    const introBtn = document.getElementById('introBtn');
    if (introBtn) introBtn.addEventListener('click', () => this.showIntro());

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.addEventListener('click', () => this.showHistory());

    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => this.showSettings());

    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const newTheme = this.theme.toggleTheme();
        this.updateStatus(`Theme: ${newTheme}`, '');
      });
    }

    const workflowBtn = document.getElementById('workflowBtn');
    if (workflowBtn) {
      workflowBtn.addEventListener('click', () => this.showWorkflowEditor());
    }
  }

  private updateStatus(left: string, right: string): void {
    if (this.statusLeft) this.statusLeft.textContent = left;
    if (this.statusRight) this.statusRight.textContent = right || 'MAGENAIS v2.1';
  }

  private logStatus(msg: string): void {
    // Optionally add to log panel
  }

  // ------------------------------------------------------------------
  // Plugin UI Integration
  // ------------------------------------------------------------------
  private handlePluginMenu(menu: { id: string; label: string; command: string }): void {
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      const btn = document.createElement('button');
      btn.className = 'ghost-btn';
      btn.textContent = menu.label;
      btn.addEventListener('click', () => {
        this.eventBus.emit(`command:${menu.command}`);
      });
      topbarRight.appendChild(btn);
    }
  }

  private handlePluginCommand(command: { id: string; handler: (...args: any[]) => void }): void {
    this.eventBus.on(`command:${command.id}`, command.handler);
  }

  private handlePluginPanel(panel: { id: string; render: () => HTMLElement }): void {
    const container = document.createElement('div');
    container.id = `plugin-panel-${panel.id}`;
    container.style.padding = '10px';
    container.style.borderTop = '1px solid var(--line)';
    container.appendChild(panel.render());
    this.outputPanel.appendChild(container);
  }

  // ------------------------------------------------------------------
  // Modals (placeholders – can be replaced with Modal component)
  // ------------------------------------------------------------------
  private showIntro(): void {
    const modal = document.getElementById('introModal');
    if (modal) {
      modal.classList.add('open');
      const close = document.getElementById('closeIntro');
      if (close) {
        close.addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.classList.remove('open');
        });
      }
    } else {
      alert('Introduction: MAGENAIS — Mehdi Alireza GENAI Studio\n\n' +
        'An evolving platform for Generative Artificial Intelligence.\n' +
        'Contact: Magenais.wisdom@gmail.com');
    }
  }

  private showHistory(): void {
    const modal = document.getElementById('historyModal');
    if (modal) {
      modal.classList.add('open');
      const close = document.getElementById('closeHistory');
      if (close) {
        close.addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.classList.remove('open');
        });
      }
      // TODO: populate gallery from store
    } else {
      alert('History: Not implemented yet in modular UI.');
    }
  }

  private showSettings(): void {
    const modal = document.getElementById('settingsModal');
    if (modal) {
      modal.classList.add('open');
      const close = document.getElementById('closeSettings');
      if (close) {
        close.addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.classList.remove('open');
        });
      }
      if (typeof (window as any).renderProviderList === 'function') {
        (window as any).renderProviderList();
      }
    } else {
      alert('Settings: Provider Manager not yet available in modular UI.');
    }
  }

  private showWorkflowEditor(): void {
    // Placeholder – will open the WorkflowCanvas component in a modal or panel.
    // For now, we can use a simple alert.
    alert('Workflow Editor – will open a visual editor for workflows.');
    // In future, we can create a modal with the WorkflowCanvas.
  }

  // ------------------------------------------------------------------
  // Public methods
  // ------------------------------------------------------------------
  public getCurrentMode(): string {
    return this.currentModeId;
  }
  public getThemeEngine(): ThemeEngine {
    return this.theme;
  }
  public destroy(): void {
    this.modeMap.forEach(mode => mode.deactivate());
    this.eventBus.clear();
  }
}
