import { Container, Graphics } from 'pixi.js';
import type { GameContext, Scene } from '../app/GameState';
import { EARTH_CONFIG } from '../config/celestialBodies';
import { BUILDER, GRID_CELL_METERS } from '../config/constants';
import { DEFAULT_ROCKET_DESIGN } from '../config/defaultRocket';
import { paletteParts } from '../config/parts';
import { Vec2 } from '../math/Vec2';
import { CameraController } from '../flight/CameraController';
import { summarizeHabitation } from '../future/HabitationSystem';
import type { Renderer } from '../render/Renderer';
import { buildGridGraphic } from '../render/GridRenderer';
import { buildPartGraphic } from '../render/RocketRenderer';
import { analyzeVehicle } from '../systems/VehicleAnalysis';
import { createButton, createRow } from '../ui/Buttons';
import type { PartDefinition } from '../vehicle/PartDefinition';
import type { PartInstance } from '../vehicle/PartInstance';
import {
  clampProceduralDimensions,
  clampThrustLimiter,
  resolvePartProps,
  resolvePlacedPart,
  type PartCustomization,
  type ProceduralDimensions,
} from '../vehicle/ProceduralPart';
import { RocketDesign, type PlacedPartData } from '../vehicle/RocketDesign';
import { RocketRuntime } from '../vehicle/RocketRuntime';
import { previewStages, type StagePreview } from '../vehicle/StageSystem';
import { EditorEngineeringPanel } from './EditorEngineeringPanel';
import { inBounds, overlapsAnyPart, worldToCell } from './GridSystem';
import { PartContextMenu } from './PartContextMenu';
import { PartPalette } from './PartPalette';
import { instantiateParts, validateDesign } from './RocketAssembler';
import { findSnap, type DraggedPart, type SnapResult } from './SnapSystem';
import { StagingPanel } from './StagingPanel';

interface DragState extends DraggedPart {
  custom?: PartCustomization;
  snap: SnapResult | null;
}

/** Undo/redo depth. Snapshots are tiny (design JSON), so keep plenty. */
const HISTORY_LIMIT = 60;

/**
 * The vehicle-assembly scene: grid, palette (with procedural sizing),
 * node-exact drag & drop, engineering panel, staging panel with stage
 * preview, right-click part customization, CoM marker, and design
 * management buttons.
 *
 * ALL design mutations funnel through designChanged() so the engineering
 * analysis, staging list, and CoM marker can never go stale.
 * TODO: builder camera pan/zoom for tall rockets; undo.
 */
export class BuilderScene implements Scene {
  private root = new Container();
  private partsLayer = new Container();
  private ghostG = new Graphics();
  private comMarkerG = new Graphics();
  private highlightG = new Graphics();
  private camera = new CameraController(56, BUILDER.minPxPerMeter, BUILDER.maxPxPerMeter);

  private uiRoot!: HTMLDivElement;
  private palette!: PartPalette;
  private engineeringPanel!: EditorEngineeringPanel;
  private stagingPanel!: StagingPanel;
  private contextMenu!: PartContextMenu;
  private drag: DragState | null = null;
  private lastWarnings = '';

  // --- editor camera state (pan/zoom/pinch) ---
  private readonly panPointers = new Map<number, { x: number; y: number }>();
  // --- undo/redo (design snapshots through the single mutation funnel) ---
  private history: string[] = [];
  private historyIndex = -1;
  // --- mirror symmetry (2D: N-x radial symmetry is out-of-plane; a 2x
  // mirror across the center column is the honest equivalent) ---
  private symmetryOn = false;
  private symBtn!: HTMLButtonElement;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKeyDown(e);
  private readonly wheelHandler = (e: WheelEvent) => this.onWheel(e);
  /** Instances aligned 1:1 with design.parts, for staging/context lookups. */
  private lastParts: PartInstance[] = [];
  private lastRuntime: RocketRuntime | null = null;
  private lastPreviews: StagePreview[] = [];

