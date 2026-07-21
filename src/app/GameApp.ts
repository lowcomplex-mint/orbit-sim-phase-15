import { BuilderScene } from '../builder/BuilderScene';
import { validateDesign } from '../builder/RocketAssembler';
import { SpaceCenterScene } from '../center/SpaceCenterScene';
import { TrackingStationScene } from '../center/TrackingStationScene';
import { createPartCatalog } from '../config/parts';
import { DEFAULT_ROCKET_DESIGN } from '../config/defaultRocket';
import { FlightScene } from '../flight/FlightScene';
import { Renderer } from '../render/Renderer';
import { SaveSystem, type SaveGame, type SaveSlotId } from '../storage/SaveSystem';
import { loadSettings } from '../storage/Settings';
import { CareerSystem, designCost } from '../systems/CareerSystem';
import { FlightSession } from '../systems/FlightSession';
import { showConfirm } from '../ui/ConfirmDialog';
import { DebugLog } from '../ui/DebugLog';
import { DebugOverlay } from '../ui/DebugOverlay';
import { RocketDesign } from '../vehicle/RocketDesign';
import { EventBus, type GameEvents } from './EventBus';
import type { GameContext, GameStateId, Scene } from './GameState';

/**
 * Top-level application: owns the renderer, the shared context (including
 * the persistent FlightSession and settings), the save/load orchestration,
 * and the active scene. Scenes are fully created/torn down on switch; the
 * flight session is NOT — it belongs to the context.
 *
 * Save orchestration lives here because it spans everything: a SaveGame is
 * design + serialized session, written to quick/auto/manual slots. Autosaves
 * fire before launch, before staging, before reverts, and on scene changes
 * (the latter two gated by settings).
 */
export class GameApp {
  private scenes!: Record<GameStateId, Scene>;
  private currentId: GameStateId | null = null;
  /** Suppresses the scene-change autosave while a save is being applied. */
  private restoring = false;
  /** Shown in the debug overlay (F3). */
  lastSaveInfo = 'never';

  private constructor(private readonly ctx: GameContext) {}

