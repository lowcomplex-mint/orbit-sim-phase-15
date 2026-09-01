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

/** 1px vertical hairline between VAB toolbar clusters. */
export function createToolbarRule(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'toolbar-rule';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** SFS-style mirror glyph for the SYM toggle (no text, no checkmark). */
export function createSymmetryButton(
  onToggle: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn icon ${options.className ?? ''}`.trim();
  btn.setAttribute('aria-label', 'Symmetry');
  if (options.title) btn.title = options.title;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('class', 'sym-icon');
  svg.setAttribute('aria-hidden', 'true');
  const ns = 'http://www.w3.org/2000/svg';
  const axis = document.createElementNS(ns, 'line');
  axis.setAttribute('x1', '9');
  axis.setAttribute('y1', '2');
  axis.setAttribute('x2', '9');
  axis.setAttribute('y2', '16');
  const left = document.createElementNS(ns, 'polyline');
  left.setAttribute('points', '5,4 7.5,9 5,14');
  const right = document.createElementNS(ns, 'polyline');
  right.setAttribute('points', '13,4 10.5,9 13,14');
  svg.append(axis, left, right);
  btn.appendChild(svg);
  btn.addEventListener('click', () => {
    onToggle();
    btn.blur();
  });
  return btn;
}
