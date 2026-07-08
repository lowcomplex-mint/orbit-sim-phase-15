/**
 * The in-flight pause menu. Purely presentational: every entry calls back
 * into FlightScene/GameApp; opening/closing also drives the scene's paused
 * flag (simulation time stands still while the menu is up).
 */

export interface PauseMenuActions {
  onResume(): void;
  onRevertToLaunch(): void;
  onRevertToVab(): void;
  onSpaceCenter(): void;
  onTrackingStation(): void;
  onQuickSave(): void;
  onQuickLoad(): void;
}

export class PauseMenu {
  private readonly overlay: HTMLDivElement;

  constructor(parent: HTMLElement, actions: PauseMenuActions) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'pause-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'pause-panel';

    const title = document.createElement('h2');
    title.textContent = 'PAUSED';
    panel.appendChild(title);

    const entries: [string, () => void][] = [
      ['Resume Flight', actions.onResume],
      ['Quicksave', actions.onQuickSave],
      ['Quickload', actions.onQuickLoad],
      ['Revert to Launch', actions.onRevertToLaunch],
      ['Revert to VAB', actions.onRevertToVab],
      ['Space Center', actions.onSpaceCenter],
      ['Tracking Station', actions.onTrackingStation],
    ];
    for (const [label, action] of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn pause-item';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        action();
        btn.blur();
      });
      panel.appendChild(btn);
    }

    this.overlay.appendChild(panel);
    parent.appendChild(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(): void {
    this.overlay.hidden = false;
  }

  close(): void {
    this.overlay.hidden = true;
  }

  destroy(): void {
    this.overlay.remove();
  }
}
