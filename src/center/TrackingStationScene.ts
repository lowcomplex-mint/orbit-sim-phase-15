import type { GameContext, Scene } from '../app/GameState';
import { Telemetry } from '../flight/Telemetry';
import { formatDistance } from '../math/Units';

/**
 * The Tracking Station: every vessel of the persistent world with live-ish
 * orbital data (1 Hz refresh). Control can be switched to any vessel that
 * still has a command pod; debris (and wrecks) can be deleted to keep the
 * world and its saves tidy.
 *
 * The simulation is paused while this screen is open (FlightSession only
 * advances when the flight scene updates it). TODO: background simulation;
 * map preview per vessel.
 */
export class TrackingStationScene implements Scene {
  private uiRoot!: HTMLDivElement;
  private listEl!: HTMLDivElement;
  private sinceRefresh = Infinity;

  constructor(
    private readonly ctx: GameContext,
    private readonly onBack: () => void,
    private readonly onFly: () => void,
  ) {}

  enter(): void {
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'scene-ui center-screen';

    const title = document.createElement('h1');
    title.textContent = 'TRACKING STATION';
    const note = document.createElement('p');
    note.className = 'center-subtitle';
    note.textContent =
      'World time is paused while viewing. FLY switches control to a vessel with a pod.';

    this.listEl = document.createElement('div');
    this.listEl.className = 'vessel-list';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn big';
    backBtn.textContent = '◄ Space Center';
    backBtn.addEventListener('click', () => this.onBack());

    this.uiRoot.append(title, note, this.listEl, backBtn);
    document.getElementById('ui-root')!.appendChild(this.uiRoot);
    this.sinceRefresh = Infinity;
  }

  exit(): void {
    this.uiRoot.remove();
  }

  update(dtSec: number): void {
    this.sinceRefresh += dtSec;
    if (this.sinceRefresh < 1) return;
    this.sinceRefresh = 0;
    this.refresh();
  }

  private refresh(): void {
    this.listEl.replaceChildren();
    const session = this.ctx.session;

    if (!session || session.vessels.vessels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vessel-row';
      empty.textContent = 'No vessels in flight. Build and launch a rocket first.';
      this.listEl.appendChild(empty);
      return;
    }

    const telemetry = new Telemetry(session);
    const activeId = session.activeVessel?.id;

    for (const vessel of session.vessels.vessels) {
      const sample = telemetry.sampleRuntime(vessel.runtime);
      const row = document.createElement('div');
      row.className = 'vessel-row';
      if (vessel.id === activeId) row.classList.add('active-vessel');

      const name = document.createElement('div');
      name.className = 'vessel-name';
      name.textContent =
        `${vessel.name} · ${vessel.type}` + (vessel.id === activeId ? ' · CONTROLLED' : '');

      const stats = document.createElement('div');
      stats.className = 'vessel-stats';
      stats.textContent =
        `${sample.status.toUpperCase()} @ ${sample.bodyName} · alt ${formatDistance(sample.altitudeM)} · ` +
        `apo ${sample.apoapsisAltM === null ? '—' : formatDistance(sample.apoapsisAltM)} · ` +
        `peri ${formatDistance(sample.periapsisAltM)}`;

      row.append(name, stats);

      if (vessel.controllable && !vessel.runtime.crashed) {
        const flyBtn = document.createElement('button');
        flyBtn.type = 'button';
        flyBtn.className = 'btn';
        flyBtn.textContent = vessel.id === activeId ? 'FLY' : 'SWITCH & FLY';
        flyBtn.addEventListener('click', () => {
          if (session.vessels.setActive(vessel.id)) this.onFly();
        });
        row.appendChild(flyBtn);
      }

      const deletable =
        vessel.id !== activeId && (vessel.type === 'debris' || vessel.runtime.crashed);
      if (deletable) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn small danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () =>
          this.ctx.confirm(`Delete "${vessel.name}"?`, () => {
            session.vessels.destroyVessel(vessel, 'deleted from the Tracking Station');
            this.refresh();
          }),
        );
        row.appendChild(delBtn);
      }

      this.listEl.appendChild(row);
    }
  }
}
