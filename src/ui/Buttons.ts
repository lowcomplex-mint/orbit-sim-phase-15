/**
 * Small DOM helpers for the touch-first UI. Buttons are pointer-event based,
 * at least 48px tall (see style.css), and blur themselves after use so that
 * keyboard controls (Space = stage!) never accidentally re-trigger a button.
 */

export interface ButtonOptions {
  className?: string;
  title?: string;
}

export function createButton(
  label: string,
  onClick: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${options.className ?? ''}`.trim();
  btn.textContent = label;
  if (options.title) btn.title = options.title;
  btn.addEventListener('click', () => {
    onClick();
    btn.blur();
  });
  return btn;
}

/** A press-and-hold button (used for rotation): fires onDown/onUp. */
export function createHoldButton(
  label: string,
  onDown: () => void,
  onUp: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn hold ${options.className ?? ''}`.trim();
  btn.textContent = label;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    onDown();
  });
  const release = () => {
    onUp();
    btn.blur();
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  return btn;
}

export function createRow(className = 'btn-row'): HTMLDivElement {
  const row = document.createElement('div');
  row.className = className;
  return row;
}