  private readonly pointerMoveHandler = (e: PointerEvent) => this.onPointerMove(e);
  private readonly pointerUpHandler = (e: PointerEvent) => this.onPointerUp(e);
  private readonly canvasDownHandler = (e: PointerEvent) => this.onCanvasDown(e);
  private readonly canvasMoveHandler = (e: PointerEvent) => this.onCanvasPanMove(e);
  private readonly canvasUpHandler = (e: PointerEvent) => this.panPointers.delete(e.pointerId);
  private readonly contextMenuHandler = (e: MouseEvent) => this.onContextMenu(e);

  constructor(
    private readonly renderer: Renderer,
    private readonly ctx: GameContext,
    private readonly onLaunch: () => void,
    private readonly onExitToCenter: () => void,
  ) {}

  enter(): void {
    this.root = new Container();
    this.partsLayer = new Container();
    this.ghostG = new Graphics();
    this.comMarkerG = new Graphics();
    this.highlightG = new Graphics();
    this.root.addChild(
      buildGridGraphic(),
      this.partsLayer,
      this.highlightG,
      this.comMarkerG,
      this.ghostG,
    );
    this.renderer.worldRoot.addChild(this.root);

    this.buildUi();
    this.renderer.canvas.addEventListener('pointerdown', this.canvasDownHandler);
    this.renderer.canvas.addEventListener('pointermove', this.canvasMoveHandler);
    this.renderer.canvas.addEventListener('pointerup', this.canvasUpHandler);
    this.renderer.canvas.addEventListener('pointercancel', this.canvasUpHandler);
    this.renderer.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    this.renderer.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    window.addEventListener('keydown', this.keyHandler);

    this.history = [];
    this.historyIndex = -1;
    this.panPointers.clear();
    this.fitView();
    this.designChanged();
    this.ctx.log('info', `Builder opened (${this.ctx.design.parts.length} parts).`);

    // Dev-only hook for tests (mirrors the one in FlightScene).
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__builder = this;
    }
  }

  exit(): void {
    this.renderer.canvas.removeEventListener('pointerdown', this.canvasDownHandler);
    this.renderer.canvas.removeEventListener('pointermove', this.canvasMoveHandler);
    this.renderer.canvas.removeEventListener('pointerup', this.canvasUpHandler);
    this.renderer.canvas.removeEventListener('pointercancel', this.canvasUpHandler);
    this.renderer.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    this.renderer.canvas.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('keydown', this.keyHandler);
    this.stopDragListeners();
    this.drag = null;
    this.contextMenu.destroy();
    this.palette.destroy();
    this.engineeringPanel.destroy();
    this.stagingPanel.destroy();
    this.uiRoot.remove();
    this.root.destroy({ children: true });
  }

  update(_dtSec: number): void {
    // Free camera: the player pans/zooms; we only apply the transform.
    this.camera.apply(this.renderer.worldRoot, this.renderer.viewWidth, this.renderer.viewHeight);
  }

  /** Frame the launch column comfortably (initial view / FIT button). */
  private fitView(): void {
    const viewH = this.renderer.viewHeight;
    const bottomReservePx = window.matchMedia('(max-width: 720px)').matches ? 200 : 70;
    const s = Math.min(
      Math.max(viewH / BUILDER.viewHeightM, BUILDER.minPxPerMeter),
      BUILDER.maxPxPerMeter,
    );
    this.camera.setZoom(s);
    this.camera.center = new Vec2(0, (viewH / 2 - bottomReservePx) / s);
  }

  // ----------------------------------------------------------------- UI --

  private buildUi(): void {
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'scene-ui';

    const toolbar = createRow('toolbar-top');
    this.symBtn = createButton(
      'SYM ✗',
      () => {
        this.symmetryOn = !this.symmetryOn;
        this.symBtn.textContent = this.symmetryOn ? 'SYM ✓' : 'SYM ✗';
        this.ctx.log('info', `Mirror symmetry ${this.symmetryOn ? 'on' : 'off'}.`);
      },
      { title: 'Mirror placement across the center column' },
    );
    toolbar.append(
      createButton('◄ KSC', () => this.onExitToCenter(), { title: 'Back to Space Center' }),
      createButton('↶', () => this.undo(), { title: 'Undo (Ctrl+Z)' }),
      createButton('↷', () => this.redo(), { title: 'Redo (Ctrl+Y)' }),
      this.symBtn,
      createButton('FIT', () => this.fitView(), { title: 'Reset editor camera' }),
      createButton('Clear', () => this.clearDesign()),
      createButton('Default', () => this.loadDefault()),
      createButton('Save', () => this.saveDesign()),
      createButton('Load', () => this.loadDesign()),
      createButton('LAUNCH', () => this.tryLaunch(), { className: 'primary' }),
    );

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent =
      'Drag parts to build · right-click configures · drag empty space pans · wheel/pinch zooms.';

    this.uiRoot.append(toolbar, hint);
    document.getElementById('ui-root')!.appendChild(this.uiRoot);

    this.palette = new PartPalette(
      this.uiRoot,
      paletteParts(),
      (def, custom, e) => this.startDrag(def, custom, e),
      (def, dims) => {
        const props = resolvePartProps(def, dims);
        this.ctx.log(
          'info',
          `${def.name} sized to ${dims.widthCells}×${dims.heightCells} ` +
            `(${props.fuelCapacityKg} kg fuel, ${props.dryMassKg} kg dry).`,
        );
      },
    );
    this.engineeringPanel = new EditorEngineeringPanel(this.uiRoot);
    this.stagingPanel = new StagingPanel(this.uiRoot, (stage) =>
      this.highlightStage(stage),
    );
    this.contextMenu = new PartContextMenu(this.uiRoot, {
      onCustomize: (placed, patch) => this.customizePart(placed, patch),
      onRemove: (placed) => {
        this.ctx.design.removePart(placed);
        this.designChanged();
        this.ctx.log('info', 'Part removed.');
      },
      onClosed: () => this.highlightStage(null),
    });
  }

  private clearDesign(): void {
    this.ctx.design = new RocketDesign('Untitled Rocket');
    this.designChanged();
    this.ctx.log('info', 'Design cleared.');
  }

  private loadDefault(): void {
    this.ctx.design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
    this.designChanged();
    this.ctx.log('info', `Loaded default rocket "${this.ctx.design.name}".`);
  }

  private saveDesign(): void {
    const ok = this.ctx.saves.saveDesign(this.ctx.design.toData());
    this.ctx.log(ok ? 'info' : 'error', ok ? 'Design saved.' : 'Saving failed (storage unavailable).');
  }

  private loadDesign(): void {
    const data = this.ctx.saves.loadDesign();
    if (!data) {
      this.ctx.log('warn', 'No saved design found.');
      return;
    }
    this.ctx.design = RocketDesign.fromData(data);
    this.designChanged();
    this.ctx.log('info', `Loaded design "${data.name}".`);
  }

  private tryLaunch(): void {
    const check = validateDesign(this.ctx.design, this.ctx.catalog);
    if (!check.ok) {
      for (const problem of check.problems) this.ctx.log('warn', problem);
      return;
    }
    this.onLaunch();
  }

  // ------------------------------------------------------- customization --

  /**
   * Merge a customization patch into a placed part, with validation.
   * Dimension changes are applied "in place": parts stacked above shift by
   * the height delta so attachments stay exact; the whole result must stay
   * in bounds and overlap-free or the change is rejected.
   */
  private customizePart(placed: PlacedPartData, patch: PartCustomization): boolean {
    const def = this.ctx.catalog.get(placed.defId);
    if (!def) return false;

    const wantsResize = patch.widthCells !== undefined || patch.heightCells !== undefined;
    if (wantsResize && def.procedural) {
      const ok = this.tryResizePlaced(placed, def, {
        widthCells: patch.widthCells ?? placed.custom?.widthCells ?? def.widthCells,
        heightCells: patch.heightCells ?? placed.custom?.heightCells ?? def.heightCells,
      });
      if (!ok) return false;
    }

    if ('thrustLimiter' in patch) {
      const limiter = clampThrustLimiter(patch.thrustLimiter);
      placed.custom = { ...placed.custom, thrustLimiter: limiter === 1 ? undefined : limiter };
    }
    if ('igniteStage' in patch) {
      placed.custom = { ...placed.custom, igniteStage: patch.igniteStage };
      this.ctx.log(
        'info',
        patch.igniteStage === undefined
          ? `${def.name}: ignition stage reset to automatic.`
          : `${def.name}: ignites at stage ${patch.igniteStage}.`,
      );
    }
    if ('variant' in patch) {
      placed.custom = {
        ...placed.custom,
        variant: patch.variant === 'cone' ? undefined : patch.variant,
      };
      this.ctx.log('info', `${def.name}: shape set to ${patch.variant}.`);
    }
    if ('chute' in patch && patch.chute) {
      placed.custom = { ...placed.custom, chute: { ...patch.chute } };
      this.ctx.log(
        'info',
        `${def.name}: ${patch.chute.type}, Ø${patch.chute.diameterM} m, ` +
          `deploys below ${patch.chute.deployAltM} m (${patch.chute.material}).`,
      );
    }
    this.pruneCustom(placed);
    this.designChanged();
    return true;
  }

  private tryResizePlaced(
    placed: PlacedPartData,
    def: PartDefinition,
    wanted: ProceduralDimensions,
  ): boolean {
    const clamped = clampProceduralDimensions(def.procedural!, wanted);
    const old = resolvePlacedPart(placed, this.ctx.catalog)!.props;
    if (clamped.widthCells === old.widthCells && clamped.heightCells === old.heightCells) {
      return false;
    }
    const heightDelta = clamped.heightCells - old.heightCells;
    const oldTop = placed.yCells + old.heightCells;

    // Build a candidate design: resized part + everything above shifted.
    const candidates: PlacedPartData[] = this.ctx.design.parts.map((p) => {
      if (p === placed) {
        return { ...p, custom: { ...p.custom, ...clamped } };
      }
      if (p.yCells >= oldTop && heightDelta !== 0) {
        return { ...p, yCells: p.yCells + heightDelta };
      }
      return { ...p };
    });

    const candidateDesign = new RocketDesign('candidate', candidates);
    for (const candidate of candidates) {
      const resolved = resolvePlacedPart(candidate, this.ctx.catalog);
      if (!resolved) continue;
      const { widthCells, heightCells } = resolved.props;
      if (
        !inBounds(widthCells, heightCells, candidate.xCells, candidate.yCells) ||
        overlapsAnyPart(
          candidateDesign, this.ctx.catalog, widthCells, heightCells,
          candidate.xCells, candidate.yCells, candidate,
        )
      ) {
        this.ctx.log('warn', 'Resize rejected: parts would overlap or leave the grid.');
        return false;
      }
    }

    // Commit to the real design.
    placed.custom = { ...placed.custom, ...clamped };
    if (heightDelta !== 0) {
      for (const p of this.ctx.design.parts) {
        if (p !== placed && p.yCells >= oldTop) p.yCells += heightDelta;
      }
    }
    this.ctx.log(
      'info',
      `${def.name} resized to ${clamped.widthCells}×${clamped.heightCells}` +
        (heightDelta !== 0 ? ` (${heightDelta > 0 ? '+' : ''}${heightDelta} cells shifted above).` : '.'),
    );
    return true;
  }

  /** Drop custom fields that equal their defaults, keeping saves minimal. */
  private pruneCustom(placed: PlacedPartData): void {
    const c = placed.custom;
    if (!c) return;
    if (c.thrustLimiter === undefined) delete c.thrustLimiter;
    if (c.igniteStage === undefined) delete c.igniteStage;
    if (c.variant === undefined) delete c.variant;
    if (Object.values(c).every((v) => v === undefined)) placed.custom = undefined;
  }

  // --------------------------------------------------------- drag & drop --

  private startDrag(
    def: PartDefinition,
    custom: PartCustomization | undefined,
    e: PointerEvent,
  ): void {
    this.contextMenu.close();
    this.drag = { def, custom, props: resolvePartProps(def, custom), snap: null };
    window.addEventListener('pointermove', this.pointerMoveHandler);
    window.addEventListener('pointerup', this.pointerUpHandler);
    this.onPointerMove(e);
  }

  private stopDragListeners(): void {
    window.removeEventListener('pointermove', this.pointerMoveHandler);
    window.removeEventListener('pointerup', this.pointerUpHandler);
  }

  /**
   * Pointer down on the canvas: pick up a part under the cursor, otherwise
   * start panning the editor camera (two pointers pinch-zoom).
   */
  private onCanvasDown(e: PointerEvent): void {
    if (this.drag || e.button !== 0) return;
    const world = this.pointerToWorld(e);
    const cell = worldToCell(world);
    const placed = this.ctx.design.partAtCell(cell.xCells, cell.yCells, this.ctx.catalog);
    if (!placed) {
      // Empty grid: pan/pinch. TODO: box selection of multiple parts here
      // (needs a selection model + group move/duplicate; planned).
      this.panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        this.renderer.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* non-fatal */
      }
      return;
    }
    const def = this.ctx.catalog.get(placed.defId);
    if (!def) return;
    this.ctx.design.removePart(placed);
    this.designChanged();
    this.startDrag(def, placed.custom, e);
  }

  private onCanvasPanMove(e: PointerEvent): void {
    if (this.drag || !this.panPointers.has(e.pointerId)) return;
    const current = { x: e.clientX, y: e.clientY };

    if (this.panPointers.size === 1) {
      const previous = this.panPointers.get(e.pointerId)!;
      const s = this.camera.pxPerMeter;
      this.camera.center = this.camera.center.add(
        new Vec2(-(current.x - previous.x) / s, (current.y - previous.y) / s),
      );
      this.panPointers.set(e.pointerId, current);
    } else if (this.panPointers.size === 2) {
      // Pinch zoom (same approach as the map camera; TODO unify gestures).
      const [idA, idB] = [...this.panPointers.keys()];
      const a = this.panPointers.get(idA)!;
      const b = this.panPointers.get(idB)!;
      const prevDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.panPointers.set(e.pointerId, current);
      const a2 = this.panPointers.get(idA)!;
      const b2 = this.panPointers.get(idB)!;
      const dist = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (prevDist > 1 && dist > 1 && dist !== prevDist) {
        this.zoomAtScreen((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, dist / prevDist);
      }
    } else {
      this.panPointers.set(e.pointerId, current);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.zoomAtScreen(
      e.clientX - rect.left,
      e.clientY - rect.top,
      e.deltaY < 0 ? 1.15 : 1 / 1.15,
    );
  }

  /** Zoom keeping the world point under the cursor fixed. */
  private zoomAtScreen(screenX: number, screenY: number, factor: number): void {
    const w = this.renderer.viewWidth;
    const h = this.renderer.viewHeight;
    const before = this.camera.screenToWorld(screenX, screenY, w, h);
    this.camera.zoomBy(factor);
    const after = this.camera.screenToWorld(screenX, screenY, w, h);
    this.camera.center = this.camera.center.add(before.sub(after));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
      e.preventDefault();
      this.redo();
    }
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.drag) return;
    const world = this.pointerToWorld(e as unknown as PointerEvent);
    const cell = worldToCell(world);
    const placed = this.ctx.design.partAtCell(cell.xCells, cell.yCells, this.ctx.catalog);
    if (!placed) {
      this.contextMenu.close();
      return;
    }
    const def = this.ctx.catalog.get(placed.defId);
    if (!def || !this.lastRuntime) return;

    const index = this.ctx.design.parts.indexOf(placed);
    const instance = this.lastParts[index];
    this.contextMenu.open(
      e.clientX,
      e.clientY,
      placed,
      def,
      this.lastRuntime.totalStageCount,
      instance ? this.lastRuntime.defaultIgniteStageOf(instance) : 1,
    );
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag) return;
    const world = this.pointerToWorld(e);
    this.drag.snap = findSnap(this.ctx.design, this.ctx.catalog, this.drag, world);
    this.drawGhost();
  }

  private onPointerUp(_e: PointerEvent): void {
    if (!this.drag) return;
    const { def, custom, snap } = this.drag;
    this.drag = null;
    this.stopDragListeners();
    this.ghostG.clear();

    if (snap?.valid) {
      this.ctx.design.addPart(def.id, snap.xCells, snap.yCells, custom);
      // Mirror symmetry: also place the twin across the center column,
      // unless it would coincide with the original or collide.
      if (this.symmetryOn) {
        const props = resolvePartProps(def, custom);
        const mx = this.mirroredX(snap.xCells, props.widthCells);
        if (mx !== snap.xCells && this.canPlaceAt(props, mx, snap.yCells)) {
          this.ctx.design.addPart(def.id, mx, snap.yCells, custom ? { ...custom } : undefined);
        } else if (mx !== snap.xCells) {
          this.ctx.log('warn', 'Symmetry twin skipped: no room on the mirrored side.');
        }
      }
      this.designChanged();
    } else {
      this.ctx.log('info', `${def.name} discarded (no valid attachment).`);
    }
  }

  private pointerToWorld(e: { clientX: number; clientY: number }) {
    const rect = this.renderer.canvas.getBoundingClientRect();
    return this.camera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      this.renderer.viewWidth,
      this.renderer.viewHeight,
    );
  }

  // ------------------------------------------------------------- drawing --

  /**
   * Single funnel for "the design changed": redraw + all panels refresh +
   * an undo snapshot. Undo/redo restore snapshots and skip re-recording.
   */
  private designChanged(recordHistory = true): void {
    this.redrawParts();
    this.refreshEngineering();
    if (recordHistory) this.pushHistory();
  }

  // ---------------------------------------------------------- undo/redo --

  private pushHistory(): void {
    const snapshot = JSON.stringify(this.ctx.design.toData());
    if (this.history[this.historyIndex] === snapshot) return; // no-op change
    this.history.splice(this.historyIndex + 1); // drop the redo branch
    this.history.push(snapshot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  private undo(): void {
    if (this.historyIndex <= 0) {
      this.ctx.log('info', 'Nothing to undo.');
      return;
    }
    this.historyIndex--;
    this.restoreSnapshot();
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) {
      this.ctx.log('info', 'Nothing to redo.');
      return;
    }
    this.historyIndex++;
    this.restoreSnapshot();
  }

  private restoreSnapshot(): void {
    this.contextMenu.close();
    this.ctx.design = RocketDesign.fromData(JSON.parse(this.history[this.historyIndex]));
    this.designChanged(false);
  }

  // ------------------------------------------------------------ symmetry --

  /** Mirror a placement across the center column (x = 0). */
  private mirroredX(xCells: number, widthCells: number): number {
    return -(xCells + widthCells);
  }

  private canPlaceAt(props: { widthCells: number; heightCells: number }, x: number, y: number): boolean {
    return (
      inBounds(props.widthCells, props.heightCells, x, y) &&
      !overlapsAnyPart(this.ctx.design, this.ctx.catalog, props.widthCells, props.heightCells, x, y)
    );
  }

  private redrawParts(): void {
    this.partsLayer.removeChildren().forEach((c) => c.destroy());
    const cell = GRID_CELL_METERS;
    for (const placed of this.ctx.design.parts) {
      const resolved = resolvePlacedPart(placed, this.ctx.catalog);
      if (!resolved) continue;
      const g = buildPartGraphic(
        resolved.def,
        resolved.props.widthCells,
        resolved.props.heightCells,
        placed.custom?.variant,
      );
      g.position.set(placed.xCells * cell, placed.yCells * cell);
      this.partsLayer.addChild(g);
    }
  }

  private refreshEngineering(): void {
    this.comMarkerG.clear();
    this.highlightG.clear();
    if (this.ctx.design.isEmpty) {
      this.engineeringPanel.update(null, null);
      this.stagingPanel.update(null);
      this.lastParts = [];
      this.lastRuntime = null;
      this.lastWarnings = '';
      return;
    }

    try {
      this.lastParts = instantiateParts(this.ctx.design, this.ctx.catalog);
    } catch (err) {
      this.ctx.log('warn', `Analysis skipped: ${String(err)}`);
      this.engineeringPanel.update(null, null);
      this.stagingPanel.update(null);
      return;
    }
    // A throwaway runtime provides ignition defaults for the context menu;
    // the staging panel uses the shared fireStage walkthrough.
    this.lastRuntime = new RocketRuntime(this.lastParts);
    this.lastPreviews = previewStages(this.lastParts);

    const analysis = analyzeVehicle(this.lastParts, EARTH_CONFIG.surfaceGravity);
    this.engineeringPanel.update(analysis, summarizeHabitation(this.lastParts));
    this.stagingPanel.update(this.lastPreviews);

    const warningsKey = analysis.warnings.join('|');
    if (warningsKey !== this.lastWarnings) {
      for (const warning of analysis.warnings) this.ctx.log('warn', warning);
      this.lastWarnings = warningsKey;
    }

    if (analysis.centerOfMass) {
      this.drawComMarker(analysis.centerOfMass.xM, analysis.centerOfMass.yM);
    }
  }

  /** Stage preview: highlight the parts igniting in / separating at a stage. */
  private highlightStage(stage: number | null): void {
    const g = this.highlightG;
    g.clear();
    if (stage === null) return;
    const preview = this.lastPreviews[stage - 1];
    if (!preview) return;

    const cell = GRID_CELL_METERS;
    const members = new Set<PartInstance>(preview.ignites);
    for (const group of preview.separates) {
      for (const p of group) members.add(p);
    }
    for (const part of members) {
      g.rect(
        part.xCells * cell,
        part.yCells * cell,
        part.widthCells * cell,
        part.heightCells * cell,
      )
        .fill({ color: 0xffd94a, alpha: 0.22 })
        .stroke({ width: 0.07, color: 0xffd94a, alpha: 0.9 });
    }
  }

  /** Classic CoM symbol: circle with alternating quadrants. */
  private drawComMarker(xM: number, yM: number): void {
    const g = this.comMarkerG;
    const r = 0.28;
    g.circle(xM, yM, r).fill(0xffd94a).stroke({ width: 0.05, color: 0x10141f });
    g.poly([xM, yM, xM + r, yM, xM, yM + r]).fill(0x10141f);
    g.poly([xM, yM, xM - r, yM, xM, yM - r]).fill(0x10141f);
  }

  private drawGhost(): void {
    const g = this.ghostG;
    g.clear();
    if (!this.drag?.snap) return;
    const { props } = this.drag;
    const { xCells, yCells, valid } = this.drag.snap;
    const cell = GRID_CELL_METERS;
    g.rect(xCells * cell, yCells * cell, props.widthCells * cell, props.heightCells * cell)
      .fill({ color: this.drag.def.color, alpha: 0.4 })
      .stroke({ width: 0.06, color: valid ? 0x4dff7a : 0xff5252, alpha: 0.95 });
    for (const node of props.attachmentNodes) {
      g.circle((xCells + node.xCells) * cell, (yCells + node.yCells) * cell, 0.08)
        .fill(valid ? 0x4dff7a : 0xff5252);
    }
    // Symmetry twin preview across the center column.
    if (this.symmetryOn && valid) {
      const mx = this.mirroredX(xCells, props.widthCells);
      if (mx !== xCells) {
        const twinOk = this.canPlaceAt(props, mx, yCells);
        g.rect(mx * cell, yCells * cell, props.widthCells * cell, props.heightCells * cell)
          .fill({ color: this.drag.def.color, alpha: 0.25 })
          .stroke({ width: 0.06, color: twinOk ? 0x4dff7a : 0xff5252, alpha: 0.7 });
      }
    }
  }
}
