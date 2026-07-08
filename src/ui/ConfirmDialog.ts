/**
 * Modal confirmation for destructive actions (reverts, loading over the
 * current world, deleting vessels/saves). One at a time; Cancel is default.
 */
export function showConfirm(
  parent: HTMLElement,
  message: string,
  onConfirm: () => void,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  const panel = document.createElement('div');
  panel.className = 'pause-panel';

  const text = document.createElement('p');
  text.className = 'confirm-text';
  text.textContent = message;

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn danger pause-item';
  confirmBtn.textContent = 'Confirm';
  confirmBtn.addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn pause-item';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());

  panel.append(text, confirmBtn, cancelBtn);
  overlay.appendChild(panel);
  parent.appendChild(overlay);
}
