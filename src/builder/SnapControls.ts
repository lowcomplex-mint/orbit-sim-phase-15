import {
  clampSnapStep,
  formatSnapStep,
  MIN_SNAP_STEP_CELLS,
  SNAP_STEP_PRESETS,
  type SnapStepCells,
} from './PlacementGrid';

/**
 * VAB toolbar control for placement snap granularity: +/- steppers and a
 * dropdown of 0.1-cell presets. Snap cannot be turned off (floor 0.1).
 */
export class SnapControls {
  readonly root: HTMLDivElement;
  private step: SnapStepCells = 1;
  private readonly label: HTMLSpanElement;
  private readonly select: HTMLSelectElement;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (step: SnapStepCells) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'snap-controls';
    this.root.title = 'Placement snap step (grid cells)';

    const title = document.createElement('span');
    title.className = 'snap-label';
    title.textContent = 'Snap';

    const minus = this.stepBtn('−', () => this.adjust(-MIN_SNAP_STEP_CELLS));
    const plus = this.stepBtn('+', () => this.adjust(MIN_SNAP_STEP_CELLS));

    this.label = document.createElement('span');
    this.label.className = 'snap-value';

    this.select = document.createElement('select');
    this.select.className = 'snap-select';
    for (const preset of SNAP_STEP_PRESETS) {
      const opt = document.createElement('option');
      opt.value = String(preset);
      opt.textContent = formatSnapStep(preset);
      this.select.appendChild(opt);
    }
    this.select.addEventListener('change', () => {
      this.setStep(clampSnapStep(Number(this.select.value)));
    });

    this.root.append(title, minus, this.label, plus, this.select);
    parent.appendChild(this.root);
    this.refreshUi();
  }

  destroy(): void {
    this.root.remove();
  }

  get snapStep(): SnapStepCells {
    return this.step;
  }

  private stepBtn(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn tiny';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      onClick();
      btn.blur();
    });
    return btn;
  }

  private adjust(delta: number): void {
    this.setStep(clampSnapStep(this.step + delta));
  }

  private setStep(next: SnapStepCells): void {
    if (next === this.step) return;
    this.step = next;
    this.refreshUi();
    this.onChange(next);
  }

  private refreshUi(): void {
    this.label.textContent = formatSnapStep(this.step);
    this.select.value = String(this.step);
  }
}