import { Kernel } from '../../core/Kernel';

/**
 * Base class for all modes (text, image, video, etc.)
 * Each mode controls its own panel and output rendering.
 */
export abstract class Mode {
  protected controlPanel: HTMLElement;
  protected outputPanel: HTMLElement;
  protected kernel: Kernel;

  constructor(controlPanel: HTMLElement, outputPanel: HTMLElement, kernel: Kernel) {
    this.controlPanel = controlPanel;
    this.outputPanel = outputPanel;
    this.kernel = kernel;
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
