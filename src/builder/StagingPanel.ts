import type { StagePreview } from '../vehicle/StageSystem';

/**
 * The staging editor panel: lists every stage in firing order — which
 * engines IGNITE and which groups SEPARATE — and previews a stage by
 * highlighting its parts in the build area while hovered/selected.
 *
 * The data comes from StageSystem.previewStages, the same fireStage walk the
 * flight runtime uses, so what the panel shows is exactly what will happen.
 * Engines move between stages via the right-click context menu ("Ignites:
 * stage N"). TODO: drag-reorder decoupler stages.
 */
export class StagingPanel {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly toggleIcon: HTMLSpanElement;
  private collapsed: boolean;
  private selectedStage: number | null = null;

  constructor(
    parent: HTMLElement,
    /** stage number (1-based) or null to clear the preview highlight. */
    private readonly onPreviewStage: (stage: number | null) => void,
  ) {
    this.collapsed = window.matchMedia('(max-width: 720px)').matches;

    this.root = document.createElement('div');
    this.root.className = 'staging-panel';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'eng-header';
    const title = document.createElement('span');
    title.textContent = 'STAGING';
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

  update(previews: StagePreview[] | null): void {
    this.body.replaceChildren();
    this.selectedStage = null;
    this.onPreviewStage(null);
    if (!previews || previews.length === 0) {
      const note = document.createElement('div');
      note.className = 'eng-note';
      note.textContent = 'No parts.';
      this.body.appendChild(note);
      return;
    }

    for (const preview of previews) {
      const stageNumber = preview.stageNumber;
      const row = document.createElement('div');
      row.className = 'stage-row';

      const heading = document.createElement('div');
      heading.className = 'eng-stage-title';
      heading.textContent = `Stage ${stageNumber}`;
      row.appendChild(heading);

      const lines: string[] = [];
      if (preview.ignites.length > 0) {
        lines.push(`🔥 ${preview.ignites.map((e) => shortName(e.def.name)).join(', ')}`);
      }
      for (const group of preview.separates) {
        const label = group.map((p) => shortName(p.def.name)).join(', ');
        lines.push(`✂ drops: ${label}`);
      }
      if (lines.length === 0) lines.push('· (nothing)');
      for (const text of lines) {
        const line = document.createElement('div');
        line.className = 'stage-line';
        line.textContent = text;
        row.appendChild(line);
      }

      // Hover previews on desktop; tap toggles on touch.
      row.addEventListener('pointerenter', () => this.onPreviewStage(stageNumber));
      row.addEventListener('pointerleave', () =>
        this.onPreviewStage(this.selectedStage),
      );
      row.addEventListener('click', () => {
        this.selectedStage = this.selectedStage === stageNumber ? null : stageNumber;
        this.onPreviewStage(this.selectedStage);
        row.classList.toggle('selected', this.selectedStage === stageNumber);
        for (const sibling of this.body.children) {
          if (sibling !== row) sibling.classList.remove('selected');
        }
      });

      this.body.appendChild(row);
    }
  }

  destroy(): void {
    this.root.remove();
  }

  private applyCollapsed(): void {
    this.body.hidden = this.collapsed;
    this.toggleIcon.textContent = this.collapsed ? '▸' : '▾';
  }
}

function shortName(name: string): string {
  return name.replace(' (inert)', '').replace(' (legacy)', '');
}
