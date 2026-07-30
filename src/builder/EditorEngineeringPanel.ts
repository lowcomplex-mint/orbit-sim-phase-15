import { formatMass } from '../math/Units';
import type { StageAnalysis, VehicleAnalysisResult } from '../systems/VehicleAnalysis';
import type { HabitationSummary } from '../future/HabitationSystem';
import type { DesignWarning } from './DesignWarnings';

/**
 * KER-style collapsible engineering readout for the builder. Pure DOM and
 * pure display: every number comes from systems/VehicleAnalysis — this file
 * must never compute engineering values itself.
 */
export class EditorEngineeringPanel {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly toggleIcon: HTMLSpanElement;
  private collapsed: boolean;

  constructor(parent: HTMLElement) {
    // Collapsed by default on phones, expanded on desktop.
    this.collapsed = window.matchMedia('(max-width: 720px)').matches;

    this.root = document.createElement('div');
    this.root.className = 'eng-panel';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'eng-header';
    const title = document.createElement('span');
    title.textContent = 'ENGINEER';
    this.toggleIcon = document.createElement('span');
    header.append(title, this.toggleIcon);
    header.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.applyCollapsed();
      header.blur();
    });

    this.body = document.createElement('div');
    this.body.className = 'eng-body';

    this.root.append(header, this.body);
    parent.appendChild(this.root);
    this.applyCollapsed();
  }

  update(
    analysis: VehicleAnalysisResult | null,
    habitation: HabitationSummary | null,
    designWarnings: readonly DesignWarning[] = [],
  ): void {
    this.body.replaceChildren();
    if (!analysis || analysis.stages.length === 0) {
      this.body.appendChild(this.note('No parts.'));
      return;
    }

    // Totals block.
    const totals = document.createElement('div');
    totals.className = 'eng-block';
    this.row(totals, 'Wet mass', formatMass(analysis.totalWetKg));
    this.row(totals, 'Dry mass', formatMass(analysis.totalDryKg));
    this.row(totals, 'Δv vac', `${Math.round(analysis.totalDeltaVVacuum)} m/s`);
    this.row(totals, 'Δv SL', `${Math.round(analysis.totalDeltaVSeaLevel)} m/s`);
    if (analysis.stages.length > 0) {
      this.row(totals, 'TWR (SL)', analysis.stages[0].twrSeaLevel.toFixed(2));
    }
    if (analysis.comHeightAboveBaseM !== null) {
      this.row(totals, 'CoM height', `${analysis.comHeightAboveBaseM.toFixed(2)} m`);
    }
    if (analysis.comLateralOffsetM !== null && Math.abs(analysis.comLateralOffsetM) > 0.01) {
      this.row(totals, 'CoM offset', `${analysis.comLateralOffsetM.toFixed(2)} m`);
    }
    if (habitation && habitation.crewCapacity > 0) {
      this.row(totals, 'Crew capacity', String(habitation.crewCapacity));
    }
    this.row(totals, 'Cost', `${Math.round(analysis.totalCostFunds)} funds`);
    this.row(totals, 'Parts', String(analysis.partCount));
    this.body.appendChild(totals);

    const checks = document.createElement('div');
    checks.className = 'eng-block build-checks';
    const checksHeading = document.createElement('div');
    checksHeading.className = 'eng-stage-title';
    checksHeading.textContent = 'BUILD CHECKS';
    checks.appendChild(checksHeading);
    if (designWarnings.length === 0) {
      const passed = this.note('✓ No gameplay warnings.');
      passed.classList.add('pass-text');
      checks.appendChild(passed);
    } else {
      for (const warning of designWarnings) {
        const el = this.note(`⚠ ${warning.message}`);
        el.classList.add('warn-text');
        el.dataset.warningCode = warning.code;
        checks.appendChild(el);
      }
    }
    this.body.appendChild(checks);

    // Per-stage blocks, in firing order.
    for (const stage of analysis.stages) {
      this.body.appendChild(this.stageBlock(stage));
    }

    // Warnings.
    for (const warning of analysis.warnings) {
      const el = this.note(warning);
      el.classList.add('warn-text');
      this.body.appendChild(el);
    }
  }

  destroy(): void {
    this.root.remove();
  }

  private stageBlock(stage: StageAnalysis): HTMLDivElement {
    const block = document.createElement('div');
    block.className = 'eng-block';
    const heading = document.createElement('div');
    heading.className = 'eng-stage-title';
    heading.textContent = `Stage ${stage.stageNumber}`;
    block.appendChild(heading);

    if (stage.engineCount > 0) {
      this.row(
        block,
        'Thrust',
        `${(stage.thrustSeaLevelN / 1000).toFixed(0)} / ${(stage.thrustVacuumN / 1000).toFixed(0)} kN`,
      );
      this.row(block, 'Δv (SL/vac)',
        `${Math.round(stage.deltaVSeaLevel)} / ${Math.round(stage.deltaVVacuum)} m/s`);
      this.row(block, 'TWR (SL)', stage.twrSeaLevel.toFixed(2));
      if (Number.isFinite(stage.burnTimeVacS)) {
        this.row(block, 'Burn time', `${Math.round(stage.burnTimeVacS)} s`);
      }
    }
    this.row(block, 'Stage wet', formatMass(stage.segmentWetKg));
    this.row(block, 'Stage dry', formatMass(stage.segmentDryKg));
    return block;
  }

  private row(parent: HTMLElement, label: string, value: string): void {
    const row = document.createElement('div');
    row.className = 'eng-row';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    parent.appendChild(row);
  }

  private note(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'eng-note';
    el.textContent = text;
    return el;
  }

  private applyCollapsed(): void {
    this.body.hidden = this.collapsed;
    this.root.classList.toggle('is-expanded', !this.collapsed);
    this.toggleIcon.textContent = this.collapsed ? '▸' : '▾';
  }
}
