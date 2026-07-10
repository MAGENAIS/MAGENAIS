/**
 * Base class for all UI components.
 * Provides lifecycle hooks and a consistent API for rendering.
 */
export abstract class Component {
  protected container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Render the component – must be implemented by subclasses.
   * Returns the root element of the component.
   */
  abstract render(): HTMLElement;

  /**
   * Called after the component is mounted to the DOM.
   * Override for additional setup (event listeners, etc.).
   */
  mounted(): void {}

  /**
   * Called before the component is destroyed.
   * Override for cleanup.
   */
  destroy(): void {}
}
