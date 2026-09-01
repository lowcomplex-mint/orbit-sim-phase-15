import { Container } from 'pixi.js';
import type { GameContext, Scene } from '../app/GameState';
import { FLIGHT_CAMERA } from '../config/constants';
import { clamp, formatDistance } from '../math/Units';
import { predictOrbitPoints } from '../physics/OrbitPredictor';
import type { OrbitInfo, OrbitStatus } from '../math/OrbitMath';
import type { Renderer } from '../render/Renderer';
import { createEarthView, createMoonView, createSunView } from '../render/BodyRenderer';
import { OrbitRenderer } from '../render/OrbitRenderer';
import { VesselView } from '../render/VesselView';
import type { FlightSession } from '../systems/FlightSession';
import type { StepEvents } from '../physics/RocketPhysics';
import { createButton, createHoldButton, createRow } from '../ui/Buttons';
import { PointerTracker } from '../ui/CanvasGestures';
import { FlightEngineerPanel } from '../ui/FlightEngineerPanel';
import { Hud } from '../ui/Hud';
import { Navball } from '../ui/Navball';
import { PauseMenu } from '../ui/PauseMenu';
import { MAX_Q_WARNING_PA, REENTRY_FX_FULL_FLUX } from '../config/constants';
import { sphereOfInfluenceRadius } from '../space/SphereOfInfluence';
import { Vec2 } from '../math/Vec2';
import type { SasMode } from '../vehicle/RocketRuntime';
import { CameraController } from './CameraController';
import { FlightControls } from './FlightControls';
import { MapCameraController } from './MapCameraController';
import { Telemetry } from './Telemetry';

/** Navigation/save actions the flight scene needs from GameApp. */
export interface FlightSceneActions {
  backToBuilder(): void;
  exitToSpaceCenter(): void;
  exitToTrackingStation(): void;
  /** Revert to launch: autosaves, then relaunches the current design. */
  revertToLaunch(): void;
  /** Revert to VAB: autosaves, discards the flight, opens the builder. */
  revertToVab(): void;
  quickSave(): void;
  quickLoad(): void;
  /** Autosave hook (gated by settings inside GameApp). */
  requestAutosave(reason: string, kind: 'staging' | 'scene' | 'always'): void;
}

/**
 * The flight scene: a VIEW over the persistent FlightSession (owned by
 * GameApp/GameContext). Entering attaches rendering and controls to the
 * session; exiting detaches them and leaves the session untouched.
 *
 * Pausing (Esc / PAUSE button) stops session updates entirely — world time
 * stands still while the pause menu is open, consistent with the VAB and
 * Tracking Station being non-simulation areas.
 */
export class FlightScene implements Scene {
  private session!: FlightSession;
  private telemetry!: Telemetry;
  private controls!: FlightControls;
  private hud!: Hud;
  private navball!: Navball;
  private pauseMenu!: PauseMenu;
  private engineerPanel!: FlightEngineerPanel;
  private sasBtn!: HTMLButtonElement;
  private paused = false;
  private maxQWarned = false;
  private heatWarned = false;

  private root = new Container();
  private moonView!: Container;
  private orbitRenderer!: OrbitRenderer;
  private readonly vesselViews = new Map<number, VesselView>();

  private flightCam = new CameraController(
    FLIGHT_CAMERA.initialPxPerMeter,
    FLIGHT_CAMERA.minPxPerMeter,
    FLIGHT_CAMERA.maxPxPerMeter,
  );
  private readonly mapCtrl = new MapCameraController();
  private mapMode = false;
  private lastStatus: OrbitStatus | null = null;

  private uiRoot!: HTMLDivElement;
  private throttleHit!: HTMLDivElement;
  private throttleTrack!: HTMLDivElement;
  private throttleFill!: HTMLDivElement;
  private throttleThumb!: HTMLDivElement;
  private throttleReadout!: HTMLSpanElement;
  private throttleDragging = false;
  private followBtn!: HTMLButtonElement;
  private centerBtn!: HTMLButtonElement;
  private mapSide!: HTMLDivElement;
  private reentryVignette!: HTMLDivElement;
  private readonly wheelHandler = (e: WheelEvent) => this.onWheel(e);
  /** Vessel-view pinch zoom (map mode uses MapCameraController instead). */
  private readonly flightPinchPointers = new PointerTracker();
  private readonly flightPinchDown = (e: PointerEvent) => this.onFlightPinchDown(e);
  private readonly flightPinchMove = (e: PointerEvent) => this.onFlightPinchMove(e);
  private readonly flightPinchUp = (e: PointerEvent) => this.onFlightPinchUp(e);