  static async create(host: HTMLElement): Promise<GameApp> {
    const renderer = new Renderer();
    await renderer.init(host);

    const uiRoot = document.createElement('div');
    uiRoot.id = 'ui-root';
    host.appendChild(uiRoot);

    const bus = new EventBus<GameEvents>();
    const debugLog = new DebugLog(uiRoot, bus);
    const saves = new SaveSystem();

    const savedDesign = saves.loadDesign();
    const log = (level: Parameters<GameContext['log']>[0], message: string) =>
      bus.emit('log', { level, message });
    const ctx: GameContext = {
      bus,
      catalog: createPartCatalog(),
      design: RocketDesign.fromData(savedDesign ?? DEFAULT_ROCKET_DESIGN),
      saves,
      settings: loadSettings(),
      session: null,
      career: new CareerSystem(log),
      log,
      confirm: (message, onConfirm) => showConfirm(uiRoot, message, onConfirm),
    };

    const app = new GameApp(ctx);
    app.scenes = {
      spaceCenter: new SpaceCenterScene(ctx, {
        openBuilder: () => app.switchTo('builder'),
        launchCurrentDesign: () => app.launchCurrentDesign(),
        openTrackingStation: () => app.switchTo('trackingStation'),
        resumeFlight: () => app.resumeFlight(),
        saveToSlot: (slot) => app.saveToSlot(slot, 'Manual save'),
        loadFromSlot: (slot) =>
          ctx.confirm('Load this save? The current world will be replaced.', () =>
            app.loadFromSlot(slot),
          ),
        deleteSlot: (slot) =>
          ctx.confirm(`Delete the save in ${slot}?`, () => {
            saves.deleteGame(slot);
            ctx.log('info', `Save slot cleared (${slot}).`);
          }),
      }),
      builder: new BuilderScene(
        renderer,
        ctx,
        () => app.launch(),
        () => app.switchTo('spaceCenter'),
      ),
      flight: new FlightScene(renderer, ctx, {
        backToBuilder: () => app.switchTo('builder'),
        exitToSpaceCenter: () => app.switchTo('spaceCenter'),
        exitToTrackingStation: () => app.switchTo('trackingStation'),
        revertToLaunch: () =>
          ctx.confirm('Revert to launch? Flight progress will be lost.', () => {
            app.autosave('before revert', 'always');
            app.launch({ skipAutosave: true, skipCost: true });
          }),
        revertToVab: () =>
          ctx.confirm('Revert to the VAB? The flight will be discarded.', () => {
            app.autosave('before revert', 'always');
            ctx.session = null;
            ctx.log('info', 'Flight discarded (revert to VAB).');
            app.switchTo('builder');
          }),
        quickSave: () => app.quickSave(),
        quickLoad: () => app.quickLoad(),
        requestAutosave: (reason, kind) => app.autosave(reason, kind),
      }),
      trackingStation: new TrackingStationScene(
        ctx,
        () => app.switchTo('spaceCenter'),
        () => app.resumeFlight(),
      ),
    };

    // Global keys: log panel (not in flight — L toggles legs there), quicksave, debug.
    const debugOverlay = new DebugOverlay(uiRoot);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && !e.repeat && app.currentId !== 'flight') debugLog.toggle();
      if (e.code === 'F3') {
        e.preventDefault();
        debugOverlay.toggle();
      }
      if (e.code === 'F5') {
        e.preventDefault(); // browsers reload on F5; we quicksave (KSP habit)
        app.quickSave();
      }
      if (e.code === 'F9') {
        e.preventDefault();
        app.quickLoad();
      }
    });

    renderer.app.ticker.add((ticker) => {
      const dt = Math.min(ticker.deltaMS / 1000, 0.1);
      if (app.currentId) app.scenes[app.currentId].update(dt);
      debugOverlay.update({
        fps: ticker.FPS,
        scene: app.currentId ?? '—',
        session: ctx.session,
        lastSave: app.lastSaveInfo,
      });
    });

    ctx.log(
      'info',
      `Orbit Simulator ready. ${savedDesign ? 'Saved design loaded.' : 'Stock rocket loaded.'} ` +
        'F5 quicksaves, F9 quickloads.',
    );
    app.switchTo('spaceCenter');
    return app;
  }

  switchTo(id: GameStateId): void {
    if (this.currentId && this.currentId !== id && !this.restoring) {
      this.autosave(`leaving ${this.currentId}`, 'scene');
    }
    if (this.currentId) this.scenes[this.currentId].exit();
    this.currentId = id;
    this.scenes[id].enter();
    this.ctx.log('info', `Scene: ${id}.`);
  }

  // ------------------------------------------------------------- flights --

  /** Start (or restart) a flight of the current design from the builder/pad. */
  private launch(options?: { skipAutosave?: boolean; skipCost?: boolean }): void {
    if (!options?.skipAutosave) this.autosave('before launch', 'always');
    if (this.ctx.session) {
      this.ctx.log('info', 'Previous flight session discarded.');
    }
    if (!options?.skipCost) {
      this.ctx.career.chargeLaunch(
        designCost(this.ctx.design, this.ctx.catalog),
        this.ctx.design.name,
      );
    }
    this.ctx.session = FlightSession.launchNew(
      this.ctx.design,
      this.ctx.catalog,
      this.ctx.log,
      {
        maxDebris: () => this.ctx.settings.maxDebris,
        heatingEnabled: () => this.ctx.settings.heatingEnabled,
      },
    );
    this.switchTo('flight');
  }

  /** Space Center "Launchpad" door: validate first, then fly. */
  private launchCurrentDesign(): void {
    const check = validateDesign(this.ctx.design, this.ctx.catalog);
    if (!check.ok) {
      for (const problem of check.problems) this.ctx.log('warn', problem);
      return;
    }
    this.launch();
  }

  private resumeFlight(): void {
    if (!this.ctx.session) {
      this.ctx.log('warn', 'No flight in progress to resume.');
      return;
    }
    this.switchTo('flight');
  }

  // ---------------------------------------------------------- save/load --

  private buildSaveGame(label: string): SaveGame {
    return {
      version: 1,
      label,
      savedAtIso: new Date().toISOString(),
      design: this.ctx.design.toData(),
      session: this.ctx.session?.serialize() ?? null,
      career: this.ctx.career.serialize(),
    };
  }

  private applySaveGame(data: SaveGame, sourceLabel: string): void {
    this.restoring = true;
    try {
      this.ctx.design = RocketDesign.fromData(data.design);
      this.ctx.career.restore(data.career);
      this.ctx.session = data.session
        ? FlightSession.fromSave(data.session, this.ctx.catalog, this.ctx.log, {
            maxDebris: () => this.ctx.settings.maxDebris,
            heatingEnabled: () => this.ctx.settings.heatingEnabled,
          })
        : null;
      this.ctx.log('info', `Loaded ${sourceLabel} ("${data.label}").`);
      this.switchTo(this.ctx.session ? 'flight' : 'spaceCenter');
    } catch (err) {
      this.ctx.log('error', `Loading failed: ${String(err)}`);
    } finally {
      this.restoring = false;
    }
  }

  private quickSave(): void {
    const ok = this.ctx.saves.saveGame('quick', this.buildSaveGame('Quicksave'));
    if (ok) this.lastSaveInfo = 'quicksave';
    this.ctx.log(ok ? 'info' : 'error', ok ? 'Quicksaved.' : 'Quicksave failed (storage).');
  }

  private quickLoad(): void {
    const data = this.ctx.saves.loadGame('quick');
    if (!data) {
      this.ctx.log('warn', 'No quicksave to load.');
      return;
    }
    this.applySaveGame(data, 'quicksave');
  }

  private saveToSlot(slot: SaveSlotId, label: string): void {
    const ok = this.ctx.saves.saveGame(slot, this.buildSaveGame(label));
    this.ctx.log(ok ? 'info' : 'error', ok ? `Saved to ${slot}.` : 'Save failed (storage).');
  }

  private loadFromSlot(slot: SaveSlotId): void {
    const data = this.ctx.saves.loadGame(slot);
    if (!data) {
      this.ctx.log('warn', `Slot ${slot} is empty.`);
      return;
    }
    this.applySaveGame(data, slot);
  }

  /**
   * Autosave with gating: 'always' fires unconditionally (launch/revert);
   * 'staging' and 'scene' respect their settings toggles. Keeps a rotating
   * three-deep history (auto-1 newest .. auto-3 oldest).
   */
  private autosave(reason: string, kind: 'staging' | 'scene' | 'always'): void {
    if (kind === 'staging' && !this.ctx.settings.autosaveOnStaging) return;
    if (kind === 'scene' && !this.ctx.settings.autosaveOnSceneChange) return;
    this.ctx.saves.rotateAutosaves();
    if (this.ctx.saves.saveGame('auto-1', this.buildSaveGame(`Autosave — ${reason}`))) {
      this.lastSaveInfo = `auto (${reason})`;
      this.ctx.log('info', `Autosaved (${reason}).`);
    }
  }
}
