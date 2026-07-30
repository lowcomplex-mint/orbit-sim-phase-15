/**
 * Touch-friendly modal prompts (replaces window.prompt for VAB flows).
 * Matches pause/confirm overlay styling; DOM only — stay in ui/.
 */

export function showTextPrompt(
  parent: HTMLElement,
  options: {
    title: string;
    defaultValue?: string;
    confirmLabel?: string;
    onConfirm: (value: string) => void;
    onCancel?: () => void;
  },
): void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  const panel = document.createElement('div');
  panel.className = 'pause-panel';

  const title = document.createElement('h2');
  title.textContent = options.title;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-text-input';
  input.value = options.defaultValue ?? '';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const close = (confirmed: boolean) => {
    overlay.remove();
    if (confirmed) options.onConfirm(input.value);
    else options.onCancel?.();
  };

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn primary pause-item';
  confirmBtn.textContent = options.confirmLabel ?? 'Save';
  confirmBtn.addEventListener('click', () => close(true));

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn pause-item';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close(false));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    }
  });

  panel.append(title, input, confirmBtn, cancelBtn);
  overlay.appendChild(panel);
  parent.appendChild(overlay);
  // Defer focus so the layout settles on mobile keyboards.
  requestAnimationFrame(() => input.focus());
}

export interface ListPickerItem {
  id: string;
  label: string;
  detail?: string;
}

/**
 * Pick an item from a list; optional per-row delete. Cancel closes without
 * calling onPick.
 */
export function showListPicker(
  parent: HTMLElement,
  options: {
    title: string;
    emptyMessage?: string;
    items: ListPickerItem[];
    onPick: (id: string) => void;
    onDelete?: (id: string) => void;
    onCancel?: () => void;
  },
): void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  const panel = document.createElement('div');
  panel.className = 'pause-panel list-picker-panel';

  const title = document.createElement('h2');
  title.textContent = options.title;
  panel.appendChild(title);

  const list = document.createElement('div');
  list.className = 'list-picker-body';

  if (options.items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'confirm-text';
    empty.textContent = options.emptyMessage ?? 'Nothing here yet.';
    list.appendChild(empty);
  } else {
    for (const item of options.items) {
      const row = document.createElement('div');
      row.className = 'list-picker-row';

      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'btn pause-item list-picker-pick';
      pickBtn.textContent = item.detail ? `${item.label} · ${item.detail}` : item.label;
      pickBtn.addEventListener('click', () => {
        overlay.remove();
        options.onPick(item.id);
      });
      row.appendChild(pickBtn);

      if (options.onDelete) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn small danger';
        delBtn.textContent = 'Del';
        delBtn.title = 'Remove from library';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          overlay.remove();
          options.onDelete!(item.id);
        });
        row.appendChild(delBtn);
      }
      list.appendChild(row);
    }
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn pause-item';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
    options.onCancel?.();
  });

  panel.append(list, cancelBtn);
  overlay.appendChild(panel);
  parent.appendChild(overlay);
}