  constructor(
    private readonly renderer: Renderer,
    private readonly ctx: GameContext,
    private readonly actions: FlightSceneActions,
  ) {}

  // ------------------------------------------------------------ lifecycle --

  enter(): void {
    if (!this.ctx.session) {
      throw new Error('FlightScene entered without a flight session');
    }
    this.session = this.ctx.session;
    this.telemetry = new Telemetry(this.session);
    this.paused = false;

    this.buildWorldViews();
    this.buildUi();

    this.controls = new FlightControls(this.session.activeRuntime, {
      onStage: () => this.doStage(),
      onReset: () => this.actions.revertToLaunch(),
      onToggleMap: () => this.toggleMap(),
      onWarpStep: (delta) => this.session.stepWarp(delta),
      onTogglePause: () => this.togglePause(),
      onCycleSas: () => this.cycleSas(),
      onToggleLegs: () => this.toggleLegs(),
    });
    this.controls.onThrottleChanged = (t) => this.syncThrottleUi(t);
    this.controls.attach();
    this.renderer.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.renderer.canvas.addEventListener('pointerdown', this.flightPinchDown);
    this.renderer.canvas.addEventListener('pointermove', this.flightPinchMove);
    this.renderer.canvas.addEventListener('pointerup', this.flightPinchUp);
    this.renderer.canvas.addEventListener('pointercancel', this.flightPinchUp);
    this.mapCtrl.attach(this.renderer.canvas, () => ({
      width: this.renderer.viewWidth,
      height: this.renderer.viewHeight,
    }));
    this.mapCtrl.onFollowChanged = (follow) => this.refreshFollowButton(follow);

    this.mapMode = false;
    this.mapCtrl.enabled = false;
    this.flightPinchPointers.clear();
    this.lastStatus = null;
    this.flightCam.setZoom(FLIGHT_CAMERA.initialPxPerMeter);

    // Dev-only hook so tests and autopilot experiments can reach the
    // simulation from the console. Not part of the game's API.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__orbitSim = {
        session: this.session,
        world: this.session.world,
        vessels: this.session.vessels,
        rocket: this.session.activeRuntime,
        scene: this,
      };
    }
  }

  exit(): void {
    this.controls.detach();
    this.renderer.canvas.removeEventListener('wheel', this.wheelHandler);
    this.renderer.canvas.removeEventListener('pointerdown', this.flightPinchDown);
    this.renderer.canvas.removeEventListener('pointermove', this.flightPinchMove);
    this.renderer.canvas.removeEventListener('pointerup', this.flightPinchUp);
    this.renderer.canvas.removeEventListener('pointercancel', this.flightPinchUp);
    this.flightPinchPointers.clear();
    this.mapCtrl.detach();
    this.pauseMenu.destroy();
    this.engineerPanel.destroy();
    this.navball.destroy();
    this.hud.destroy();
    this.uiRoot.remove();
    for (const view of this.vesselViews.values()) view.destroy();
    this.vesselViews.clear();
    this.root.destroy({ children: true });
    // The session itself lives on (Space Center can resume it).
  }

  update(dtSec: number): void {
    if (!this.paused) {
      this.controls.update(dtSec);
      const events = this.session.update(dtSec);
      this.reportEvents(events);
    }

    const sample = this.telemetry.sample();
    if (sample.status !== this.lastStatus) {
      if (this.lastStatus !== null) {
        this.ctx.log(
          sample.status === 'crashed' ? 'error' : 'info',
          `Status: ${this.lastStatus} -> ${sample.status}`,
        );
        if (sample.status === 'orbiting') this.ctx.career.award('firstOrbit', sample.simTime);
        if (sample.status === 'landed') this.ctx.career.award('firstLanding', sample.simTime);
      }
      this.lastStatus = sample.status;
    }
    // World-first milestones (CareerSystem dedupes).
    if (sample.altitudeM > 70_000 && sample.bodyName === 'Earth') {
      this.ctx.career.award('firstSpace', sample.simTime);
    }
    if (sample.bodyName !== 'Earth') {
      this.ctx.career.award('firstSoiTransition', sample.simTime);
    }
    this.hud.update(sample);
    this.navball.update(sample);
    this.engineerPanel.update(sample);
    this.checkStressWarnings(sample);

    this.updateReentryFx(sample);
    this.syncWorldViews(sample.heatFluxWm2);
    this.updateCamera(sample.orbit, sample.bodyPosition);
  }

  /** Screen-edge glow scaled by the heating model (REENTRY_FX_FULL_FLUX). */
  private updateReentryFx(sample: { heatFluxWm2: number }): void {
    const intensity = Math.min(1, sample.heatFluxWm2 / REENTRY_FX_FULL_FLUX);
    this.reentryVignette.style.opacity =
      intensity > 0.04 ? String(0.25 + intensity * 0.6) : '0';
  }

  /** Max-Q / overheating warnings with hysteresis so they fire once per event. */
  private checkStressWarnings(sample: {
    dynamicPressurePa: number;
    hottestPartName: string | null;
    hottestTempK: number;
    hottestMaxTempK: number;
  }): void {
    if (!this.maxQWarned && sample.dynamicPressurePa > MAX_Q_WARNING_PA) {
      this.maxQWarned = true;
      this.ctx.log(
        'warn',
        `High aerodynamic stress: q = ${(sample.dynamicPressurePa / 1000).toFixed(0)} kPa.`,
      );
    } else if (this.maxQWarned && sample.dynamicPressurePa < MAX_Q_WARNING_PA / 2) {
      this.maxQWarned = false;
    }

    const heatFraction =
      sample.hottestPartName !== null ? sample.hottestTempK / sample.hottestMaxTempK : 0;
    if (!this.heatWarned && heatFraction > 0.85) {
      this.heatWarned = true;
      this.ctx.log('warn', `${sample.hottestPartName} is overheating!`);
    } else if (this.heatWarned && heatFraction < 0.7) {
      this.heatWarned = false;
    }
  }

  private cycleSas(): void {
    const order: SasMode[] = ['stability', 'prograde', 'retrograde', 'off'];
    const rocket = this.session.activeRuntime;
    const next = order[(order.indexOf(rocket.sasMode) + 1) % order.length];
    rocket.sasMode = next;
    this.refreshSasButton();
    this.ctx.log('info', `SAS: ${next}.`);
  }

  private toggleLegs(): void {
    const state = this.session.activeRuntime.toggleLegs();
    this.ctx.log(
      state === null ? 'warn' : 'info',
      state === null
        ? 'No landing legs aboard.'
        : `Landing legs ${state}.`,
    );
  }

  private refreshSasButton(): void {
    const labels: Record<SasMode, string> = {
      off: '○',
      stability: '◎',
      prograde: '▲',
      retrograde: '▼',
    };
    this.sasBtn.textContent = labels[this.session.activeRuntime.sasMode];
  }

  // ---------------------------------------------------------- world views --

  private buildWorldViews(): void {
    this.root = new Container();
    const sun = createSunView();
    const earth = createEarthView(this.session.world.earth.config);
    this.moonView = createMoonView(this.session.world.moon.config);
    this.orbitRenderer = new OrbitRenderer();

    this.root.addChild(sun, earth, this.moonView, this.orbitRenderer.container);
    this.renderer.worldRoot.addChild(this.root);
  }

  private syncWorldViews(activeHeatFlux = 0): void {
    const moonPos = this.session.world.moon.positionAt(this.session.world.simTime);
    this.moonView.position.set(moonPos.x, moonPos.y);

    const activeId = this.session.activeVessel?.id ?? -1;
    const seen = new Set<number>();
    for (const vessel of this.session.vessels.vessels) {
      seen.add(vessel.id);
      let view = this.vesselViews.get(vessel.id);
      if (!view) {
        view = new VesselView(this.root, vessel.type === 'debris' ? 0x9aa5b1 : 0xffffff);
        this.vesselViews.set(vessel.id, view);
      }
      view.sync(vessel, {
        isActive: vessel.id === activeId,
        mapMode: this.mapMode,
        mapPxPerMeter: this.mapCtrl.camera.pxPerMeter,
        reentryIntensity:
          vessel.id === activeId
            ? Math.min(1, activeHeatFlux / REENTRY_FX_FULL_FLUX)
            : 0,
      });
    }
    for (const [id, view] of this.vesselViews) {
      if (!seen.has(id)) {
        view.destroy();
        this.vesselViews.delete(id);
      }
    }
  }

  private updateCamera(orbit: OrbitInfo, bodyPosition: Vec2): void {
    const rocket = this.session.activeRuntime;
    if (this.mapMode) {
      this.mapCtrl.update(rocket.position);
      const s = this.mapCtrl.camera.pxPerMeter;
      const strokeW = 2 / s;
      const world = this.session.world;
      this.orbitRenderer.updateReference(
        world.moon.config.orbit!.radiusM,
        world.earth.radiusM + world.atmosphere.heightM,
        strokeW,
        {
          center: world.moon.positionAt(world.simTime),
          radiusM: sphereOfInfluenceRadius(world.moon),
        },
      );
      // The predicted conic is DOMINANT-BODY-relative (telemetry computes
      // the orbit that way): a lunar orbit draws around the Moon and rides
      // along with it. TODO: patched-conic continuation across the SOI edge.
      const showOrbit = !rocket.crashed && !rocket.landed;
      const relPos = rocket.position.sub(bodyPosition);
      const periDir =
        orbit.eccentricity > 1e-6 ? orbit.eccVector.normalized() : relPos.normalized();
      this.orbitRenderer.updateOrbit(
        showOrbit
          ? predictOrbitPoints(orbit, relPos).map((p) => p.add(bodyPosition))
          : [],
        strokeW,
        showOrbit
          ? {
              periapsis: bodyPosition.add(periDir.scale(orbit.periapsisRadius)),
              apoapsis: orbit.isBound
                ? bodyPosition.add(periDir.scale(-orbit.apoapsisRadius))
                : null,
            }
          : undefined,
      );
      this.mapCtrl.camera.apply(
        this.renderer.worldRoot,
        this.renderer.viewWidth,
        this.renderer.viewHeight,
      );
    } else {
      this.flightCam.center = rocket.position;
      this.flightCam.apply(
        this.renderer.worldRoot,
        this.renderer.viewWidth,
        this.renderer.viewHeight,
      );
    }
  }

  // -------------------------------------------------------------- actions --

  private doStage(): void {
    if (this.paused) return;
    this.actions.requestAutosave('before staging', 'staging');
    this.session.stage();
    this.ctx.career.award('firstStaging', this.session.world.simTime);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    if (this.paused) {
      this.pauseMenu.open();
      this.ctx.log('info', 'Paused.');
    } else {
      this.pauseMenu.close();
      this.ctx.log('info', 'Resumed.');
    }
  }

  private toggleMap(): void {
    this.mapMode = !this.mapMode;
    this.mapCtrl.enabled = this.mapMode;
    this.orbitRenderer.setVisible(this.mapMode);
    this.mapSide.hidden = !this.mapMode;
    this.flightPinchPointers.clear();
    if (this.mapMode) this.mapCtrl.recenter(this.session.activeRuntime.position);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    if (this.mapMode) {
      const rect = this.renderer.canvas.getBoundingClientRect();
      this.mapCtrl.zoomAtScreen(e.clientX - rect.left, e.clientY - rect.top, factor);
    } else {
      this.flightCam.zoomBy(factor);
    }
  }

  private onFlightPinchDown(e: PointerEvent): void {
    if (this.mapMode || this.paused) return;
    this.flightPinchPointers.down(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  private onFlightPinchMove(e: PointerEvent): void {
    if (this.mapMode || this.paused || !this.flightPinchPointers.has(e.pointerId)) return;
    const result = this.flightPinchPointers.move(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });
    if (result.pinch) this.flightCam.zoomBy(result.pinch.scale);
  }

  private onFlightPinchUp(e: PointerEvent): void {
    this.flightPinchPointers.up(e.pointerId);
  }

  private reportEvents(events: StepEvents): void {
    for (const notice of events.notices) {
      this.ctx.log(notice.level, notice.message);
    }
    for (const name of events.partsLost) {
      this.ctx.log('error', `${name} was destroyed by overheating!`);
    }
    if (events.liftoff) {
      this.ctx.log('info', 'Liftoff!');
      this.ctx.career.award('firstLiftoff', this.session.world.simTime);
    }
    if (events.fuelExhausted) this.ctx.log('warn', 'Stage fuel depleted.');
    if (events.landed) this.ctx.log('info', 'Touchdown — landed safely.');
    if (events.crashed) {
      const rocket = this.session.activeRuntime;
      this.ctx.log(
        'error',
        `Crashed at ${formatDistance(rocket.position.length() - this.session.world.earth.radiusM)} altitude. ` +
          'Press R to revert to launch.',
      );
    }
  }

  private refreshFollowButton(follow: boolean): void {
    this.followBtn.textContent = follow ? 'FOLLOW ✓' : 'FOLLOW ✗';
  }

  // ------------------------------------------------------------------- UI --

  private syncThrottleUi(t: number): void {
    const pct = Math.round(clamp(t, 0, 1) * 100);
    if (this.throttleReadout) this.throttleReadout.textContent = `${pct}`;
    if (this.throttleFill) this.throttleFill.style.height = `${pct}%`;
    if (this.throttleThumb) this.throttleThumb.style.bottom = `${pct}%`;
    if (this.throttleTrack) this.throttleTrack.setAttribute('aria-valuenow', String(pct));
  }

  private setThrottleFromPointer(clientY: number): void {
    const rect = this.throttleTrack.getBoundingClientRect();
    if (rect.height <= 0) return;
    const t = 1 - (clientY - rect.top) / rect.height;
    const value = clamp(t, 0, 1);
    this.controls.setThrottle(value);
    this.syncThrottleUi(value);
  }

  private buildUi(): void {
    this.uiRoot = document.createElement('div');
    this.uiRoot.className = 'scene-ui flight-ui';
    const uiParent = document.getElementById('ui-root')!;

    this.hud = new Hud(this.uiRoot, () => this.ctx.toggleLog());
    this.navball = new Navball(this.uiRoot);
    this.engineerPanel = new FlightEngineerPanel(this.uiRoot);
    this.reentryVignette = document.createElement('div');
    this.reentryVignette.className = 'reentry-vignette';
    this.reentryVignette.style.opacity = '0';
    this.uiRoot.appendChild(this.reentryVignette);
    this.pauseMenu = new PauseMenu(this.uiRoot, {
      onResume: () => this.togglePause(),
      onRevertToLaunch: () => this.actions.revertToLaunch(),
      onRevertToVab: () => this.actions.revertToVab(),
      onSpaceCenter: () => this.actions.exitToSpaceCenter(),
      onTrackingStation: () => this.actions.exitToTrackingStation(),
      onQuickSave: () => this.actions.quickSave(),
      onQuickLoad: () => this.actions.quickLoad(),
    });

    const bottom = document.createElement('div');
    bottom.className = 'bar-bottom';

    // Vertical side throttle (SFS-style). Up = more thrust.
    const side = document.createElement('div');
    side.className = 'flight-side';
    const throttleWrap = document.createElement('div');
    throttleWrap.className = 'throttle-wrap throttle-vert';
    this.throttleReadout = document.createElement('span');
    this.throttleReadout.className = 'throttle-value';
    const throttleLabel = document.createElement('span');
    throttleLabel.className = 'throttle-label';
    throttleLabel.textContent = 'THR';
    this.throttleTrack = document.createElement('div');
    this.throttleTrack.className = 'throttle-track';
    this.throttleTrack.setAttribute('role', 'slider');
    this.throttleTrack.setAttribute('aria-label', 'Throttle');
    this.throttleTrack.setAttribute('aria-orientation', 'vertical');
    this.throttleTrack.setAttribute('aria-valuemin', '0');
    this.throttleTrack.setAttribute('aria-valuemax', '100');
    this.throttleFill = document.createElement('div');
    this.throttleFill.className = 'throttle-fill';
    this.throttleThumb = document.createElement('div');
    this.throttleThumb.className = 'throttle-thumb';
    this.throttleTrack.append(this.throttleFill, this.throttleThumb);
    this.throttleHit = document.createElement('div');
    this.throttleHit.className = 'throttle-hit';
    this.throttleHit.appendChild(this.throttleTrack);
    this.syncThrottleUi(this.session.activeRuntime.throttle);
    this.throttleHit.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.throttleDragging = true;
      try {
        this.throttleHit.setPointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      this.setThrottleFromPointer(e.clientY);
    });
    this.throttleHit.addEventListener('pointermove', (e) => {
      if (!this.throttleDragging) return;
      this.setThrottleFromPointer(e.clientY);
    });
    const endThrottleDrag = () => {
      this.throttleDragging = false;
    };
    this.throttleHit.addEventListener('pointerup', endThrottleDrag);
    this.throttleHit.addEventListener('pointercancel', endThrottleDrag);
    throttleWrap.append(this.throttleReadout, this.throttleHit, throttleLabel);
    side.appendChild(throttleWrap);

    const controlRow = createRow();
    this.sasBtn = createButton('◎', () => this.cycleSas(), {
      className: 'icon',
      title: 'Cycle SAS mode: stability / prograde / retrograde / off (G)',
    });
    this.refreshSasButton();
    this.followBtn = createButton(
      'FOLLOW ✓',
      () => {
        this.mapCtrl.setFollow(!this.mapCtrl.follow);
        this.refreshFollowButton(this.mapCtrl.follow);
      },
      { title: 'Toggle map camera follow' },
    );
    this.centerBtn = createButton(
      'CENTER',
      () => this.mapCtrl.recenter(this.session.activeRuntime.position),
      { title: 'Recenter map on the vessel' },
    );
    this.mapSide = document.createElement('div');
    this.mapSide.className = 'map-side';
    this.mapSide.hidden = true;
    this.mapSide.append(this.followBtn, this.centerBtn);

    const warpPair = document.createElement('div');
    warpPair.className = 'dock-pair';
    warpPair.append(
      createButton('◄◄', () => this.session.stepWarp(-1), {
        className: 'icon',
        title: 'Slower time (,)',
      }),
      createButton('►►', () => this.session.stepWarp(1), {
        className: 'icon',
        title: 'Faster time (.)',
      }),
    );

    controlRow.append(
      createHoldButton(
        '⟲',
        () => (this.controls.touchRotate = 1),
        () => (this.controls.touchRotate = 0),
        { className: 'icon', title: 'Rotate left (A)' },
      ),
      createHoldButton(
        '⟳',
        () => (this.controls.touchRotate = -1),
        () => (this.controls.touchRotate = 0),
        { className: 'icon', title: 'Rotate right (D)' },
      ),
      createButton('STAGE', () => this.doStage(), {
        className: 'dock-text primary',
        title: 'Stage (Space)',
      }),
      labeledDock('SAS', this.sasBtn),
      labeledDock('', warpPair, clockCaption()),
      createButton('⦿', () => this.toggleMap(), { className: 'icon', title: 'Toggle map view (M)' }),
      createButton(
        '🪂',
        () => {
          const armed = this.session.activeRuntime.armParachutes();
          this.ctx.log(
            armed > 0 ? 'info' : 'warn',
            armed > 0
              ? `${armed} parachute(s) armed — deploying when conditions allow.`
              : 'No packed parachutes to arm.',
          );
        },
        { className: 'icon', title: 'Arm parachutes' },
      ),
      createButton('Π', () => this.toggleLegs(), { className: 'icon', title: 'Toggle landing legs (L)' }),
      createButton('⏸', () => this.togglePause(), { className: 'icon', title: 'Pause menu (Esc)' }),
    );

    bottom.append(controlRow);
    this.uiRoot.append(side, this.mapSide, bottom);
    uiParent.appendChild(this.uiRoot);
  }
}

function labeledDock(caption: string, control: HTMLElement, captionNode?: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'dock-labeled';
  const cap = captionNode ?? document.createElement('span');
  if (!captionNode) {
    cap.className = 'dock-caption';
    cap.textContent = caption;
  }
  wrap.append(cap, control);
  return wrap;
}

function clockCaption(): HTMLSpanElement {
  const cap = document.createElement('span');
  cap.className = 'dock-caption dock-clock';
  cap.title = 'Time warp';
  cap.setAttribute('aria-hidden', 'true');
  cap.innerHTML =
    '<svg viewBox="0 0 16 16" width="12" height="12">' +
    '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M8 4.5 V8 L10.5 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>' +
    '</svg>';
  return cap;
}
