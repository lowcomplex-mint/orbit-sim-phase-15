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
import { legPose, poseInPartLocal, stackCoreCenterXCells } from '../vehicle/LandingLegs';
import { PartInstance } from '../vehicle/PartInstance';
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
import { analyzeDesignWarnings } from './DesignWarnings';
import {
  canMoveGroup,
  deleteGroup,
  duplicateGroup,
  expandGroupIds,
  moveGroup,
} from './GroupOps';
import { inBounds, overlapsAnyPart, worldToGrid } from './GridSystem';
import { formatSnapStep, snapValue } from './PlacementGrid';
import { PartContextMenu } from './PartContextMenu';
import { PartPalette } from './PartPalette';
import { partsInSelectionBox } from './SelectionBox';
import { RotateControls } from './RotateControls';
import { instantiateParts, validateDesign } from './RocketAssembler';
import { SnapControls } from './SnapControls';
import { findSnap, type DraggedPart, type SnapResult } from './SnapSystem';
import { StagingPanel } from './StagingPanel';
import { tryRotateSubtree, tryTranslateSubtree } from './TransformTool';
import {
  addToSubassemblyLibrary,
  extractSubassembly,
  loadSubassemblyLibrary,
  placeSubassemblyAuto,
  removeFromSubassemblyLibrary,
} from './Subassembly';
import { rerootDesign, subtreeParts } from '../vehicle/PartTree';
import { computeSymmetryTwin, findMirroredPart } from './Symmetry';

interface DragState extends DraggedPart {
  custom?: PartCustomization;
  snap: SnapResult | null;
}

type BuilderTool = 'place' | 'select' | 'transform' | 'rotate' | 'reroot';

interface TransformDrag {
  rootId: string;
  snapshots: { xCells: number; yCells: number }[];
  startGridX: number;
  startGridY: number;
}

interface BoxSelectionDrag {
  pointerId: number;
  start: Vec2;
  end: Vec2;
  additive: boolean;
  selectionBefore: Set<string>;
}

interface GroupDrag {
  pointerId: number;
  partIds: string[];
  startGridX: number;
  startGridY: number;
  dxCells: number;
  dyCells: number;
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
  private gridG = buildGridGraphic();
  private partsLayer = new Container();
  private ghostG = new Graphics();
  private comMarkerG = new Graphics();
  private selectionG = new Graphics();
  private highlightG = new Graphics();
  private camera = new CameraController(56, BUILDER.minPxPerMeter, BUILDER.maxPxPerMeter);

  private uiRoot!: HTMLDivElement;
  private palette!: PartPalette;
  private engineeringPanel!: EditorEngineeringPanel;
  private stagingPanel!: StagingPanel;
  private contextMenu!: PartContextMenu;
  private snapControls!: SnapControls;
  private rotateControls!: RotateControls;
  private drag: DragState | null = null;
  private toolMode: BuilderTool = 'place';
  private selectedPartId: string | null = null;
  private transformDrag: TransformDrag | null = null;
  private selectedPartIds = new Set<string>();
  private boxSelection: BoxSelectionDrag | null = null;
  private groupDrag: GroupDrag | null = null;
  private selectionToolbar!: HTMLDivElement;
  private selectionCountEl!: HTMLSpanElement;
  private toolBtns: Record<BuilderTool, HTMLButtonElement> | null = null;
  private hintEl!: HTMLDivElement;
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
  private readonly canvasUpHandler = (e: PointerEvent) => this.onCanvasUp(e);
  private readonly canvasCancelHandler = (e: PointerEvent) => this.onCanvasCancel(e);
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
    this.selectionG = new Graphics();
    this.highlightG = new Graphics();
    this.gridG = buildGridGraphic();
    this.root.addChild(
      this.gridG,
      this.partsLayer,
      this.selectionG,
      this.highlightG,
      this.comMarkerG,
      this.ghostG,
    );
    this.renderer.worldRoot.addChild(this.root);

    this.buildUi();
    this.renderer.canvas.addEventListener('pointerdown', this.canvasDownHandler);
    this.renderer.canvas.addEventListener('pointermove', this.canvasMoveHandler);
    this.renderer.canvas.addEventListener('pointerup', this.canvasUpHandler);
    this.renderer.canvas.addEventListener('pointercancel', this.canvasCancelHandler);
    this.renderer.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    this.renderer.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    window.addEventListener('keydown', this.keyHandler);

