import { Kernel } from '../../core/Kernel';

/**
 * Base class for all modes (text, image, video, etc.)
 * Each mode controls its own panel and output rendering.
 */
export abstract class Mode {
  protected controlPanel: HTMLElement;
  protected outputPanel: HTMLElement;
  protected kernel: Kernel;

  // Re-entrancy guard shared by every mode's Generate/Run button. Without
  // this, a slow in-flight request could be joined by a second click,
  // racing two workflow executions against the same output panel and
  // leaving the UI in whatever state the *last-resolving* promise left it
  // in. Combined with never restoring the button's disabled/label state,
  // this is what made "Generate" look like it only works once.
  private isBusy: boolean = false;

  constructor(controlPanel: HTMLElement, outputPanel: HTMLElement, kernel: Kernel) {
    this.controlPanel = controlPanel;
    this.outputPanel = outputPanel;
    this.kernel = kernel;
  }

  /**
   * Wrap a Generate/Run click handler with a busy/disabled guard.
   * - Ignores re-entrant clicks while a previous run is still in flight.
   * - Disables + relabels the triggering button while running.
   * - ALWAYS restores button state in `finally`, even if `task` throws.
   * Each mode keeps its own try/catch inside `task` for result-specific
   * error rendering; this wrapper is a safety net that guarantees the
   * busy/disabled state can never get stuck, regardless of what `task` does.
   */
  protected async runGuarded(buttonId: string, task: () => Promise<void>): Promise<void> {
    if (this.isBusy) return;
    this.isBusy = true;
    this.clearLog();
    const btn = document.getElementById(buttonId) as HTMLButtonElement | null;
    const originalLabel = btn?.textContent ?? '';
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.textContent = 'Working…';
    }
    try {
      await task();
    } catch (err: any) {
      // Safety net only — modes should catch/report their own errors.
      this.renderError(err);
    } finally {
      this.isBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('is-busy');
        btn.textContent = originalLabel;
      }
    }
  }

  /**
   * Shared error rendering, used by runGuarded's safety net and available
   * to subclasses for consistent error display.
   *
   * ROOT CAUSE of "error/status text shows above the generated content":
   * every mode used to write its error straight into `.stage` — the same
   * element that holds the actual result — which put the error message at
   * the very top of the panel, ahead of (or in place of) any content.
   * `#logPanel` (declared once in App.ts's shell markup, after `.stage`)
   * exists precisely to hold this kind of pipeline status/error text below
   * the generated content instead. Only reset `.stage` to a neutral state
   * here when it doesn't already hold a real result — a failure partway
   * through a multi-part pipeline (e.g. podcast script generated but TTS
   * failed) should keep showing what DID succeed, with the error appended
   * below it, not blow away work that already rendered.
   */
  protected renderError(err: any): void {
    const message = err?.message || String(err);
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement | null;
    if (stage && !stage.querySelector('.result-text, .result-media, .doc-summary-block')) {
      stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text stage-error">Generation failed — see details below.</div>`;
    }
    this.appendLog(message, 'error');
  }

  /**
   * Appends a status/error line to the log panel below the stage. Modes use
   * this for pipeline success/failure/warning text so it always lands after
   * the generated content rather than before it.
   *
   * ROOT CAUSE (user-reported: "pipeline messages are over/under the
   * content, mixed in with it, and block clicking Read Aloud"): once every
   * per-provider attempt (see ProviderManager) and every intermediate step
   * (e.g. "Extracting page N of 35…") started reaching this panel live,
   * a single run could produce 50-100+ lines — often taller than the
   * actual result. Even though `#logPanel` was already positioned after
   * `.stage` in the DOM/flow (never literally overlapping it), a wall of
   * monospaced status text that long, sitting directly under a result with
   * no strong visual boundary, reads as part of the same block rather than
   * a separate report — especially right after a `<pre><code>` block using
   * similar styling. Two changes fix this without touching layout
   * architecture: (1) the whole thing now lives inside a <details> box
   * with its own header/border (see .log-details in components.css),
   * closed by default so it takes ~0 space unless the person opens it —
   * only auto-opening on a warning/error, when they actually need to see
   * why; (2) immediately-repeated identical lines (e.g. the same provider
   * failing twice across two retry passes) collapse into one line with a
   * "×N" counter instead of duplicating the whole wall of text.
   */
  protected appendLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const log = this.outputPanel.querySelector('#logPanel') as HTMLElement | null;
    if (!log) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const lastLine = log.lastElementChild as HTMLElement | null;
    if (lastLine && lastLine.dataset.rawMessage === message && lastLine.dataset.level === level) {
      // Same line repeated back-to-back (e.g. a full second fallback-chain
      // pass on retry) — bump a counter instead of appending a duplicate.
      const count = parseInt(lastLine.dataset.count || '1', 10) + 1;
      lastLine.dataset.count = String(count);
      const countBadge = lastLine.querySelector('.count') as HTMLElement | null;
      if (countBadge) {
        countBadge.textContent = ` (×${count})`;
      } else {
        const badge = document.createElement('span');
        badge.className = 'count';
        badge.textContent = ` (×${count})`;
        lastLine.querySelector('.msg')?.appendChild(badge);
      }
      const t = lastLine.querySelector('.t');
      if (t) t.textContent = time;
    } else {
      const line = document.createElement('div');
      line.className = `log-line ${level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'ok'}`;
      line.dataset.rawMessage = message;
      line.dataset.level = level;
      line.dataset.count = '1';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = time;
      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.textContent = (level === 'error' ? '⚠ Error: ' : level === 'warn' ? '⚠ ' : '') + message;
      line.appendChild(t);
      line.appendChild(msg);
      log.appendChild(line);
    }

    const total = log.children.length;
    const details = this.outputPanel.querySelector('#logDetails') as HTMLDetailsElement | null;
    const summary = this.outputPanel.querySelector('#logSummary') as HTMLElement | null;
    if (summary) {
      summary.textContent = `Pipeline report (${total} event${total === 1 ? '' : 's'})`;
    }
    // Only pop the box open on its own for something the person actually
    // needs to act on — a smooth run should stay collapsed even though
    // it's still logging every step underneath.
    if (details && (level === 'error' || level === 'warn')) {
      details.open = true;
    }
  }

  /** Clears the log panel — call at the start of a new generation. */
  protected clearLog(): void {
    const log = this.outputPanel.querySelector('#logPanel') as HTMLElement | null;
    if (log) log.innerHTML = '';
    const details = this.outputPanel.querySelector('#logDetails') as HTMLDetailsElement | null;
    if (details) details.open = false;
    const summary = this.outputPanel.querySelector('#logSummary') as HTMLElement | null;
    if (summary) summary.textContent = 'Pipeline report';
  }

  /**
   * Called when the mode becomes active.
   * Should render its control panel and prepare the output area.
   */
  abstract activate(): void;

  /**
   * Called when the mode is deactivated (switched away).
   * Cleanup any active listeners, timers, etc.
   */
  abstract deactivate(): void;

  /**
   * Return the display title for this mode.
   */
  abstract getTitle(): string;

  /**
   * Helper to render the control panel.
   */
  protected renderControl(html: string): void {
    this.controlPanel.innerHTML = html;
  }

  /**
   * Helper to render output.
   */
  protected renderOutput(html: string): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement;
    if (stage) stage.innerHTML = html;
  }

  /**
   * Shared markup for playing back generated audio (speech/music/podcast).
   * Deliberately does NOT autoplay and exposes explicit Play/Pause/Stop
   * buttons rather than relying on the browser's native <audio controls>
   * (which only offers play/pause, no true stop-and-rewind). Callers that
   * display accompanying text (e.g. a podcast script) should put this block
   * AFTER that text in the DOM, so the text is visible before playback ever
   * starts rather than autoplay talking over an unread page.
   */
  protected renderAudioBlock(url: string, opts: { filename?: string; downloadLabel?: string } = {}): string {
    const id = 'player-' + Math.random().toString(36).slice(2, 9);
    const filename = opts.filename || 'magen-audio';
    const downloadLabel = opts.downloadLabel || 'Download Audio';
    return `
      <div class="result-media">
        <audio id="${id}" src="${url}" preload="metadata"></audio>
        <div class="audio-controls">
          <button type="button" class="ghost-btn" data-audio-action="play" data-target="${id}">▶ Play</button>
          <button type="button" class="ghost-btn" data-audio-action="pause" data-target="${id}">⏸ Pause</button>
          <button type="button" class="ghost-btn" data-audio-action="stop" data-target="${id}">⏹ Stop</button>
        </div>
        <div class="result-actions">
          <a href="${url}" download="${filename}"><button type="button" class="ghost-btn">${downloadLabel}</button></a>
        </div>
      </div>`;
  }

  /**
   * Wires up every `[data-audio-action]` button under `root` (defaults to
   * the whole output panel) to its `data-target` <audio> element's
   * play/pause/stop. Call this once after inserting HTML built with
   * `renderAudioBlock`.
   */
  protected wireAudioControls(root: HTMLElement = this.outputPanel): void {
    root.querySelectorAll('[data-audio-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = (btn as HTMLElement).dataset.target;
        const audio = targetId ? document.getElementById(targetId) as HTMLAudioElement | null : null;
        if (!audio) return;
        const action = (btn as HTMLElement).dataset.audioAction;
        if (action === 'play') audio.play();
        else if (action === 'pause') audio.pause();
        else if (action === 'stop') { audio.pause(); audio.currentTime = 0; }
      });
    });
  }

  /**
   * Counterpart to renderAudioBlock for when the only available playback is
   * the browser's built-in voice (BrowserSpeechAdapter — no downloadable
   * file, sentinel '__BROWSER_TTS_PENDING__'). Speaks `text` on demand via
   * Play/Pause/Stop, matching the real-provider player's controls, and never
   * speaks automatically — callers should render this AFTER the
   * corresponding text is already visible.
   */
  protected renderBrowserSpeechBlock(text: string): string {
    const id = 'bspeech-' + Math.random().toString(36).slice(2, 9);
    // Data attribute rather than a closure, since this HTML is inserted via
    // innerHTML — wireBrowserSpeechControls reads it back out at click time.
    return `
      <div class="result-media" data-browser-speech="${id}" data-speech-text="${encodeURIComponent(text)}">
        <div class="hint">🔊 No downloadable audio file — plays live via your browser's built-in voice.</div>
        <div class="audio-controls">
          <button type="button" class="ghost-btn" data-bspeech-action="play" data-target="${id}">▶ Play</button>
          <button type="button" class="ghost-btn" data-bspeech-action="pause" data-target="${id}">⏸ Pause</button>
          <button type="button" class="ghost-btn" data-bspeech-action="stop" data-target="${id}">⏹ Stop</button>
        </div>
      </div>`;
  }

  /** Wires up buttons rendered by renderBrowserSpeechBlock. */
  protected wireBrowserSpeechControls(root: HTMLElement = this.outputPanel): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    root.querySelectorAll('[data-bspeech-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.bspeechAction;
        const container = btn.closest('[data-speech-text]') as HTMLElement | null;
        if (action === 'play') {
          if (window.speechSynthesis.paused) { window.speechSynthesis.resume(); return; }
          window.speechSynthesis.cancel(); // stop anything already speaking first
          const text = container ? decodeURIComponent(container.dataset.speechText || '') : '';
          if (!text) return;
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        } else if (action === 'pause') {
          window.speechSynthesis.pause();
        } else if (action === 'stop') {
          window.speechSynthesis.cancel();
        }
      });
    });
  }

  /**
   * Shared "Read Aloud" control — renders a Play / Pause / Stop button row
   * that reads arbitrary generated TEXT back to the user via the browser's
   * free, built-in speechSynthesis voice. Unlike renderBrowserSpeechBlock
   * (which is the fallback *player* for the Speech/TTS pipeline's audio
   * output), this makes no provider call and needs no TTS pipeline at all —
   * it's a pure accessibility/convenience affordance for reading back
   * whatever text a mode already generated, and is what's wired into the
   * Text, Documents, Research, Agents, and Vision tabs.
   *
   * `label` lets callers give the button row context when a single page has
   * more than one read-aloud block (e.g. AgentsMode, one per pipeline step).
   */
  protected renderReadAloudBlock(text: string, label = 'Read Aloud'): string {
    if (!text || !text.trim()) return '';
    const id = 'readaloud-' + Math.random().toString(36).slice(2, 9);
    return `
      <div class="result-media read-aloud-block" data-readaloud="${id}" data-readaloud-text="${encodeURIComponent(text)}">
        <div class="audio-controls">
          <button type="button" class="ghost-btn" data-readaloud-action="play" data-target="${id}" title="Read this text aloud">▶ ${this.escapeHtml(label)}</button>
          <button type="button" class="ghost-btn" data-readaloud-action="pause" data-target="${id}" title="Pause">⏸ Pause</button>
          <button type="button" class="ghost-btn" data-readaloud-action="stop" data-target="${id}" title="Stop">⏹ Stop</button>
        </div>
      </div>`;
  }

  /**
   * Wires up buttons rendered by renderReadAloudBlock. Safe to call
   * multiple times / with multiple blocks in the same root — each block
   * carries its own text via its data attribute, and Play on any block
   * stops whatever the browser voice was previously reading (a browser tab
   * can only speak one utterance at a time, matching how a real audio
   * player would behave too).
   */
  protected wireReadAloudControls(root: HTMLElement = this.outputPanel): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    root.querySelectorAll('[data-readaloud-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.readaloudAction;
        const container = btn.closest('[data-readaloud-text]') as HTMLElement | null;
        if (action === 'play') {
          if (window.speechSynthesis.paused) { window.speechSynthesis.resume(); return; }
          window.speechSynthesis.cancel(); // only one utterance can play at a time
          const text = container ? decodeURIComponent(container.dataset.readaloudText || '') : '';
          if (!text) return;
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        } else if (action === 'pause') {
          window.speechSynthesis.pause();
        } else if (action === 'stop') {
          window.speechSynthesis.cancel();
        }
      });
    });
  }

  /**
   * RUNTIME AUDIT FIX (Phase 6 — shared Output component): every mode
   * inserted its AI-generated text straight into `.result-text` via a raw
   * template literal (`` `<div class="result-text">${output}</div>` ``) with
   * NO markdown formatting and NO HTML-escaping at all. Two real problems
   * followed from that, and both are fixed here once, for every tab, rather
   * than per-mode:
   *   1. Every model in this app is instructed/expected to answer in
   *      Markdown (headers, **bold**, lists, ```code``` fences) — with no
   *      renderer, users saw the literal '#', '**', and back-tick
   *      characters instead of formatted text, inconsistent with
   *      CodingMode, which already had its own local, code-fence-only
   *      version of this (`renderMarkdownCode`, now removed — this
   *      supersedes it with fuller Markdown support, still shared).
   *   2. Raw, unescaped interpolation means literal HTML/script-like text
   *      the model happens to output (e.g. explaining a `<script>` tag, or
   *      echoing a snippet of a user's own HTML back) was parsed as real
   *      markup by the browser instead of displayed as text — broken
   *      layout at best, and not a pattern worth leaving in place even
   *      though model output isn't a classic untrusted-attacker input.
   * Everything is escaped FIRST; formatting (bold/italic/headers/lists/
   * links/code) is then layered on top of the already-escaped text, so a
   * literal `<div>` in the model's answer always renders as visible text,
   * never as markup.
   */
  protected renderMarkdown(raw: string): string {
    if (!raw) return '';
    // Pull out fenced code blocks first (and escape their contents) so
    // markdown syntax inside code — e.g. a literal '**' in a code sample —
    // is never mistaken for formatting by the passes below.
    const codeBlocks: string[] = [];
    let working = raw.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`
        <div class="code-block" style="position:relative; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-raised); border:1px solid var(--line-bright); border-bottom:none; border-radius:var(--radius) var(--radius) 0 0; padding:6px 10px;">
            <span class="provider-meta">${this.escapeHtml(lang || 'code')}</span>
            <button class="ghost-btn small copy-code-btn" type="button">Copy</button>
          </div>
          <pre style="margin:0; background:var(--bg); border:1px solid var(--line-bright); border-radius:0 0 var(--radius) var(--radius); padding:12px; overflow-x:auto;"><code>${this.escapeHtml(code.trim())}</code></pre>
        </div>`);
      return `\u0000CODEBLOCK${idx}\u0000`;
    });

    // Escape everything else — from this point on `working` is safe HTML
    // text, and every regex below only ever adds tags, never removes the
    // escaping the browser needs to treat the model's own text as text.
    working = this.escapeHtml(working);

    // Inline code: `like this`
    working = working.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Bold and italic (bold first, so **_x_** doesn't get eaten by italic).
    working = working.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    working = working.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    // Headers (# through ######), one per line.
    working = working.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, text: string) => {
      const level = Math.min(hashes.length, 6);
      return `<h${level} style="margin:14px 0 8px;">${text}</h${level}>`;
    });
    // Links: [text](url) — escaped text/url already came through escapeHtml
    // above, so this only adds the anchor tag around already-safe content.
    working = working.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Single-pass, line-based block builder for headers/lists/code-blocks/
    // paragraphs. (An earlier version of this ran lists and paragraph-
    // wrapping as two separate passes; any list, header, or code block that
    // wasn't already isolated by a blank line — e.g. "Intro:\n- item one" —
    // ended up nested INSIDE a <p>, with stray <br> tags forced between
    // list items. Building every block type in one left-to-right pass over
    // the lines avoids that: any block-level line — an <h#>, a restored
    // code-block placeholder, or a list item — immediately flushes and
    // closes whatever paragraph/list was open, instead of being pulled
    // into it.)
    const lines = working.split('\n');
    const out: string[] = [];
    let listType: 'ul' | 'ol' | null = null;
    let paraBuf: string[] = [];
    const flushPara = () => {
      if (paraBuf.length) {
        out.push(`<p style="margin:0 0 10px;">${paraBuf.join('<br>')}</p>`);
        paraBuf = [];
      }
    };
    const closeList = () => {
      if (listType) { out.push(`</${listType}>`); listType = null; }
    };
    for (const line of lines) {
      if (!line.trim()) { flushPara(); closeList(); continue; }
      const isHeader = /^<h[1-6][^>]*>.*<\/h[1-6]>$/.test(line);
      const isCodeBlockPlaceholder = /^\u0000CODEBLOCK\d+\u0000$/.test(line.trim());
      const ulMatch = line.match(/^[-*]\s+(.+)$/);
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (isHeader || isCodeBlockPlaceholder) {
        flushPara();
        closeList();
        out.push(line);
      } else if (ulMatch || olMatch) {
        flushPara();
        const type = ulMatch ? 'ul' : 'ol';
        if (listType !== type) {
          closeList();
          out.push(`<${type} style="margin:8px 0; padding-left:22px;">`);
          listType = type;
        }
        out.push(`<li>${(ulMatch || olMatch)![1]}</li>`);
      } else {
        closeList();
        paraBuf.push(line);
      }
    }
    flushPara();
    closeList();
    working = out.join('\n');

    // Splice the escaped, styled code blocks back in.
    working = working.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, i: string) => codeBlocks[Number(i)]);
    return working || `<p>${this.escapeHtml(raw)}</p>`;
  }

  /**
   * Wires the "Copy" button on every code block produced by
   * renderMarkdown(). Safe to call multiple times / with multiple blocks.
   */
  protected wireCodeCopyButtons(root: HTMLElement = this.outputPanel): void {
    root.querySelectorAll('.copy-code-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.closest('.code-block')?.querySelector('code')?.textContent || '';
        navigator.clipboard.writeText(code);
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original || 'Copy'; }, 1500);
      });
    });
  }

  /** Small local helper so renderReadAloudBlock/renderMarkdown don't inject unescaped text into innerHTML. */
  protected escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
}
