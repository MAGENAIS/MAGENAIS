import { Component } from './Component';

export interface DropzoneOptions {
  accept?: string;
  onFile: (file: File) => void;
  label?: string;
  subLabel?: string;
}

export class Dropzone extends Component {
  private options: DropzoneOptions;

  constructor(container: HTMLElement, options: DropzoneOptions) {
    super(container);
    this.options = options;
  }

  render(): HTMLElement {
    const zone = document.createElement('div');
    zone.className = 'dropzone';
    zone.innerHTML = `
      <div class="dz-icon">⊞</div>
      <div class="dz-text">${this.options.label || 'Click or drag a file'}</div>
      <div class="dz-sub">${this.options.subLabel || ''}</div>
    `;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.options.accept || '';
    input.style.display = 'none';
    zone.appendChild(input);

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) {
        this.options.onFile(input.files[0]);
        input.value = ''; // allow re-selecting same file
      }
    });

    // Drag & drop
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag');
      if (e.dataTransfer?.files[0]) {
        this.options.onFile(e.dataTransfer.files[0]);
      }
    });

    return zone;
  }
}
