import { Mode } from './Mode';

export class HelpMode extends Mode {
  activate(): void {
    this.renderControl(`
      <div class="result-text" style="line-height:1.75; font-size:13.5px;">
        <p style="margin-bottom:14px;">Thank you for visiting MAGENAIS — Mehdi Alireza GENAI Studio.</p>
        <p style="margin-bottom:14px;">MAGENAIS is an experimental AI platform that integrates multiple generative models and intelligent services into a single environment. Depending on the available modules and ongoing development, you may find tools for generating text, images, videos, speech, music, research content, interactive applications, and AI agents.</p>
        <p class="field-label" style="margin-bottom:8px;">Getting Started</p>
        <ul style="margin:0 0 14px 18px; padding:0; display:flex; flex-direction:column; gap:6px;">
          <li>Browse the available sections using the navigation menu.</li>
          <li>Select a module or service to begin exploring its capabilities.</li>
          <li>Some features may require external AI services or APIs.</li>
          <li>As the platform is actively evolving, new tools and improvements are added regularly.</li>
        </ul>
        <p class="field-label" style="margin-bottom:8px;">Development Status</p>
        <p style="margin-bottom:14px;">MAGENAIS is currently under active development. Some features may be experimental, unavailable, or subject to change while new capabilities are being integrated and tested. Your feedback and suggestions are always appreciated.</p>
        <p class="field-label" style="margin-bottom:8px;">Our Vision</p>
        <p style="margin-bottom:14px;">MAGENAIS is inspired by the concept of "The Birth of Wisdom." Our goal is to create an open and extensible ecosystem where generative intelligence supports learning, creativity, scientific discovery, and human innovation through responsible AI technologies.</p>
        <p class="field-label" style="margin-bottom:8px;">Contact &amp; Feedback</p>
        <p style="margin-bottom:8px;">If you have questions, suggestions, collaboration opportunities, or encounter technical issues, please contact us at:</p>
        <p class="hint" style="margin-bottom:8px;"><a href="mailto:Magenais.wisdom@gmail.com">Magenais.wisdom@gmail.com</a></p>
        <p class="hint">Your feedback helps shape the future of MAGENAIS.</p>
      </div>
    `);
    // Also set output area to static help content
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) {
      stage.innerHTML = `
        <div class="empty-glyph">✦</div>
        <div class="empty-text">Read the Help notes on the left for an overview of MAGENAIS, its current development status, and how to get in touch. This tab is informational only — there's nothing to generate here.</div>
      `;
    }
  }

  deactivate(): void {}
  getTitle(): string { return 'Help'; }
}
