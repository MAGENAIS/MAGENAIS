/**
 * MAGENAIS UI Application Shell
 * Main entry point for the user interface.
 * Manages modes, themes, event listeners, and global UI state.
 */

import { ThemeEngine } from './Theme';
import { SettingsModal } from './SettingsModal';
import { HistoryModal } from './HistoryModal';
import { WorkflowModal } from './WorkflowModal';
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
import { CodingMode } from './modes/CodingMode';
import { VisionMode } from './modes/VisionMode';

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
  private settingsModal: SettingsModal;
  private historyModal: HistoryModal;
  private workflowModal: WorkflowModal;

  constructor(kernel: Kernel) {
    this.kernel = kernel;
    this.eventBus = kernel.getEventBus();
    this.store = kernel.getStore();
    this.theme = new ThemeEngine();
    this.settingsModal = new SettingsModal(kernel);
    this.historyModal = new HistoryModal(kernel, (entry) => {
      const btn = this.navContainer.querySelector(`.mode-btn[data-mode="${entry.mode === 'speech' || entry.mode === 'music' || entry.mode === 'podcast' ? 'audio' : entry.mode}"]`) as HTMLElement;
      btn?.click();
      setTimeout(() => {
        const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement | null;
        if (promptInput && entry.prompt) promptInput.value = entry.prompt;
      }, 0);
    });
    this.workflowModal = new WorkflowModal(kernel);

    // Find or create the app shell
    const existingApp = document.getElementById('app');
    this.appContainer = existingApp || document.createElement('div');
    this.appContainer.id = 'app';
    // Always (re)populate the shell markup — `index.html` ships an empty
    // <div id="app"></div> as a mount point, so relying on an "else, only if
    // missing" branch here left the shell (topbar/nav/main/footer) never
    // actually created, and every element lookup below would silently find
    // nothing.
    this.appContainer.innerHTML = this.getAppShellMarkup();
    if (!existingApp) {
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

  private getAppShellMarkup(): string {
    return `
      <header class="topbar">
        <div class="topbar-banner" aria-hidden="true"></div>
        <div class="brand">
          <img class="brand-logo" src="/branding/logo.png" alt="" aria-hidden="true">
          <div class="brand-text">
            <div class="mark">MAGENAI<span>S</span></div>
            <div class="tag">GENAI OPERATING SYSTEM · Birth of Wisdom</div>
          </div>
        </div>
        <div class="topbar-right">
          <button class="ghost-btn" id="introBtn" title="About MAGENAIS, mission, and contact">Introduction</button>
          <button class="ghost-btn" id="historyBtn" title="Browse and reload past generations">History</button>
          <button class="ghost-btn" id="settingsBtn" title="Add API keys and manage providers">Keys &amp; Providers</button>
          <button class="ghost-btn" id="themeBtn" title="Switch between dark and light theme">Theme</button>
          <button class="ghost-btn" id="workflowBtn" title="Chain multiple generation steps into one pipeline">Workflow</button>
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
    this.modeMap.set('coding', new CodingMode(this.controlPanel, this.outputPanel, this.kernel));
    this.modeMap.set('vision', new VisionMode(this.controlPanel, this.outputPanel, this.kernel));
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
      { id: 'coding', label: 'Coding', num: 10 },
      { id: 'vision', label: 'Vision', num: 11 },
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
    let modal = document.getElementById('introModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-backdrop';
      modal.id = 'introModal';
      modal.innerHTML = `
        <div class="modal" style="max-width:640px;">
          <button class="modal-close" id="closeIntro">×</button>
          <h3>Introduction</h3>
          <div class="result-text" style="line-height:1.75;">
            <p style="margin-bottom:14px;">Welcome to MAGENAIS — the GENAI Operating System.</p>
            <p style="margin-bottom:14px;">MAGENAIS is an evolving platform for Generative Artificial Intelligence, designed to bring together multiple AI models, services, and APIs into a unified ecosystem for intelligent content creation and research. The platform explores the capabilities of modern AI across text, images, video, audio, speech, music, interactive experiences, autonomous agents, and scientific research.</p>
            <p style="margin-bottom:14px;">The name MAGENAIS reflects a dual identity. Technically, it represents Mehdi Alireza GENAI Studio, the foundation of the platform. Philosophically, it symbolizes "the Birth of Wisdom" — the belief that intelligence is more than computation; it emerges through knowledge, creativity, interaction, and continuous learning.</p>
            <p style="margin-bottom:14px;">MAGENAIS is both a research initiative and a creative laboratory. Its mission is to investigate how diverse AI systems can collaborate to solve problems, generate ideas, assist discovery, and expand human creativity. Rather than treating individual models as isolated tools, MAGENAIS integrates them into a modular environment where different forms of intelligence can work together.</p>
            <p style="margin-bottom:14px;">The platform is under continuous development. New features, models, and capabilities are regularly added as AI technologies evolve. Visitors are invited to explore, experiment, and follow the ongoing journey toward more capable, responsible, and meaningful artificial intelligence.</p>
            <p class="field-label" style="margin-bottom:8px;">Getting Started</p>
            <ul style="margin:0 0 14px 18px; padding:0; display:flex; flex-direction:column; gap:6px;">
              <li>Browse the available sections using the navigation menu.</li>
              <li>Add at least one provider API key under <b>Keys &amp; Providers</b> — most features need one.</li>
              <li>Select a module and start exploring; each tab has its own quick hint at the bottom of the panel.</li>
              <li>As the platform is actively evolving, new tools and improvements are added regularly.</li>
            </ul>
            <p class="field-label" style="margin-bottom:8px;">Development Status</p>
            <p style="margin-bottom:14px;">MAGENAIS is currently under active development. Some features may be experimental, unavailable, or subject to change while new capabilities are being integrated and tested. Your feedback and suggestions are always appreciated.</p>
            <p class="hint">Contact: <a href="mailto:Magenais.wisdom@gmail.com">Magenais.wisdom@gmail.com</a></p>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const m = modal;
      m.querySelector('#closeIntro')?.addEventListener('click', () => m.classList.remove('open'));
      m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
    }
    modal.classList.add('open');
  }

  private showHistory(): void {
    this.historyModal.open();
  }

  private showSettings(): void {
    this.settingsModal.open();
  }

  private showWorkflowEditor(): void {
    this.workflowModal.open();
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
