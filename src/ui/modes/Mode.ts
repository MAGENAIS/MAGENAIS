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
   * Shared error rendering for the output stage, used by runGuarded's
   * safety net and available to subclasses for consistent error display.
   */
  protected renderError(err: any): void {
    const stage = this.outputPanel.querySelector('.stage') as HTMLElement | null;
    if (stage) {
      const message = err?.message || String(err);
      stage.innerHTML = `<div class="empty-glyph" style="color:var(--rust);">!</div><div class="empty-text">Error: ${message}</div>`;
    }
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
}
