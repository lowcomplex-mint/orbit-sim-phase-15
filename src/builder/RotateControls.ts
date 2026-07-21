import {
  clampRotateStep,
  formatRotateStep,
  MIN_ROTATE_STEP_DEG,
  ROTATE_STEP_PRESETS,
  type RotateStepDeg,
} from './PlacementGrid';

/**
 * VAB toolbar control for subtree rotation increment (mirrors SnapControls).
 */
export class RotateControls {
  readonly root: HTMLDivElement;
  private step: RotateStepDeg = 15;
  private readonly label: HTMLSpanElement;
  private readonly select: HTMLSelectElement;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (step: RotateStepDeg) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'snap-controls rotate-controls';
    this.root.title = 'Subtree rotation increment (degrees)';

    const title = document.createElement('span');
    title.className = 'snap-label';
    title.textContent = 'Rot';

    const minus = this.stepBtn('−', () => this.adjust(-MIN_ROTATE_STEP_DEG));
    const plus = this.stepBtn('+', () => this.adjust(MIN_ROTATE_STEP_DEG));

    this.label = document.createElement('span');
    this.label.className = 'snap-value';

    this.select = document.createElement('select');
    this.select.className = 'snap-select';
    for (const preset of ROTATE_STEP_PRESETS) {
      const opt = document.createElement('option');
      opt.value = String(preset);
      opt.textContent = formatRotateStep(preset);
      this.select.appendChild(opt);
    }
    this.select.addEventListener('change', () => {
      this.setStep(clampRotateStep(Number(this.select.value)));
    });

    this.root.append(title, minus, this.label, plus, this.select);
    parent.appendChild(this.root);
    this.refreshUi();
  }

  destroy(): void {
    this.root.remove();
  }

  /** Grey out rotation controls (Phase 11: disabled until Rotate v2). */
  setEnabled(enabled: boolean): void {
    this.root.classList.toggle('disabled', !enabled);
    for (const el of this.root.querySelectorAll('button, select')) {
      (el as HTMLButtonElement).disabled = !enabled;
    }
    this.root.title = enabled
      ? 'Subtree rotation increment (degrees)'
      : 'Disabled until Phase 13 (node overhaul)';
  }

  get rotateStep(): RotateStepDeg {
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
    this.setStep(clampRotateStep(this.step + delta));
  }

  private setStep(next: RotateStepDeg): void {
    if (next === this.step) return;
    this.step = next;
    this.refreshUi();
    this.onChange(next);
  }

  private refreshUi(): void {
    this.label.textContent = formatRotateStep(this.step);
    this.select.value = String(this.step);
  }
}