import type { PartDefinition } from '../vehicle/PartDefinition';
import {
  CHUTE_MATERIALS,
  CHUTE_PRESETS,
  clampThrustLimiter,
  DEFAULT_CHUTE,
  MIN_THRUST_LIMITER,
  NOSE_VARIANTS,
  resolvePartProps,
  type ChuteConfig,
  type ChuteMaterial,
  type PartCustomization,
} from '../vehicle/ProceduralPart';
import type { PlacedPartData } from '../vehicle/RocketDesign';
import { formatMass } from '../math/Units';

/**
 * Part settings menu for placed parts in the EDITOR (right-click, long-press
 * on touch, or the selection-toolbar Edit button). Exposes per-part
 * customization: thrust limiter and ignition stage for engines, chute/clamp
 * config, width/height for procedural tanks, nose variants, and part removal.
 *
 * Tank dimensions are deliberately editable only here, in the editor —
 * flight has no part-editing UI at all, which enforces the "no resizing
 * during flight" rule structurally.
 *
 * The menu never mutates the design itself; every change goes through the
 * callbacks so BuilderScene stays the single mutation funnel.
 */

export interface ContextMenuCallbacks {
  /** Merge new customization into the part. Returns false if rejected. */
  onCustomize(placed: PlacedPartData, custom: PartCustomization): boolean;
  onRemove(placed: PlacedPartData): void;
  onClosed(): void;
}

export class PartContextMenu {
  private menuEl: HTMLDivElement | null = null;
  private readonly outsideHandler = (e: PointerEvent) => {
    if (this.menuEl && !this.menuEl.contains(e.target as Node)) this.close();
  };

  constructor(
    private readonly parent: HTMLElement,
    private readonly callbacks: ContextMenuCallbacks,
  ) {}

  get isOpen(): boolean {
    return this.menuEl !== null;
  }

