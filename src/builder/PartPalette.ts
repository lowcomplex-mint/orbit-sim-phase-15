import { formatMass } from '../math/Units';
import type { PartDefinition } from '../vehicle/PartDefinition';
import {
  clampProceduralDimensions,
  resolvePartProps,
  type ProceduralDimensions,
} from '../vehicle/ProceduralPart';

/**
 * The scrollable part list. Dragging starts on pointerdown; the BuilderScene
 * owns the actual drag state and ghost preview.
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

    card.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onDragStart(def, this.currentDims(def), e);
    });
    return card;
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
