import type { TelemetrySample } from '../flight/Telemetry';
import { formatMass } from '../math/Units';

/**
 * In-flight engineer readout (collapsible): live mass, thrust, TWR, dynamic
 * pressure, hottest part, rotation rate, and control authority. Everything
 * displayed comes from TelemetrySample — no math in the UI.
 *
 * The header is a drag handle: move to reposition (clamped on-screen);
 * tap/click without moving still collapses/expands.
 */
export class FlightEngineerPanel {
  readonly root: HTMLDivElement;
  private readonly header: HTMLButtonElement;
  private readonly body: HTMLDivElement;
  private readonly toggleIcon: HTMLSpanElement;
  private readonly values = new Map<string, HTMLSpanElement>();
  private collapsed: boolean;
  private dragPointer: number | null = null;
  private grabOffsetX = 0;
  private grabOffsetY = 0;
  private startClientX = 0;
  private startClientY = 0;
  private moved = false;
  private customPos = false;
  private readonly onResize = () => this.reclamp();
  private readonly headerDown = (e: PointerEvent) => this.onHeaderDown(e);
  private readonly headerMove = (e: PointerEvent) => this.onHeaderMove(e);
  private readonly headerUp = (e: PointerEvent) => this.onHeaderUp(e);

  private static readonly DRAG_SLOP_PX = 8;

  private static readonly ROWS = [
    ['mass', 'Mass'],
    ['thrust', 'Thrust'],
    ['twr', 'TWR'],
    ['q', 'Dyn. press.'],
    ['heat', 'Hottest'],
    ['spin', 'Rotation'],
    ['authority', 'Ctrl torque'],
  ] as const;

  constructor(parent: HTMLElement) {
    this.collapsed =
      window.matchMedia('(max-width: 720px)').matches ||
      window.matchMedia('(max-height: 500px)').matches;

    this.root = document.createElement('div');
    this.root.className = 'flight-eng';

    this.header = document.createElement('button');
    this.header.type = 'button';
    this.header.className = 'eng-header';
    this.header.title = 'Drag to move · tap to collapse';
    const title = document.createElement('span');
    title.textContent = 'ENGINEER';
    this.toggleIcon = document.createElement('span');
    this.header.append(title, this.toggleIcon);
    this.header.addEventListener('pointerdown', this.headerDown);
    this.header.addEventListener('pointermove', this.headerMove);
    this.header.addEventListener('pointerup', this.headerUp);
    this.header.addEventListener('pointercancel', this.headerUp);

    this.body = document.createElement('div');
    this.body.className = 'eng-body';
    for (const [key, label] of FlightEngineerPanel.ROWS) {
      const row = document.createElement('div');
      row.className = 'eng-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.textContent = '—';
      row.append(labelEl, valueEl);
      this.body.appendChild(row);
      this.values.set(key, valueEl);
    }

    this.root.append(this.header, this.body);
    parent.appendChild(this.root);
    this.applyCollapsed();
    window.addEventListener('resize', this.onResize);
  }

  update(t: TelemetrySample): void {
    if (this.collapsed) return;
    this.set('mass', formatMass(t.massKg));
    this.set('thrust', `${(t.thrustN / 1000).toFixed(1)} kN`);
    this.set('twr', t.twr > 0 ? t.twr.toFixed(2) : '—');
    this.set('q', `${(t.dynamicPressurePa / 1000).toFixed(1)} kPa`);
    this.set(
      'heat',
      t.hottestPartName
        ? `${Math.round(t.hottestTempK)}/${Math.round(t.hottestMaxTempK)} K`
        : '—',
    );
    this.set('spin', `${((t.angularVelocityRadS * 180) / Math.PI).toFixed(1)}°/s`);
    this.set('authority', `${(t.controlAuthorityNm / 1000).toFixed(1)} kN·m`);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.header.removeEventListener('pointerdown', this.headerDown);
    this.header.removeEventListener('pointermove', this.headerMove);
    this.header.removeEventListener('pointerup', this.headerUp);
    this.header.removeEventListener('pointercancel', this.headerUp);
    this.root.remove();
  }

  private onHeaderDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = this.root.getBoundingClientRect();
    this.dragPointer = e.pointerId;
    this.moved = false;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.grabOffsetX = e.clientX - rect.left;
    this.grabOffsetY = e.clientY - rect.top;
    this.root.classList.add('is-dragging');
    try {
      this.header.setPointerCapture(e.pointerId);
    } catch {
      /* non-fatal */
    }
  }

  private onHeaderMove(e: PointerEvent): void {
    if (this.dragPointer !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - this.startClientX, e.clientY - this.startClientY);
    if (!this.moved && dist < FlightEngineerPanel.DRAG_SLOP_PX) return;
    this.moved = true;
    this.customPos = true;
    const parent = this.root.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    this.applyPos(e.clientX - parentRect.left - this.grabOffsetX, e.clientY - parentRect.top - this.grabOffsetY);
  }

  private onHeaderUp(e: PointerEvent): void {
    if (this.dragPointer !== e.pointerId) return;
    this.dragPointer = null;
    this.root.classList.remove('is-dragging');
    this.header.blur();
    if (!this.moved) {
      this.collapsed = !this.collapsed;
      this.applyCollapsed();
    } else {
      this.reclamp();
    }
  }

  private reclamp(): void {
    if (!this.customPos) return;
    this.applyPos(this.root.offsetLeft, this.root.offsetTop);
  }

  private applyPos(left: number, top: number): void {
    const parent = this.root.parentElement;
    if (!parent) return;
    const maxL = Math.max(0, parent.clientWidth - this.root.offsetWidth);
    const maxT = Math.max(0, parent.clientHeight - this.root.offsetHeight);
    const x = Math.max(0, Math.min(left, maxL));
    const y = Math.max(0, Math.min(top, maxT));
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
  }

  private set(key: string, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }

  private applyCollapsed(): void {
    this.body.hidden = this.collapsed;
    this.toggleIcon.textContent = this.collapsed ? '▸' : '▾';
  }
}
