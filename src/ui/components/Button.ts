import { Component } from './Component';

export type ButtonVariant = 'ghost' | 'primary' | 'danger';

export class Button extends Component {
  private label: string;
  private variant: ButtonVariant;
  private onClick?: () => void;
  private disabled: boolean;

  constructor(
    container: HTMLElement,
    label: string,
    variant: ButtonVariant = 'ghost',
    disabled: boolean = false,
    onClick?: () => void
  ) {
    super(container);
    this.label = label;
    this.variant = variant;
    this.disabled = disabled;
    this.onClick = onClick;
  }

  render(): HTMLElement {
    const btn = document.createElement('button');
    btn.className = `btn btn-${this.variant}`;
    btn.textContent = this.label;
    btn.disabled = this.disabled;
    if (this.onClick) {
      btn.addEventListener('click', this.onClick);
    }
    return btn;
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    const btn = this.container.querySelector('button');
    if (btn) btn.disabled = disabled;
  }

  setLabel(label: string): void {
    this.label = label;
    const btn = this.container.querySelector('button');
    if (btn) btn.textContent = label;
  }
}
