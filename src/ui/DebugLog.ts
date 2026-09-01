import type { EventBus, GameEvents, LogLevel } from '../app/EventBus';

const MAX_ENTRIES = 200;

/**
 * The in-game log: a toggleable panel (button or L key) fed by 'log' events
 * on the bus. Errors and warnings also flash as a transient toast so they
 * are visible without opening the panel. Global JS errors are captured too.
 */
export class DebugLog {
  private readonly panel: HTMLDivElement;
  private readonly entries: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastTimer: number | undefined;

  constructor(parent: HTMLElement, bus: EventBus<GameEvents>) {
    this.panel = document.createElement('div');
    this.panel.className = 'log-panel';
    this.panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'log-header';
    const title = document.createElement('span');
    title.textContent = 'Log';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn small';
    clearBtn.textContent = 'Clear log';
    clearBtn.addEventListener('click', () => {
      this.entries.replaceChildren();
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn small';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.toggle());
    header.append(title, clearBtn, closeBtn);

    this.entries = document.createElement('div');
    this.entries.className = 'log-entries';
    this.panel.append(header, this.entries);

    this.toast = document.createElement('div');
    this.toast.className = 'toast';
    this.toast.hidden = true;

    parent.append(this.panel, this.toast);

    bus.on('log', ({ level, message }) => this.add(level, message));
    this.hookGlobalErrors();
  }

  toggle(): void {
    this.panel.hidden = !this.panel.hidden;
  }

  add(level: LogLevel, message: string): void {
    const entry = document.createElement('div');
    entry.className = `entry ${level}`;
    const time = new Date().toLocaleTimeString('en-GB');
    entry.textContent = `[${time}] ${message}`;
    this.entries.appendChild(entry);
    while (this.entries.childElementCount > MAX_ENTRIES) {
      this.entries.firstElementChild?.remove();
    }
    this.entries.scrollTop = this.entries.scrollHeight;

    if (level !== 'info' && this.panel.hidden) {
      this.showToast(message, level);
    }
  }

  showToast(message: string, level: LogLevel = 'info'): void {
    this.toast.textContent = message;
    this.toast.className = `toast ${level}`;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, 3200);
  }

  private hookGlobalErrors(): void {
    window.addEventListener('error', (e) => {
      this.add('error', `JS error: ${e.message}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.add('error', `Unhandled rejection: ${String(e.reason)}`);
    });
  }
}