    this.history = [];
    this.historyIndex = -1;
    this.panPointers.clear();
    this.selectedPartIds.clear();
    this.boxSelection = null;
    this.groupDrag = null;
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
    this.renderer.canvas.removeEventListener('pointercancel', this.canvasCancelHandler);
    this.renderer.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    this.renderer.canvas.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('keydown', this.keyHandler);
    this.stopDragListeners();
    this.drag = null;
    this.contextMenu.destroy();
    this.snapControls.destroy();
    this.rotateControls.destroy();
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
    );
    this.snapControls = new SnapControls(toolbar, (step) => {
      this.rebuildGrid(step);
      this.ctx.log('info', `Placement snap: ${formatSnapStep(step)}.`);
    });
    this.rotateControls = new RotateControls(toolbar, (step) => {
      this.ctx.log('info', `Rotation step: ${step}° (stack mounts always quantize to 90°).`);
    });
    this.rotateControls.setEnabled(true);
    const toolRow = createRow('toolbar-tools');
    this.toolBtns = {
      place: createButton('Place', () => this.setTool('place'), { title: 'Place parts (default)' }),
      select: createButton('Select', () => this.setTool('select'), {
        title: 'Box-select parts (hold Shift from any tool)',
      }),
      transform: createButton('Move', () => this.setTool('transform'), { title: 'Move part + subtree' }),
      rotate: createButton('Rotate', () => this.setTool('rotate'), {
        title: 'Rotate subtree about mount joint (Q/E · ↺/↻)',
      }),
      reroot: createButton('Root', () => this.setTool('reroot'), { title: 'Set tree root part' }),
    };
    toolRow.append(
      this.toolBtns.place,
      this.toolBtns.select,
      this.toolBtns.transform,
      this.toolBtns.rotate,
      this.toolBtns.reroot,
      createButton('↺', () => this.applyRotation(-this.rotateControls.rotateStep), {
        title: 'Rotate CCW (Q)',
      }),
      createButton('↻', () => this.applyRotation(this.rotateControls.rotateStep), {
        title: 'Rotate CW (E)',
      }),
      createButton('SUB+', () => this.saveSelectionAsSubassembly(), {
        title: 'Save selection as subassembly',
      }),
      createButton('SUB…', () => this.placeSubassemblyFromLibrary(), {
        title: 'Place a saved subassembly',
      }),
    );
    toolbar.append(
      createButton('Clear', () => this.clearDesign()),
      createButton('Default', () => this.loadDefault()),
      createButton('Save', () => this.saveDesign()),
      createButton('Load', () => this.loadDesign()),
      createButton('LAUNCH', () => this.tryLaunch(), { className: 'primary' }),
    );

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'hint';

    this.selectionToolbar = document.createElement('div');
    this.selectionToolbar.className = 'sel-toolbar';
    this.selectionToolbar.hidden = true;
    this.selectionCountEl = document.createElement('span');
    this.selectionCountEl.className = 'sel-count';
    this.selectionToolbar.append(
      this.selectionCountEl,
      createButton('DUP', () => this.duplicateSelection(), {
        className: 'small',
        title: 'Duplicate selection (Ctrl+D)',
      }),
      createButton('DEL', () => this.deleteSelection(), {
        className: 'small danger',
        title: 'Delete selection (Delete)',
      }),
      createButton('SUB', () => this.saveSelectionAsSubassembly(), {
        className: 'small',
        title: 'Save selection as subassembly',
      }),
      createButton(
        '✕',
        () => {
          this.selectedPartIds.clear();
          this.drawSelection();
        },
        { className: 'small', title: 'Clear selection' },
      ),
    );

    this.uiRoot.append(toolbar, toolRow, this.hintEl, this.selectionToolbar);
    this.setTool('place');
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
        const twinRemoved = this.removePartAndSymmetryTwin(placed);
        this.designChanged();
        this.ctx.log(
          'info',
          twinRemoved ? 'Part and its symmetry twin removed.' : 'Part removed.',
        );
      },
      onClosed: () => this.highlightStage(null),
    });
  }

  /**
   * Remove a part and, if present, its geometric SYM twin (same def, mirrored
   * footprint). Used on pick-up and delete so moving one side of a pair does
   * not leave an orphaned mirror behind.
   * @returns true when a twin was also removed
   */
  private removePartAndSymmetryTwin(placed: PlacedPartData): boolean {
    const twin = findMirroredPart(this.ctx.design, this.ctx.catalog, placed);
    this.ctx.design.removePart(placed);
    if (twin && this.ctx.design.parts.includes(twin)) {
      this.ctx.design.removePart(twin);
      return true;
    }
    return false;
  }

  private setTool(mode: BuilderTool): void {
    this.toolMode = mode;
    this.transformDrag = null;
    this.ghostG.clear();
    if (mode !== 'transform' && mode !== 'rotate') this.selectedPartId = null;
    for (const [key, btn] of Object.entries(this.toolBtns ?? {})) {
      btn.classList.toggle('active', key === mode);
    }
    const hints: Record<BuilderTool, string> = {
      place: 'Drag parts to build · right-click configures · Snap for fine placement · pan/zoom empty space.',
      select: 'Drag a box over parts · click toggles · switch to Move and drag a selected part · SUB saves subassembly.',
      transform: 'Click a part and drag to move it with its subtree · respects Snap step.',
      rotate:
        'Click a part · ↺/↻ or Q/E rotate about its mount joint · stack snaps to 90° · radial uses Rot step.',
      reroot: 'Click a part to make it the tree root · staging order is unchanged.',
    };
    this.hintEl.textContent = hints[mode];
    this.drawSelection();
  }

  private applyRotation(deltaDeg: number): void {
    if (!this.selectedPartId) {
      this.ctx.log('info', 'Select a part first (Rotate tool).');
      return;
    }
    if (
      tryRotateSubtree(
        this.ctx.design,
        this.ctx.catalog,
        this.selectedPartId,
        deltaDeg,
        this.rotateControls.rotateStep,
      )
    ) {
      this.designChanged();
      this.ctx.log('info', `Rotated subtree (${deltaDeg > 0 ? '+' : ''}${deltaDeg}° requested).`);
    } else {
      this.ctx.log('warn', 'Rotation rejected: overlap, out of bounds, or joint would break.');
    }
  }

  private saveSelectionAsSubassembly(): void {
    const ids =
      this.selectedPartIds.size > 0
        ? [...this.selectedPartIds]
        : this.selectedPartId
          ? [this.selectedPartId]
          : [];
    if (ids.length === 0) {
      this.ctx.log('info', 'Select parts first (Select tool or Rotate selection).');
      return;
    }
    const name =
      typeof window !== 'undefined'
        ? window.prompt('Subassembly name', 'My Subassembly')
        : 'My Subassembly';
    if (name === null) return;
    const data = extractSubassembly(this.ctx.design, this.ctx.catalog, ids, name);
    if (!data) {
      this.ctx.log('warn', 'Could not extract subassembly from selection.');
      return;
    }
    if (addToSubassemblyLibrary(data)) {
      this.ctx.log(
        'info',
        `Saved subassembly "${data.name}" (${data.parts.length} part(s)). Use SUB… to place.`,
      );
    } else {
      this.ctx.log('error', 'Could not save subassembly (storage unavailable).');
    }
  }

  private placeSubassemblyFromLibrary(): void {
    const list = loadSubassemblyLibrary();
    if (list.length === 0) {
      this.ctx.log('info', 'No saved subassemblies. Select parts and use SUB+ / SUB to save.');
      return;
    }
    const lines = list.map((s, i) => `${i + 1}. ${s.name} (${s.parts.length} parts)`).join('\n');
    const answer =
      typeof window !== 'undefined'
        ? window.prompt(`Place which subassembly?\n${lines}\n\nEnter number (or -N to delete):`, '1')
        : '1';
    if (answer === null) return;
    const n = Number.parseInt(answer.trim(), 10);
    if (!Number.isFinite(n) || n === 0) {
      this.ctx.log('warn', 'Invalid subassembly choice.');
      return;
    }
    if (n < 0) {
      const idx = -n - 1;
      if (removeFromSubassemblyLibrary(idx)) {
        this.ctx.log('info', 'Subassembly removed from library.');
      } else {
        this.ctx.log('warn', 'Could not remove subassembly.');
      }
      return;
    }
    const data = list[n - 1];
    if (!data) {
      this.ctx.log('warn', 'No subassembly at that number.');
      return;
    }
    const placed = placeSubassemblyAuto(this.ctx.design, this.ctx.catalog, data);
    if (!placed) {
      this.ctx.log('warn', 'No free space to place subassembly.');
      return;
    }
    this.selectedPartIds = new Set(placed.map((p) => p.id!).filter(Boolean));
    this.designChanged();
    this.ctx.log(
      'info',
      `Placed "${data.name}" (${placed.length} parts) — snap onto the craft to attach.`,
    );
  }

  private clearDesign(): void {
    this.cancelSelectionGesture();
    this.ctx.design = new RocketDesign('Untitled Rocket');
    this.selectedPartIds.clear();
    this.designChanged();
    this.ctx.log('info', 'Design cleared.');
  }

  private loadDefault(): void {
    this.cancelSelectionGesture();
    this.ctx.design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
    this.selectedPartIds.clear();
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
    this.cancelSelectionGesture();
    this.ctx.design = RocketDesign.fromData(data);
    this.selectedPartIds.clear();
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
    // Launch clamps: height/umbilical without a full procedural config.
    if (def.category === 'clamp' && (wantsResize || patch.clampUmbilicalCells !== undefined)) {
      const next = {
        ...placed.custom,
        heightCells: patch.heightCells ?? placed.custom?.heightCells,
        clampUmbilicalCells: patch.clampUmbilicalCells ?? placed.custom?.clampUmbilicalCells,
      };
      const before = resolvePartProps(def, placed.custom);
      const after = resolvePartProps(def, next);
      // Tentatively apply and reject if the new footprint collides.
      const prevCustom = placed.custom;
      placed.custom = next;
      const blocked = overlapsAnyPart(
        this.ctx.design,
        this.ctx.catalog,
        after.widthCells,
        after.heightCells,
        placed.xCells,
        placed.yCells,
        placed,
      );
      if (blocked || !inBounds(after.widthCells, after.heightCells, placed.xCells, placed.yCells)) {
        placed.custom = prevCustom;
        this.ctx.log('warn', 'Clamp resize rejected: no room.');
        return false;
      }
      this.ctx.log(
        'info',
        `${def.name}: tower ${after.heightCells} × umbilical ${after.widthCells}` +
          (before.heightCells !== after.heightCells || before.widthCells !== after.widthCells
            ? ''
            : ''),
      );
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

  /** Cancel a marquee/group gesture so a later pointer-up cannot commit it. */
  private cancelSelectionGesture(restoreBoxSelection = true): boolean {
    const box = this.boxSelection;
    const group = this.groupDrag;
    if (!box && !group) return false;

    if (box && restoreBoxSelection) {
      this.selectedPartIds = new Set(box.selectionBefore);
    }
    this.boxSelection = null;
    this.groupDrag = null;
    for (const pointerId of [box?.pointerId, group?.pointerId]) {
      if (pointerId === undefined) continue;
      try {
        if (this.renderer.canvas.hasPointerCapture(pointerId)) {
          this.renderer.canvas.releasePointerCapture(pointerId);
        }
      } catch {
        /* capture may already have been released by the browser */
      }
    }
    this.drawSelection();
    return true;
  }

  /** Route selection, graph transforms, normal pickup, and camera gestures. */
  private onCanvasDown(e: PointerEvent): void {
    if (
      this.drag ||
      this.transformDrag ||
      this.boxSelection ||
      this.groupDrag ||
      e.button !== 0
    ) {
      return;
    }
    const world = this.pointerToWorld(e);
    const grid = worldToGrid(world);
    const placed = this.ctx.design.partAtGrid(grid.xCells, grid.yCells, this.ctx.catalog);

    // Select is an explicit touch-friendly tool; Shift temporarily invokes it
    // from every other tool without stealing the normal empty-space pan.
    if (this.toolMode === 'select' || e.shiftKey) {
      if (placed?.id) {
        if (this.selectedPartIds.has(placed.id)) this.selectedPartIds.delete(placed.id);
        else this.selectedPartIds.add(placed.id);
        this.selectedPartId = null;
        this.drawSelection();
        return;
      }
      const selectionBefore = new Set(this.selectedPartIds);
      if (!e.shiftKey) this.selectedPartIds.clear();
      this.boxSelection = {
        pointerId: e.pointerId,
        start: world,
        end: world,
        additive: e.shiftKey,
        selectionBefore,
      };
      try {
        this.renderer.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* non-fatal */
      }
      this.drawSelection();
      return;
    }

    if (this.toolMode === 'reroot') {
      if (placed?.id && rerootDesign(this.ctx.design, placed.id)) {
        this.selectedPartId = placed.id;
        this.designChanged();
        this.ctx.log('info', 'Tree root updated.');
      }
      return;
    }

    if (this.toolMode === 'rotate') {
      this.selectedPartId = placed?.id ?? null;
      this.drawSelection();
      if (!placed) this.ctx.log('info', 'Click a part to select for rotation.');
      return;
    }

    if (this.toolMode === 'transform') {
      if (!placed?.id) {
        this.panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try {
          this.renderer.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* non-fatal */
        }
        return;
      }

      if (this.selectedPartIds.has(placed.id) && this.selectedPartIds.size > 0) {
        const affectedIds = expandGroupIds(this.ctx.design, [...this.selectedPartIds]);
        this.selectedPartIds = new Set(affectedIds);
        this.selectedPartId = null;
        this.groupDrag = {
          pointerId: e.pointerId,
          partIds: affectedIds,
          startGridX: grid.xCells,
          startGridY: grid.yCells,
          dxCells: 0,
          dyCells: 0,
        };
        try {
          this.renderer.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* non-fatal */
        }
        this.drawSelection();
        return;
      }

      this.selectedPartIds.clear();
      this.selectedPartId = placed.id;
      const members = subtreeParts(this.ctx.design, placed.id);
      this.transformDrag = {
        rootId: placed.id,
        snapshots: members.map((p) => ({ xCells: p.xCells, yCells: p.yCells })),
        startGridX: grid.xCells,
        startGridY: grid.yCells,
      };
      window.addEventListener('pointermove', this.pointerMoveHandler);
      window.addEventListener('pointerup', this.pointerUpHandler);
      this.drawSelection();
      return;
    }

    // Place tool: pick up part under cursor, otherwise pan.
    if (!placed) {
      if (this.selectedPartIds.size > 0) {
        this.selectedPartIds.clear();
        this.drawSelection();
      }
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
    this.selectedPartIds.clear();
    // Drop the geometric SYM twin too — otherwise re-placing with symmetry
    // stacks a second twin, or the old twin sits orphaned after a move.
    this.removePartAndSymmetryTwin(placed);
    this.designChanged();
    this.startDrag(def, placed.custom, e);
  }

  private onCanvasPanMove(e: PointerEvent): void {
    if (this.drag) return;
    if (this.boxSelection?.pointerId === e.pointerId) {
      this.boxSelection.end = this.pointerToWorld(e);
      this.drawSelection();
      return;
    }
    if (this.groupDrag?.pointerId === e.pointerId) {
      const grid = worldToGrid(this.pointerToWorld(e));
      const step = this.snapControls.snapStep;
      this.groupDrag.dxCells = snapValue(grid.xCells - this.groupDrag.startGridX, step);
      this.groupDrag.dyCells = snapValue(grid.yCells - this.groupDrag.startGridY, step);
      this.drawSelection();
      return;
    }
    if (!this.panPointers.has(e.pointerId)) return;
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

  private onCanvasUp(e: PointerEvent): void {
    this.panPointers.delete(e.pointerId);

    if (this.boxSelection?.pointerId === e.pointerId) {
      const box = this.boxSelection;
      this.boxSelection = null;
      if (!box.additive) this.selectedPartIds.clear();
      for (const id of partsInSelectionBox(
        this.ctx.design,
        this.ctx.catalog,
        box.start,
        box.end,
      )) this.selectedPartIds.add(id);
      this.drawSelection();
      this.ctx.log('info', `${this.selectedPartIds.size} part(s) selected.`);
      return;
    }

    if (this.groupDrag?.pointerId === e.pointerId) {
      const drag = this.groupDrag;
      this.groupDrag = null;
      if (drag.dxCells !== 0 || drag.dyCells !== 0) {
        if (
          moveGroup(
            this.ctx.design,
            this.ctx.catalog,
            drag.partIds,
            drag.dxCells,
            drag.dyCells,
          )
        ) {
          this.designChanged();
          this.ctx.log(
            'info',
            `Moved ${drag.partIds.length} part(s) (${drag.dxCells > 0 ? '+' : ''}${drag.dxCells}, ` +
              `${drag.dyCells > 0 ? '+' : ''}${drag.dyCells}).`,
          );
        } else {
          this.ctx.log('warn', 'Group move rejected: overlap or builder bounds.');
        }
      }
      this.drawSelection();
    }
  }

  private onCanvasCancel(e: PointerEvent): void {
    this.panPointers.delete(e.pointerId);
    if (this.boxSelection?.pointerId === e.pointerId) {
      this.selectedPartIds = new Set(this.boxSelection.selectionBefore);
      this.boxSelection = null;
    }
    if (this.groupDrag?.pointerId === e.pointerId) this.groupDrag = null;
    this.drawSelection();
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
    const target = e.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if (e.code === 'Delete' && this.selectedPartIds.size > 0) {
      e.preventDefault();
      this.cancelSelectionGesture();
      this.deleteSelection();
      return;
    }
    if (e.code === 'Escape' && this.cancelSelectionGesture()) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' && this.selectedPartIds.size > 0) {
      e.preventDefault();
      this.selectedPartIds.clear();
      this.drawSelection();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
        e.preventDefault();
        this.redo();
      } else if (e.code === 'KeyD' && this.selectedPartIds.size > 0) {
        e.preventDefault();
        this.cancelSelectionGesture();
        this.duplicateSelection();
      }
      return;
    }
    if (this.toolMode === 'rotate' && this.selectedPartId) {
      if (e.code === 'KeyQ') {
        e.preventDefault();
        this.applyRotation(-this.rotateControls.rotateStep);
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        this.applyRotation(this.rotateControls.rotateStep);
      }
    }
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.drag) return;
    const world = this.pointerToWorld(e as unknown as PointerEvent);
    const grid = worldToGrid(world);
    const placed = this.ctx.design.partAtGrid(grid.xCells, grid.yCells, this.ctx.catalog);
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
    if (this.transformDrag) {
      this.drawTransformPreview(e);
      return;
    }
    if (!this.drag) return;
    const world = this.pointerToWorld(e);
    this.drag.snap = findSnap(
      this.ctx.design,
      this.ctx.catalog,
      this.drag,
      world,
      this.snapControls.snapStep,
    );
    this.drawGhost();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.transformDrag) {
      const drag = this.transformDrag;
      this.transformDrag = null;
      this.stopDragListeners();
      this.ghostG.clear();
      const members = subtreeParts(this.ctx.design, drag.rootId);
      for (let i = 0; i < members.length; i++) {
        members[i].xCells = drag.snapshots[i].xCells;
        members[i].yCells = drag.snapshots[i].yCells;
      }
      const grid = worldToGrid(this.pointerToWorld(e));
      const step = this.snapControls.snapStep;
      const dx = snapValue(grid.xCells - drag.startGridX, step);
      const dy = snapValue(grid.yCells - drag.startGridY, step);
      if (dx !== 0 || dy !== 0) {
        if (tryTranslateSubtree(this.ctx.design, this.ctx.catalog, drag.rootId, dx, dy)) {
          this.designChanged();
          this.ctx.log('info', `Moved subtree (${dx > 0 ? '+' : ''}${dx}, ${dy > 0 ? '+' : ''}${dy}).`);
        } else {
          this.ctx.log('warn', 'Move rejected: parts would overlap or leave the grid.');
          this.redrawParts();
        }
      }
      this.drawSelection();
      return;
    }
    if (!this.drag) return;
    const { def, custom, snap } = this.drag;
    this.drag = null;
    this.stopDragListeners();
    this.ghostG.clear();

    if (snap?.valid) {
      this.ctx.design.addPart(def.id, snap.xCells, snap.yCells, custom, snap.parentId ?? null);
      // Mirror symmetry: re-snap the twin (left↔right nodes), not just X-flip.
      if (this.symmetryOn) {
        const props = resolvePartProps(def, custom);
        const twin = computeSymmetryTwin(
          this.ctx.design,
          this.ctx.catalog,
          props,
          snap.xCells,
          snap.yCells,
          snap.parentId,
          snap.parentNodeIndex,
          snap.childNodeIndex,
        );
        if (twin.valid && !twin.isIdentity) {
          this.ctx.design.addPart(
            def.id,
            twin.xCells,
            twin.yCells,
            custom ? { ...custom } : undefined,
            twin.parentId,
          );
        } else if (!twin.isIdentity) {
          this.ctx.log(
            'warn',
            `Symmetry twin skipped: ${twin.reason ?? 'no valid mirrored placement'}.`,
          );
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

  /** Rebuild the background grid when the snap step changes. */
  private rebuildGrid(snapStep: number): void {
    this.gridG.destroy();
    this.gridG = buildGridGraphic(snapStep);
    this.root.addChildAt(this.gridG, 0);
  }

  /**
   * Single funnel for "the design changed": redraw + all panels refresh +
   * an undo snapshot. Undo/redo restore snapshots and skip re-recording.
   */
  private designChanged(recordHistory = true): void {
    this.redrawParts();
    this.refreshEngineering();
    this.drawSelection();
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
    this.cancelSelectionGesture();
    if (this.historyIndex <= 0) {
      this.ctx.log('info', 'Nothing to undo.');
      return;
    }
    this.historyIndex--;
    this.restoreSnapshot();
  }

  private redo(): void {
    this.cancelSelectionGesture();
    if (this.historyIndex >= this.history.length - 1) {
      this.ctx.log('info', 'Nothing to redo.');
      return;
    }
    this.historyIndex++;
    this.restoreSnapshot();
  }

  private restoreSnapshot(): void {
    this.cancelSelectionGesture();
    this.contextMenu.close();
    this.ctx.design = RocketDesign.fromData(JSON.parse(this.history[this.historyIndex]));
    this.designChanged(false);
  }

  // ------------------------------------------------------------ symmetry --

  /** Bottom-center column of the design (same frame as flight stack origin). */
  private designStackOrigin(): { xCells: number; yCells: number } {
    if (this.ctx.design.isEmpty) return { xCells: 0, yCells: 0 };
    let bottom = this.ctx.design.parts[0];
    for (const placed of this.ctx.design.parts) {
      const resolved = resolvePlacedPart(placed, this.ctx.catalog);
      if (!resolved) continue;
      if (placed.yCells < bottom.yCells) bottom = placed;
    }
    const resolved = resolvePlacedPart(bottom, this.ctx.catalog);
    const w = resolved?.props.widthCells ?? 1;
    return { xCells: bottom.xCells + w / 2, yCells: bottom.yCells };
  }

  private redrawParts(): void {
    this.partsLayer.removeChildren().forEach((c) => c.destroy());
    const cell = GRID_CELL_METERS;
    const origin = this.designStackOrigin();
    const baseXM = origin.xCells * cell;
    const baseYM = origin.yCells * cell;
    // Core column for leg outward sign — not the bottom-most part (a clamp
    // on the left would otherwise flip both struts the same way).
    const coreCenterX = stackCoreCenterXCells(
      this.ctx.design.parts.map((p) => {
        const r = resolvePlacedPart(p, this.ctx.catalog);
        return {
          xCells: p.xCells,
          widthCells: r?.props.widthCells ?? 1,
          category: r?.def.category ?? 'utility',
        };
      }),
    );
    for (const placed of this.ctx.design.parts) {
      const resolved = resolvePlacedPart(placed, this.ctx.catalog);
      if (!resolved) continue;
      const { widthCells, heightCells } = resolved.props;
      let legPosePart: ReturnType<typeof poseInPartLocal> | undefined;
      if (resolved.def.category === 'legs') {
        const inst = new PartInstance(
          resolved.def,
          placed.xCells,
          placed.yCells,
          placed.custom,
          placed.rotationDeg ?? 0,
        );
        legPosePart = poseInPartLocal(
          legPose(inst, 'stowed', baseXM, baseYM, coreCenterX),
          inst,
          baseXM,
          baseYM,
        );
      }
      const g = buildPartGraphic(
        resolved.def,
        widthCells,
        heightCells,
        placed.custom?.variant,
        'stowed',
        legPosePart,
      );
      const rot = placed.rotationDeg ?? 0;
      if (rot !== 0) {
        const w = widthCells * cell;
        const h = heightCells * cell;
        g.pivot.set(w / 2, h / 2);
        g.position.set(placed.xCells * cell + w / 2, placed.yCells * cell + h / 2);
        g.rotation = (rot * Math.PI) / 180;
      } else {
        g.position.set(placed.xCells * cell, placed.yCells * cell);
      }
      this.partsLayer.addChild(g);
    }
  }

  private drawSelection(): void {
    const validIds = new Set(
      this.ctx.design.parts.map((part) => part.id).filter((id): id is string => Boolean(id)),
    );
    for (const id of [...this.selectedPartIds]) {
      if (!validIds.has(id)) this.selectedPartIds.delete(id);
    }
    if (this.selectedPartId && !validIds.has(this.selectedPartId)) this.selectedPartId = null;

    const g = this.selectionG;
    g.clear();
    const cell = GRID_CELL_METERS;
    const rootId = this.ctx.design.rootPartId;
    const groupDx = this.groupDrag?.dxCells ?? 0;
    const groupDy = this.groupDrag?.dyCells ?? 0;
    const groupPreviewValid =
      !this.groupDrag ||
      (groupDx === 0 && groupDy === 0) ||
      canMoveGroup(
        this.ctx.design,
        this.ctx.catalog,
        this.groupDrag.partIds,
        groupDx,
        groupDy,
      );

    for (const placed of this.ctx.design.parts) {
      const resolved = resolvePlacedPart(placed, this.ctx.catalog);
      if (!resolved) continue;
      const { widthCells, heightCells } = resolved.props;
      const isRoot = placed.id === rootId;
      const isSelected = placed.id === this.selectedPartId;
      const isGroupSelected = Boolean(placed.id && this.selectedPartIds.has(placed.id));
      if (!isRoot && !isSelected && !isGroupSelected) continue;

      const x = placed.xCells * cell;
      const y = placed.yCells * cell;
      const w = widthCells * cell;
      const h = heightCells * cell;
      const color = isGroupSelected ? 0x63d4ff : isSelected ? 0x4dff7a : 0x6eb5ff;
      g.rect(x, y, w, h)
        .fill({ color, alpha: isSelected || isGroupSelected ? 0.18 : 0.1 })
        .stroke({ width: 0.07, color, alpha: 0.95 });

      if (isGroupSelected && (groupDx !== 0 || groupDy !== 0)) {
        const previewColor = groupPreviewValid ? 0x4dff7a : 0xff5252;
        g.rect(x + groupDx * cell, y + groupDy * cell, w, h)
          .fill({ color: previewColor, alpha: 0.24 })
          .stroke({ width: 0.06, color: previewColor, alpha: 0.9 });
      }
      if (isRoot) {
        g.circle(x + w / 2, y + h + 0.15, 0.12).fill(0x6eb5ff).stroke({ width: 0.04, color: 0x0c111d });
      }
    }

    if (this.boxSelection) {
      const { start, end } = this.boxSelection;
      g.rect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      )
        .fill({ color: 0x63d4ff, alpha: 0.08 })
        .stroke({ width: 0.06, color: 0x63d4ff, alpha: 0.8 });
    }

    this.selectionToolbar.hidden = this.selectedPartIds.size === 0;
    this.selectionCountEl.textContent = `${this.selectedPartIds.size} selected`;
  }

  private duplicateSelection(): void {
    const copies = duplicateGroup(
      this.ctx.design,
      this.ctx.catalog,
      [...this.selectedPartIds],
    );
    if (!copies) {
      this.ctx.log('warn', 'Duplicate rejected: no free space around the selection.');
      return;
    }
    this.selectedPartIds = new Set(
      copies.map((part) => part.id).filter((id): id is string => Boolean(id)),
    );
    this.selectedPartId = null;
    this.designChanged();
    this.ctx.log('info', `Duplicated ${copies.length} part(s); move the detached copy onto a mount.`);
  }

  private deleteSelection(): void {
    const ids = [...this.selectedPartIds];
    if (ids.length === 0) return;
    const removed = deleteGroup(this.ctx.design, this.ctx.catalog, ids);
    if (removed === 0) return;
    this.selectedPartIds.clear();
    if (this.selectedPartId && ids.includes(this.selectedPartId)) this.selectedPartId = null;
    this.designChanged();
    this.ctx.log('info', `Deleted ${removed} selected part(s).`);
  }

  private drawTransformPreview(e: PointerEvent): void {
    const drag = this.transformDrag;
    if (!drag) return;
    const grid = worldToGrid(this.pointerToWorld(e));
    const step = this.snapControls.snapStep;
    const dx = snapValue(grid.xCells - drag.startGridX, step);
    const dy = snapValue(grid.yCells - drag.startGridY, step);
    const g = this.ghostG;
    g.clear();
    const cell = GRID_CELL_METERS;
    const members = subtreeParts(this.ctx.design, drag.rootId);
    for (let i = 0; i < members.length; i++) {
      members[i].xCells = drag.snapshots[i].xCells;
      members[i].yCells = drag.snapshots[i].yCells;
    }
    const valid =
      (dx === 0 && dy === 0) ||
      tryTranslateSubtree(this.ctx.design, this.ctx.catalog, drag.rootId, dx, dy);
    if (dx !== 0 || dy !== 0) {
      for (let i = 0; i < members.length; i++) {
        members[i].xCells = drag.snapshots[i].xCells;
        members[i].yCells = drag.snapshots[i].yCells;
      }
    }
    const color = valid ? 0x4dff7a : 0xff5252;
    for (let i = 0; i < members.length; i++) {
      const resolved = resolvePlacedPart(members[i], this.ctx.catalog);
      if (!resolved) continue;
      const { widthCells, heightCells } = resolved.props;
      g.rect(
        (drag.snapshots[i].xCells + dx) * cell,
        (drag.snapshots[i].yCells + dy) * cell,
        widthCells * cell,
        heightCells * cell,
      )
        .fill({ color, alpha: 0.3 })
        .stroke({ width: 0.06, color, alpha: 0.9 });
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
      this.ctx.design.ensureTree(this.ctx.catalog, this.lastParts);
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
    const designWarnings = analyzeDesignWarnings(this.ctx.design, this.ctx.catalog);
    this.engineeringPanel.update(
      analysis,
      summarizeHabitation(this.lastParts),
      designWarnings,
    );
    this.stagingPanel.update(this.lastPreviews);

    const warningMessages = [
      ...analysis.warnings,
      ...designWarnings.map((warning) => warning.message),
    ];
    const warningsKey = warningMessages.join('|');
    if (warningsKey !== this.lastWarnings) {
      for (const warning of warningMessages) this.ctx.log('warn', warning);
      this.lastWarnings = warningsKey;
    }

    if (analysis.centerOfMass) {
      this.drawComMarker(analysis.centerOfMass.xM, analysis.centerOfMass.yM);
    }
  }

  /** Stage preview: highlight the parts igniting in / separating at a stage. */
  private highlightStage(stage: number | null): void {
    if (stage === null) {
      this.highlightG.clear();
      return;
    }
    const g = this.highlightG;
    g.clear();
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
    // Symmetry twin preview (same placement logic as drop).
    if (this.symmetryOn && valid) {
      const twin = computeSymmetryTwin(
        this.ctx.design,
        this.ctx.catalog,
        props,
        xCells,
        yCells,
        this.drag.snap.parentId,
        this.drag.snap.parentNodeIndex,
        this.drag.snap.childNodeIndex,
      );
      if (!twin.isIdentity) {
        g.rect(
          twin.xCells * cell,
          twin.yCells * cell,
          props.widthCells * cell,
          props.heightCells * cell,
        )
          .fill({ color: this.drag.def.color, alpha: 0.25 })
          .stroke({
            width: 0.06,
            color: twin.valid ? 0x4dff7a : 0xff5252,
            alpha: 0.7,
          });
      }
    }
  }
}
