import { Component } from './Component';

export interface ModalOptions {
  title: string;
  content: HTMLElement | string;
  onClose?: () => void;
}

export class Modal extends Component {
  private options: ModalOptions;
  private backdrop: HTMLElement | null = null;
  private modalElement: HTMLElement | null = null;

  constructor(container: HTMLElement, options: ModalOptions) {
    super(container);
    this.options = options;
  }

  render(): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <button class="modal-close">×</button>
      <h3>${this.options.title}</h3>
      <div class="modal-body"></div>
    `;

    const closeBtn = modal.querySelector('.modal-close') as HTMLElement;
    closeBtn.addEventListener('click', () => this.close());

    const body = modal.querySelector('.modal-body') as HTMLElement;
    if (typeof this.options.content === 'string') {
      body.innerHTML = this.options.content;
    } else {
      body.appendChild(this.options.content);
    }

    backdrop.appendChild(modal);
    this.backdrop = backdrop;
    this.modalElement = modal;
    return backdrop;
  }

  open(): void {
    if (this.backdrop) {
      this.backdrop.classList.add('open');
    }
  }

  close(): void {
    if (this.backdrop) {
      this.backdrop.classList.remove('open');
    }
    if (this.options.onClose) this.options.onClose();
  }
}
