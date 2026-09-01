import type { GameContext, Scene } from '../app/GameState';
import { clampDebris, saveSettings } from '../storage/Settings';
import { MANUAL_SLOTS, type SaveSlotId } from '../storage/SaveSystem';
import { isStandalone, onPwaInstallChange, promptInstall } from '../ui/PwaInstall';

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
  private installBtn: HTMLButtonElement | null = null;
  private unsubInstall: (() => void) | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly actions: SpaceCenterActions,
  ) {}

  enter(): void {
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'scene-ui center-screen';

    const title = document.createElement('h1');
    title.textContent = 'ORBIT SIM';
    const subtitle = document.createElement('p');
    subtitle.className = 'center-subtitle';
    const career = this.ctx.career.state;
    subtitle.textContent =
      `Funds ${Math.round(career.funds).toLocaleString('en-US')} · ` +
      `Science ${career.science} · Rep ${career.reputation}`;

    const resumeBtn = this.bigButton('Resume', () => this.actions.resumeFlight());
    if (!this.ctx.session) {
      resumeBtn.disabled = true;
      resumeBtn.title = 'No flight in progress';
    }

    this.installBtn = this.bigButton('Add to Home Screen', () => {
      void this.onInstallClick();
    });
    this.refreshInstallBtn();
    this.unsubInstall = onPwaInstallChange(() => this.refreshInstallBtn());

    this.uiRoot.append(
      title,
      subtitle,
      this.bigButton('VAB', () => this.actions.openBuilder()),
      this.bigButton('Launch', () => this.actions.launchCurrentDesign()),
      this.bigButton('Tracking', () => this.actions.openTrackingStation()),
      resumeBtn,
      this.bigButton('Saves', () => this.openSavesModal()),
      this.bigButton('Settings', () => this.openSettingsModal()),
      this.installBtn,
    );
    document.getElementById('ui-root')!.appendChild(this.uiRoot);
  }

  exit(): void {
    this.unsubInstall?.();
    this.unsubInstall = null;
    this.closeModal();
    this.uiRoot.remove();
  }

  private refreshInstallBtn(): void {
    if (!this.installBtn) return;
    this.installBtn.hidden = isStandalone();
  }

  private async onInstallClick(): Promise<void> {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      this.ctx.log('info', 'Orbit Sim added to the home screen.');
      return;
    }
    const body = this.openModal('ADD TO HOME SCREEN');
    const p = document.createElement('p');
    p.className = 'confirm-text';
    p.textContent =
      'Chrome menu (the ⋮ at the top right) → Add to Home screen / Install app. ' +
      'That hides the URL bar so the game can use the full screen. ' +
      'The shortcut only works while this USB/dev server is up.';
    body.appendChild(p);
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
