import { formatMass } from '../math/Units';
import type { PartDefinition } from '../vehicle/PartDefinition';
import {
  clampProceduralDimensions,
  resolvePartProps,
  type ProceduralDimensions,
} from '../vehicle/ProceduralPart';

/** Pixels of travel before we decide scroll vs part-drag. */
const DRAG_SLOP_PX = 10;

/**
 * The scrollable part list. Drag starts only after the pointer moves off the
 * scroll axis (or leaves the palette), so touch users can pan the tray.
 * BuilderScene owns drag state and the ghost preview.
 *
 * Procedural parts get W/H stepper buttons on their card; the chosen size is
 * passed along when a drag starts and the card's stats update live.
 */
export class PartPalette {
  readonly root: HTMLDivElement;
  /** Currently selected dimensions per procedural part id. */
  private readonly dims = new Map<string, ProceduralDimensions>();

  constructor(
    parent: HTMLElement,
    definitions: PartDefinition[],
    private readonly onDragStart: (
      def: PartDefinition,
      custom: ProceduralDimensions | undefined,
      event: PointerEvent,
    ) => void,
    private readonly onDimsChanged?: (def: PartDefinition, dims: ProceduralDimensions) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'palette';
    for (const def of definitions) {
      this.root.appendChild(this.buildCard(def));
    }
    parent.appendChild(this.root);
  }

  destroy(): void {
    this.root.remove();
  }

  private buildCard(def: PartDefinition): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'part-card';

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = `#${def.color.toString(16).padStart(6, '0')}`;

    const name = document.createElement('div');
    name.className = 'part-name';
    name.textContent = def.name;

    const stats = document.createElement('div');
    stats.className = 'part-stats';

    card.append(swatch, name, stats);

    if (def.procedural) {
      this.dims.set(def.id, {
        widthCells: def.widthCells,
        heightCells: def.heightCells,
      });
      card.appendChild(this.buildSteppers(def, stats));
    }
    this.refreshStats(def, stats);

    card.addEventListener('pointerdown', (e) => this.onCardPointerDown(def, e));
    return card;
  }

  /**
   * Disambiguate palette pan vs part drag:
   * - Movement along the tray's scroll axis while still over the tray → scroll
   * - Movement off-axis / out of the tray → start placing the part
   */
  private onCardPointerDown(def: PartDefinition, e: PointerEvent): void {
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let decided = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || decided) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return;

      decided = true;
      cleanup();

      if (this.isScrollGesture(dx, dy, ev)) {
        // Let the browser keep scrolling the palette; do not start a drag.
        return;
      }

      ev.preventDefault();
      this.onDragStart(def, this.currentDims(def), ev);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /** True when the pointer motion should pan the list instead of placing. */
  private isScrollGesture(dx: number, dy: number, ev: PointerEvent): boolean {
    const rect = this.root.getBoundingClientRect();
    const overTray =
      ev.clientX >= rect.left &&
      ev.clientX <= rect.right &&
      ev.clientY >= rect.top &&
      ev.clientY <= rect.bottom;

    // Horizontal tray (phone): pan left/right. Vertical list (desktop): pan up/down.
    const horizontalTray = this.root.scrollWidth > this.root.clientWidth + 8;

    if (horizontalTray) {
      // Mostly sideways, or still on the tray with any horizontal intent.
      if (Math.abs(dx) >= Math.abs(dy)) return true;
      if (overTray && Math.abs(dx) > DRAG_SLOP_PX * 0.5) return true;
      return false;
    }

    // Vertical palette: scrolling is dy-dominant while the finger stays over it.
    if (overTray && Math.abs(dy) >= Math.abs(dx)) return true;
    return false;
  }

  /** The dimensions a drag of this part should use (undefined for fixed parts). */
  private currentDims(def: PartDefinition): ProceduralDimensions | undefined {
    return def.procedural ? { ...this.dims.get(def.id)! } : undefined;
  }

  private buildSteppers(def: PartDefinition, stats: HTMLDivElement): HTMLDivElement {
    const config = def.procedural!;
    const row = document.createElement('div');
    row.className = 'stepper-row';

    const adjust = (dw: number, dh: number): void => {
      const current = this.dims.get(def.id)!;
      const next = clampProceduralDimensions(config, {
        widthCells: current.widthCells + dw,
        heightCells: current.heightCells + dh,
      });
      if (next.widthCells === current.widthCells && next.heightCells === current.heightCells) {
        return;
      }
      this.dims.set(def.id, next);
      this.refreshStats(def, stats);
      sizeLabel.textContent = sizeText();
      this.onDimsChanged?.(def, next);
    };

    const sizeText = () => {
      const d = this.dims.get(def.id)!;
      return `${d.widthCells}×${d.heightCells}`;
    };

    const stepBtn = (label: string, dw: number, dh: number): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn tiny';
      btn.textContent = label;
      // Steppers must not start a part drag.
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => {
        adjust(dw, dh);
        btn.blur();
      });
      return btn;
    };

    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'stepper-size';
    sizeLabel.textContent = sizeText();

    row.append(
      stepBtn('W−', -config.widthStepCells, 0),
      stepBtn('W+', config.widthStepCells, 0),
      sizeLabel,
      stepBtn('H−', 0, -1),
      stepBtn('H+', 0, 1),
    );
    return row;
  }

  private refreshStats(def: PartDefinition, stats: HTMLDivElement): void {
    const props = resolvePartProps(def, this.currentDims(def));
    const bits = [formatMass(props.dryMassKg)];
    if (props.fuelCapacityKg > 0) bits.push(`${props.fuelCapacityKg} kg fuel`);
    if (def.thrustVacuum > 0) bits.push(`${Math.round(def.thrustVacuum / 1000)} kN`);
    stats.textContent = bits.join(' · ');
  }
}