  open(
    screenX: number,
    screenY: number,
    placed: PlacedPartData,
    def: PartDefinition,
    stageCount: number,
    defaultIgniteStage: number,
  ): void {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    this.menuEl = menu;

    const title = document.createElement('div');
    title.className = 'ctx-title';
    title.textContent = def.name;
    menu.appendChild(title);

    // Part inspector line: resolved mass / cost / heat limit.
    const info = document.createElement('div');
    info.className = 'ctx-row';
    const props = resolvePartProps(def, placed.custom);
    info.textContent =
      `${formatMass(props.dryMassKg)} dry · ${props.costFunds} funds · ` +
      `max ${Math.round(props.maxTempK)} K`;
    menu.appendChild(info);

    if (def.category === 'nose') {
      this.buildVariantSelector(menu, placed);
    }
    if (def.category === 'parachute') {
      this.buildChuteConfig(menu, placed);
    }
    if (def.category === 'engine') {
      this.buildThrustLimiter(menu, placed);
      this.buildIgnitionStage(menu, placed, stageCount, defaultIgniteStage);
    }
    if (def.category === 'clamp') {
      this.buildClampConfig(menu, placed);
      this.buildIgnitionStage(menu, placed, stageCount, defaultIgniteStage);
    }
    if (def.procedural) {
      this.buildSizeControls(menu, placed, def);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn small danger';
    removeBtn.textContent = 'Remove part';
    removeBtn.addEventListener('click', () => {
      const target = placed;
      this.close();
      this.callbacks.onRemove(target);
    });
    menu.appendChild(removeBtn);

    this.parent.appendChild(menu);
    // Keep the menu on-screen.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(screenX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(screenY, window.innerHeight - rect.height - 8)}px`;

    window.addEventListener('pointerdown', this.outsideHandler, true);
  }

  close(): void {
    if (!this.menuEl) return;
    window.removeEventListener('pointerdown', this.outsideHandler, true);
    this.menuEl.remove();
    this.menuEl = null;
    this.callbacks.onClosed();
  }

  destroy(): void {
    this.close();
  }

  // ------------------------------------------------------------ sections --

  private buildThrustLimiter(menu: HTMLDivElement, placed: PlacedPartData): void {
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const label = document.createElement('span');
    const current = clampThrustLimiter(placed.custom?.thrustLimiter);
    label.textContent = `Thrust limit ${Math.round(current * 100)}%`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(MIN_THRUST_LIMITER * 100);
    slider.max = '100';
    slider.step = '5';
    slider.value = String(Math.round(current * 100));
    slider.className = 'ctx-slider';
    slider.addEventListener('input', () => {
      const value = Number(slider.value) / 100;
      if (this.callbacks.onCustomize(placed, { thrustLimiter: value })) {
        label.textContent = `Thrust limit ${slider.value}%`;
      }
    });

    row.append(label, slider);
    menu.appendChild(row);
  }

  private buildIgnitionStage(
    menu: HTMLDivElement,
    placed: PlacedPartData,
    stageCount: number,
    defaultStage: number,
  ): void {
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const label = document.createElement('span');
    const valueOf = () => placed.custom?.igniteStage;
    const refresh = () => {
      const v = valueOf();
      label.textContent = `Ignites: stage ${v ?? defaultStage}${v === undefined ? ' (auto)' : ''}`;
    };
    refresh();

    const controls = document.createElement('div');
    controls.className = 'ctx-btn-row';
    const setStage = (stage: number | undefined) => {
      if (this.callbacks.onCustomize(placed, { igniteStage: stage })) refresh();
    };
    controls.append(
      this.miniBtn('−', () => setStage(Math.max(1, (valueOf() ?? defaultStage) - 1))),
      this.miniBtn('+', () => setStage(Math.min(stageCount, (valueOf() ?? defaultStage) + 1))),
      this.miniBtn('auto', () => setStage(undefined)),
    );
    row.append(label, controls);
    menu.appendChild(row);
  }

  private buildSizeControls(
    menu: HTMLDivElement,
    placed: PlacedPartData,
    def: PartDefinition,
  ): void {
    const config = def.procedural!;
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const label = document.createElement('span');
    const dims = () => ({
      widthCells: placed.custom?.widthCells ?? def.widthCells,
      heightCells: placed.custom?.heightCells ?? def.heightCells,
    });
    const refresh = () => {
      const d = dims();
      label.textContent = `Size ${d.widthCells}×${d.heightCells} cells`;
    };
    refresh();

    const controls = document.createElement('div');
    controls.className = 'ctx-btn-row';
    const resize = (dw: number, dh: number) => {
      const d = dims();
      const ok = this.callbacks.onCustomize(placed, {
        widthCells: d.widthCells + dw,
        heightCells: d.heightCells + dh,
      });
      if (ok) refresh();
    };
    controls.append(
      this.miniBtn('W−', () => resize(-config.widthStepCells, 0)),
      this.miniBtn('W+', () => resize(config.widthStepCells, 0)),
      this.miniBtn('H−', () => resize(0, -1)),
      this.miniBtn('H+', () => resize(0, 1)),
    );
    row.append(label, controls);
    menu.appendChild(row);
  }

  /** RealChute-style procedural parachute editor (editor-only). */
  private buildChuteConfig(menu: HTMLDivElement, placed: PlacedPartData): void {
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const label = document.createElement('span');
    const config = (): ChuteConfig => ({ ...DEFAULT_CHUTE, ...placed.custom?.chute });
    const refresh = () => {
      const c = config();
      label.textContent =
        `${c.type} · Ø${c.diameterM} m · deploy <${c.deployAltM} m · ` +
        CHUTE_MATERIALS[c.material].label;
    };
    refresh();

    const apply = (patch: Partial<ChuteConfig>) => {
      const next: ChuteConfig = { ...config(), ...patch };
      next.diameterM = Math.min(24, Math.max(2, Math.round(next.diameterM)));
      next.deployAltM = Math.min(8000, Math.max(200, Math.round(next.deployAltM / 100) * 100));
      if (this.callbacks.onCustomize(placed, { chute: next })) refresh();
    };

    const presetRow = document.createElement('div');
    presetRow.className = 'ctx-btn-row';
    for (const preset of Object.values(CHUTE_PRESETS)) {
      presetRow.appendChild(this.miniBtn(preset.label, () => apply({ ...preset.config })));
    }
    const tweakRow = document.createElement('div');
    tweakRow.className = 'ctx-btn-row';
    const materials = Object.keys(CHUTE_MATERIALS) as ChuteMaterial[];
    tweakRow.append(
      this.miniBtn('Ø−', () => apply({ diameterM: config().diameterM - 1 })),
      this.miniBtn('Ø+', () => apply({ diameterM: config().diameterM + 1 })),
      this.miniBtn('Alt−', () => apply({ deployAltM: config().deployAltM - 200 })),
      this.miniBtn('Alt+', () => apply({ deployAltM: config().deployAltM + 200 })),
      this.miniBtn('Mat', () =>
        apply({
          material:
            materials[(materials.indexOf(config().material) + 1) % materials.length],
        }),
      ),
    );

    row.append(label, presetRow, tweakRow);
    menu.appendChild(row);
  }

  private buildVariantSelector(menu: HTMLDivElement, placed: PlacedPartData): void {
    const row = document.createElement('div');
    row.className = 'ctx-row';
    const label = document.createElement('span');
    const refresh = () => {
      const id = placed.custom?.variant ?? 'cone';
      const v = NOSE_VARIANTS[id];
      label.textContent = `Shape: ${v.label} (Cd ${v.dragCoefficient})`;
    };
    refresh();
    const controls = document.createElement('div');
    controls.className = 'ctx-btn-row';
    for (const [id, v] of Object.entries(NOSE_VARIANTS)) {
      controls.appendChild(
        this.miniBtn(v.label, () => {
          if (this.callbacks.onCustomize(placed, { variant: id })) refresh();
        }),
      );
    }
    row.append(label, controls);
    menu.appendChild(row);
  }

  /** Tower height + umbilical reach (launch clamps). */
  private buildClampConfig(menu: HTMLDivElement, placed: PlacedPartData): void {
    const heightOf = () => Math.round(placed.custom?.heightCells ?? 4);
    const umbOf = () => Math.round(placed.custom?.clampUmbilicalCells ?? 2);

    const hRow = document.createElement('div');
    hRow.className = 'ctx-row';
    const hLabel = document.createElement('span');
    const hRefresh = () => {
      hLabel.textContent = `Tower height: ${heightOf()} cells`;
    };
    hRefresh();
    const hControls = document.createElement('div');
    hControls.className = 'ctx-btn-row';
    hControls.append(
      this.miniBtn('−', () => {
        const next = Math.max(2, heightOf() - 1);
        if (this.callbacks.onCustomize(placed, { heightCells: next })) hRefresh();
      }),
      this.miniBtn('+', () => {
        const next = Math.min(12, heightOf() + 1);
        if (this.callbacks.onCustomize(placed, { heightCells: next })) hRefresh();
      }),
    );
    hRow.append(hLabel, hControls);
    menu.appendChild(hRow);

    const uRow = document.createElement('div');
    uRow.className = 'ctx-row';
    const uLabel = document.createElement('span');
    const uRefresh = () => {
      uLabel.textContent = `Umbilical length: ${umbOf()} cells`;
    };
    uRefresh();
    const uControls = document.createElement('div');
    uControls.className = 'ctx-btn-row';
    uControls.append(
      this.miniBtn('−', () => {
        const next = Math.max(1, umbOf() - 1);
        if (this.callbacks.onCustomize(placed, { clampUmbilicalCells: next })) uRefresh();
      }),
      this.miniBtn('+', () => {
        const next = Math.min(8, umbOf() + 1);
        if (this.callbacks.onCustomize(placed, { clampUmbilicalCells: next })) uRefresh();
      }),
    );
    uRow.append(uLabel, uControls);
    menu.appendChild(uRow);

    const tip = document.createElement('div');
    tip.className = 'ctx-row';
    tip.style.opacity = '0.75';
    tip.textContent = 'Holds any mass (KSP-style). Stages to release.';
    menu.appendChild(tip);
  }

  private miniBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn tiny';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      onClick();
      btn.blur();
    });
    return btn;
  }
}
