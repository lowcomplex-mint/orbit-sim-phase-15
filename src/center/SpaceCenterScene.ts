import type { GameContext, Scene } from '../app/GameState';
import { clampDebris, saveSettings } from '../storage/Settings';
import { MANUAL_SLOTS, type SaveSlotId } from '../storage/SaveSystem';

/** Navigation + save/load actions provided by GameApp. */
export interface SpaceCenterActions {
  openBuilder(): void;
  launchCurrentDesign(): void;
  openTrackingStation(): void;
  resumeFlight(): void;
  saveToSlot(slot: SaveSlotId): void;
  loadFromSlot(slot: SaveSlotId): void;
  deleteSlot(slot: SaveSlotId): void;
}

/**
 * The Space Center: the game's hub. Doors to the VAB, the launchpad (flies
 * the current design directly), the Tracking Station, Settings, and the
 * Saved Games panel. TODO: building illustrations, campaign state.
 */
export class SpaceCenterScene implements Scene {
  private uiRoot!: HTMLDivElement;
  private modal: HTMLDivElement | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly actions: SpaceCenterActions,
  ) {}

  enter(): void {
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'scene-ui center-screen';

    const title = document.createElement('h1');
    title.textContent = 'ORBIT SPACE CENTER';
    const subtitle = document.createElement('p');
    subtitle.className = 'center-subtitle';
    const career = this.ctx.career.state;
    subtitle.textContent =
      `Funds ${Math.round(career.funds).toLocaleString('en-US')} · ` +
      `Science ${career.science} · Reputation ${career.reputation} · ` +
      `Milestones ${Object.keys(career.milestones).length}`;

    const resumeBtn = this.bigButton('Resume Active Flight', () => this.actions.resumeFlight());
    if (!this.ctx.session) {
      resumeBtn.disabled = true;
      resumeBtn.title = 'No flight in progress';
    }

    const missionControlBtn = this.bigButton('Mission Control', () => {
      this.ctx.log('info', 'Mission Control: contracts are TODO (career foundations exist).');
    });
    missionControlBtn.disabled = true;
    missionControlBtn.title = 'Contracts / career mode — foundations in place, gameplay TODO';

    this.uiRoot.append(
      title,
      subtitle,
      this.bigButton('VAB / Editor', () => this.actions.openBuilder()),
      this.bigButton('Launchpad', () => this.actions.launchCurrentDesign()),
      this.bigButton('Tracking Station', () => this.actions.openTrackingStation()),
      resumeBtn,
      this.bigButton('Saved Games', () => this.openSavesModal()),
      this.bigButton('Settings', () => this.openSettingsModal()),
      missionControlBtn,
    );
    document.getElementById('ui-root')!.appendChild(this.uiRoot);
  }

  exit(): void {
    this.closeModal();
    this.uiRoot.remove();
  }

  update(_dtSec: number): void {
    // Static screen; the flight session (if any) is intentionally paused here.
  }

  // -------------------------------------------------------------- modals --

  private openSettingsModal(): void {
    const body = this.openModal('SETTINGS');
    const settings = this.ctx.settings;

    // Debris cap stepper.
    const debrisRow = document.createElement('div');
    debrisRow.className = 'ctx-row';
    const debrisLabel = document.createElement('span');
    const refreshDebris = () => {
      debrisLabel.textContent = `Max debris kept: ${settings.maxDebris}`;
    };
    refreshDebris();
    const debrisBtns = document.createElement('div');
    debrisBtns.className = 'ctx-btn-row';
    const stepDebris = (delta: number) => {
      settings.maxDebris = clampDebris(settings.maxDebris + delta);
      saveSettings(settings);
      refreshDebris();
    };
    debrisBtns.append(
      this.miniBtn('−', () => stepDebris(-1)),
      this.miniBtn('+', () => stepDebris(1)),
    );
    debrisRow.append(debrisLabel, debrisBtns);
    body.appendChild(debrisRow);

    body.appendChild(
      this.checkboxRow('Autosave before staging', settings.autosaveOnStaging, (v) => {
        settings.autosaveOnStaging = v;
        saveSettings(settings);
      }),
    );
    body.appendChild(
      this.checkboxRow('Autosave on scene changes', settings.autosaveOnSceneChange, (v) => {
        settings.autosaveOnSceneChange = v;
        saveSettings(settings);
      }),
    );
    body.appendChild(
      this.checkboxRow('Reentry heating (difficulty)', settings.heatingEnabled, (v) => {
        settings.heatingEnabled = v;
        saveSettings(settings);
      }),
    );
  }

  private openSavesModal(): void {
    const body = this.openModal('SAVED GAMES');
    const list = document.createElement('div');
    list.className = 'vessel-list';
    body.appendChild(list);

    const refresh = () => {
      list.replaceChildren();
      const infos = new Map(this.ctx.saves.listGames().map((i) => [i.slot, i]));
      const slots: SaveSlotId[] = ['quick', 'auto-1', 'auto-2', 'auto-3', ...MANUAL_SLOTS];
      for (const slot of slots) {
        const info = infos.get(slot);
        const row = document.createElement('div');
        row.className = 'vessel-row';

        const name = document.createElement('div');
        name.className = 'vessel-name';
        name.textContent = `${slotTitle(slot)}${info ? ` — ${info.label}` : ' — empty'}`;
        const stats = document.createElement('div');
        stats.className = 'vessel-stats';
        stats.textContent = info
          ? `${new Date(info.savedAtIso).toLocaleString()} · ${info.vesselCount} vessel(s)`
          : '';
        row.append(name, stats);

        if (MANUAL_SLOTS.includes(slot)) {
          row.appendChild(
            this.miniBtn('Save', () => {
              this.actions.saveToSlot(slot);
              refresh();
            }),
          );
        }
        if (info) {
          row.appendChild(this.miniBtn('Load', () => this.actions.loadFromSlot(slot)));
          row.appendChild(
            this.miniBtn('Delete', () => {
              this.actions.deleteSlot(slot);
              refresh();
            }),
          );
        }
        list.appendChild(row);
      }
    };
    refresh();
  }

  private openModal(titleText: string): HTMLDivElement {
    this.closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    const panel = document.createElement('div');
    panel.className = 'pause-panel wide';
    const title = document.createElement('h2');
    title.textContent = titleText;
    const body = document.createElement('div');
    body.className = 'modal-body';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.closeModal());
    panel.append(title, body, closeBtn);
    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.modal = overlay;
    return body;
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  // ------------------------------------------------------------- helpers --

  private bigButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn big';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private miniBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      onClick();
      btn.blur();
    });
    return btn;
  }

  private checkboxRow(
    label: string,
    initial: boolean,
    onChange: (value: boolean) => void,
  ): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'ctx-row checkbox-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = initial;
    box.addEventListener('change', () => onChange(box.checked));
    const text = document.createElement('span');
    text.textContent = label;
    row.append(box, text);
    return row;
  }
}

function slotTitle(slot: SaveSlotId): string {
  if (slot === 'quick') return 'Quicksave';
  if (slot.startsWith('auto-')) return `Autosave ${slot.slice(-1)}`;
  return `Slot ${slot.slice(-1)}`;
}
