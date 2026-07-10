import { Component } from './Component';

export interface ChipOption {
  value: string;
  label: string;
  active?: boolean;
}

export class ChipGroup extends Component {
  private options: ChipOption[];
  private onChange?: (value: string) => void;

  constructor(
    container: HTMLElement,
    options: ChipOption[],
    onChange?: (value: string) => void
  ) {
    super(container);
    this.options = options;
    this.onChange = onChange;
  }

  render(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'chip-group';
    this.options.forEach(opt => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (opt.active ? ' active' : '');
      chip.textContent = opt.label;
      chip.dataset.value = opt.value;
      chip.addEventListener('click', () => {
        // Deactivate all chips in this group
        wrapper.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (this.onChange) this.onChange(opt.value);
      });
      wrapper.appendChild(chip);
    });
    return wrapper;
  }

  setActive(value: string): void {
    const chips = this.container.querySelectorAll('.chip');
    chips.forEach(chip => {
      const isActive = (chip as HTMLElement).dataset.value === value;
      chip.classList.toggle('active', isActive);
    });
  }
}
