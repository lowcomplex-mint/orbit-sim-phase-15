/**
 * Headless regression test for the whole simulation layer. Run: `npm run sim`.
 * Uses the exact modules the game runs (FlightSession is DOM-free by design).
 *
 * Covers: vehicle analysis (incl. thrust limiter), torque-based attitude,
 * ascent + staging (persistent debris), ignition-stage overrides, physics
 * warp, rails-warp gating/accuracy/handoff, save round-trip determinism,
 * SOI-aware (Moon-relative) telemetry, and Phase 10 recovery-loop sims
 * (parachutes, launch clamps, electricity, full descent mission).
 */
import { instantiateParts, validateDesign } from '../src/builder/RocketAssembler';
import { DEFAULT_ROCKET_DESIGN } from '../src/config/defaultRocket';
import { EARTH_CONFIG } from '../src/config/celestialBodies';
import { createPartCatalog } from '../src/config/parts';
import { airDensityAt } from '../src/physics/AtmosphereSystem';
import { computeOrbitInfo, orbitalPeriod } from '../src/math/OrbitMath';
import { Vec2 } from '../src/math/Vec2';
import { Telemetry } from '../src/flight/Telemetry';
import { CareerSystem, designCost } from '../src/systems/CareerSystem';
import { FlightSession } from '../src/systems/FlightSession';
import { TimeWarpMode } from '../src/systems/TimeWarpSystem';
import { analyzeVehicle } from '../src/systems/VehicleAnalysis';
import { stepRocket, type PhysicsEnvironment } from '../src/physics/RocketPhysics';
import { CHUTE_PRESETS } from '../src/vehicle/ProceduralPart';
import type { LegState } from '../src/vehicle/ProceduralPart';
import { RocketDesign } from '../src/vehicle/RocketDesign';
import { RocketRuntime } from '../src/vehicle/RocketRuntime';

const TARGET_APOAPSIS = 90_000; // m
const SAFE_ALTITUDE = 72_000; // just above the 70 km atmosphere

let failures = 0;
function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const catalog = createPartCatalog();
const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
const quietLog = (level: string, message: string) => {
  if (level !== 'info') console.log(`  [${level}] ${message}`);
};

function physicsEnv(session: FlightSession, heatingEnabled = false): PhysicsEnvironment {
  return {
    gravity: session.world.gravity,
    bodies: session.world.bodies,
    simTime: session.world.simTime,
    heatingEnabled,
  };
}

/** Minimal stack with a configured parachute (armed). */
function chuteTestRuntime(chuteConfig: (typeof CHUTE_PRESETS)[string]['config']) {
  const design = new RocketDesign('Chute test', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'pod-mk1', xCells: -1, yCells: 4 },
    {
      defId: 'parachute-1',
      xCells: -0.5,
      yCells: 6,
      custom: { chute: chuteConfig },
    },
  ]);
  const runtime = new RocketRuntime(instantiateParts(design, catalog));
  runtime.armParachutes();
  return { design, runtime, chute: runtime.parachutes[0]! };
}

// ---------------------------------------------------------------- analysis --
console.log('== Vehicle analysis ==');
const analysis = analyzeVehicle(instantiateParts(design, catalog), EARTH_CONFIG.surfaceGravity);
for (const s of analysis.stages) {
  console.log(
    `  Stage ${s.stageNumber}: thrust ${(s.thrustSeaLevelN / 1000).toFixed(0)}/` +
      `${(s.thrustVacuumN / 1000).toFixed(0)} kN, wet ${s.segmentWetKg.toFixed(0)} kg, ` +
      `dv ${s.deltaVSeaLevel.toFixed(0)}/${s.deltaVVacuum.toFixed(0)} m/s (SL/vac), ` +
      `TWR ${s.twrSeaLevel.toFixed(2)}`,
  );
}
check(analysis.stages.length === 2, 'two stages detected');
check(analysis.totalDeltaVVacuum > 4500, 'total vacuum delta-v above 4500 m/s');
check(analysis.warnings.length === 0, 'no analysis warnings for the stock rocket');

// Thrust limiter: half thrust => half TWR, delta-v unchanged.
const limitedDesign = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
const mule = limitedDesign.parts.find((p) => p.defId === 'engine-mule')!;
mule.custom = { ...mule.custom, thrustLimiter: 0.5 };
const limited = analyzeVehicle(instantiateParts(limitedDesign, catalog), EARTH_CONFIG.surfaceGravity);
check(
  Math.abs(limited.stages[0].twrSeaLevel - analysis.stages[0].twrSeaLevel / 2) < 0.01,
  'thrust limiter 50% halves stage-1 TWR',
);
check(
  Math.abs(limited.stages[0].deltaVVacuum - analysis.stages[0].deltaVVacuum) < 1,
  'thrust limiter leaves delta-v unchanged',
);

// Ignition-stage override: wisp lit at stage 1 -> analysis warns.
const overrideDesign = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
const wisp = overrideDesign.parts.find((p) => p.defId === 'engine-wisp')!;
wisp.custom = { ...wisp.custom, igniteStage: 1 };
const overridden = analyzeVehicle(instantiateParts(overrideDesign, catalog), EARTH_CONFIG.surfaceGravity);
check(
  overridden.warnings.some((w) => w.includes('ignition')),
  'custom ignition stage produces an analysis warning',
);

// ------------------------------------------------------------------ torque --
console.log('== Torque / attitude physics ==');
{
  const s = FlightSession.launchNew(RocketDesign.fromData(DEFAULT_ROCKET_DESIGN), catalog, quietLog);
  const r = s.activeRuntime;
  r.throttle = 1;
  while (r.landed && s.world.simTime < 10) s.update(0.5); // lift off first
  const angleBefore = r.angleRad;
  r.rotationInput = -1; // command a clockwise rate
  for (let i = 0; i < 4; i++) s.update(0.5); // 2 s of torque
  const turned = angleBefore - r.angleRad;
  const rateReached = -r.angularVelocityRadS;
  console.log(
    `  2 s of full input: turned ${((turned * 180) / Math.PI).toFixed(1)} deg, ` +
      `rate ${((rateReached * 180) / Math.PI).toFixed(1)} deg/s ` +
      `(I=${Math.round(r.momentOfInertiaKgM2)} kg*m2, wheels ${r.reactionWheelNm} N*m)`,
  );
  check(turned > 0.3 && turned < 2.4, 'full stack turns, but sluggishly (torque-limited)');
  check(rateReached > 0.3 && rateReached <= 1.25, 'angular rate approaches the commanded cap');
  r.rotationInput = 0;
  for (let i = 0; i < 6; i++) s.update(0.5); // 3 s of SAS damping
  check(Math.abs(r.angularVelocityRadS) < 0.05, 'SAS damps rotation when input stops');
}

// Ignition override actually lights the upper engine at liftoff.
{
  const s = FlightSession.launchNew(RocketDesign.fromData(overrideDesign.toData()), catalog, quietLog);
  check(s.activeRuntime.activeEngines.length === 2, 'ignition override lights both engines at stage 1');
}

// ------------------------------------------------------------------ ascent --
console.log('== Ascent ==');
const valid = validateDesign(design, catalog);
if (!valid.ok) {
  console.error('Default design invalid:', valid.problems);
  process.exit(1);
}

const session = FlightSession.launchNew(design, catalog, quietLog);
const rocket = session.activeRuntime;
const world = session.world;
const mu = world.earth.mu;

type Phase = 'ascent' | 'coast' | 'circularize' | 'done';
let phase: Phase = 'ascent';
let railsDenialTested = false;

const status = () => {
  const info = computeOrbitInfo(rocket.position, rocket.velocity, mu);
  return {
    info,
    alt: rocket.position.length() - world.earth.radiusM,
    apoAlt: info.apoapsisRadius - world.earth.radiusM,
    periAlt: info.periapsisRadius - world.earth.radiusM,
  };
};

while (phase !== 'done' && world.simTime < 4000 && !rocket.crashed) {
  session.update(0.5); // guidance at 2 Hz of simulated time (warp 1)
  const s = status();

  if (rocket.activeFuel <= 0.01 && rocket.canStage) {
    session.stage();
    console.log(
      `  t=${world.simTime.toFixed(0)}s STAGE -> ${rocket.currentStageNumber}/` +
        `${rocket.totalStageCount}, vessels now: ${session.vessels.vessels.length}`,
    );
    check(session.vessels.vessels.length === 2, 'staging spawned a persistent debris vessel');
  }

  const horizontalPrograde = rocket.position.angle() - Math.PI / 2;

  // The autopilot writes the heading directly (an idealized attitude hold);
  // the SAS controller damps angular velocity to zero between writes, so
  // the physical attitude model does not fight it.
  if (phase === 'ascent') {
    rocket.throttle = 1;
    const progress = Math.max(0, Math.min(1, s.apoAlt / TARGET_APOAPSIS));
    const pitchFromUp = Math.min(88, 90 * progress);
    rocket.angleRad = rocket.position.angle() - (pitchFromUp * Math.PI) / 180;
    if (s.apoAlt > TARGET_APOAPSIS) {
      rocket.throttle = 0;
      phase = 'coast';
      console.log(
        `  t=${world.simTime.toFixed(0)}s MECO at ${(s.alt / 1000).toFixed(1)} km, ` +
          `apoapsis ${(s.apoAlt / 1000).toFixed(1)} km`,
      );
      session.stepWarp(4);
      check(session.warp.mode !== TimeWarpMode.RailsWarp, 'rails warp denied inside the atmosphere');
      railsDenialTested = true;
    }
  } else if (phase === 'coast') {
    rocket.throttle = s.apoAlt < TARGET_APOAPSIS - 5000 ? 0.4 : 0;
    rocket.angleRad = rocket.velocity.angle();
    if (s.alt > SAFE_ALTITUDE && s.apoAlt - s.alt < 5000) {
      phase = 'circularize';
      console.log(
        `  t=${world.simTime.toFixed(0)}s circularization burn start at ` +
          `${(s.alt / 1000).toFixed(1)} km`,
      );
    }
  } else if (phase === 'circularize') {
    rocket.throttle = 1;
    rocket.angleRad = horizontalPrograde;
    if (s.periAlt > SAFE_ALTITUDE) {
      rocket.throttle = 0;
      phase = 'done';
      console.log(
        `  t=${world.simTime.toFixed(0)}s orbit achieved: ` +
          `${(s.periAlt / 1000).toFixed(1)} x ${(s.apoAlt / 1000).toFixed(1)} km, ` +
          `fuel left ${rocket.activeFuel.toFixed(0)} kg`,
      );
    }
  }
}

if (phase !== 'done' || !railsDenialTested) {
  console.error(`FAILED: phase=${phase}, crashed=${rocket.crashed}, t=${world.simTime.toFixed(0)}s`);
  process.exit(1);
}

// ------------------------------------------------- save round-trip fidelity --
console.log('== Save round-trip ==');
{
  const saved = session.serialize();
  const restored = FlightSession.fromSave(
    JSON.parse(JSON.stringify(saved)), // force a real JSON round-trip
    catalog,
    quietLog,
  );
  const a = session.activeRuntime;
  const b = restored.activeRuntime;
  check(
    a.position.distanceTo(b.position) < 1e-6 &&
      Math.abs(a.activeFuel - b.activeFuel) < 1e-9 &&
      restored.world.simTime === world.simTime &&
      restored.vessels.vessels.length === session.vessels.vessels.length,
    'serialize/restore reproduces the world exactly',
  );
  // Determinism: both worlds must evolve identically after the round-trip.
  for (let i = 0; i < 8; i++) {
    session.update(0.5);
    restored.update(0.5);
  }
  check(
    a.position.distanceTo(b.position) < 1e-6,
    'restored world stays bit-identical under integration',
  );
}

// ------------------------------------------- physics-warp integrator coast --
console.log('== Integrator coast (physics warp 4x) ==');
const s0 = status();
const period = orbitalPeriod(mu, s0.info.semiMajorAxis);
console.log(`  Orbital period: ${(period / 60).toFixed(1)} min. Coasting 3 orbits...`);

session.stepWarp(3);
check(session.warp.mode === TimeWarpMode.PhysicsWarp && session.warp.factor === 4,
  'physics warp capped at 4x');

let minAlt = Infinity;
const integratorCoastEnd = world.simTime + period * 3;
while (world.simTime < integratorCoastEnd && !rocket.crashed) {
  session.update(5);
  minAlt = Math.min(minAlt, rocket.position.length() - world.earth.radiusM);
}
const s1 = status();
console.log(
  `  After 3 integrated orbits: ${(s1.periAlt / 1000).toFixed(1)} x ` +
    `${(s1.apoAlt / 1000).toFixed(1)} km, min altitude ${(minAlt / 1000).toFixed(1)} km`,
);
check(minAlt > 70_000, 'orbit stayed above the atmosphere (integrator)');
check(!rocket.crashed, 'no crash during integrator coast');

// -------------------------------------------------------------- rails warp --
console.log('== Rails warp ==');
for (let i = 0; i < 7; i++) session.stepWarp(1);
check(session.warp.mode === TimeWarpMode.RailsWarp, 'rails warp engaged on stable orbit');

const preRails = status();
const railsEnd = world.simTime + period * 3;
while (world.simTime < railsEnd) session.update(0.5);
const postRails = status();
check(
  Math.abs(postRails.periAlt - preRails.periAlt) < 100 &&
    Math.abs(postRails.apoAlt - preRails.apoAlt) < 100,
  'rails propagation preserved the orbit elements (<100 m drift)',
);

for (let i = 0; i < 7; i++) session.stepWarp(-1);
let handoffMinAlt = Infinity;
const handoffEnd = world.simTime + period;
session.stepWarp(3);
while (world.simTime < handoffEnd && !rocket.crashed) {
  session.update(5);
  handoffMinAlt = Math.min(handoffMinAlt, rocket.position.length() - world.earth.radiusM);
}
check(handoffMinAlt > 70_000 && !rocket.crashed,
  'integrator continued cleanly after rails handoff');

// Suborbital return: rails allowed in vacuum, drops on atmosphere entry.
for (let i = 0; i < 7; i++) session.stepWarp(-1);
rocket.throttle = 0;
const R = world.earth.radiusM;
const atmH = 70_000;
rocket.position = new Vec2(0, R + 200_000);
rocket.velocity = new Vec2(2000, 0);
rocket.landed = false;
const subInfo = computeOrbitInfo(rocket.position, rocket.velocity, mu);
check(
  subInfo.isBound && subInfo.periapsisRadius < R + atmH,
  'test trajectory is suborbital (periapsis inside atmosphere)',
);
check(session.checkRailsEligibility().ok, 'rails warp allowed on suborbital arc outside atmosphere');
for (let i = 0; i < 5; i++) session.stepWarp(1);
check(session.warp.mode === TimeWarpMode.RailsWarp, 'rails warp engages on suborbital coast');
const t0 = world.simTime;
while (world.simTime < t0 + 5000 && session.warp.mode === TimeWarpMode.RailsWarp) {
  session.update(1);
}
check(session.warp.mode !== TimeWarpMode.RailsWarp, 'rails warp drops on atmosphere entry');
check(!rocket.crashed, 'suborbital rails handoff did not crash');

// --------------------------------------------------- SOI-aware telemetry --
console.log('== Moon SOI telemetry ==');
{
  // Teleport the vessel into the Moon's SOI on a circular moon orbit and
  // confirm telemetry reports Moon-relative numbers.
  const t = world.simTime;
  const moon = world.moon;
  const moonPos = moon.positionAt(t);
  const moonVel = moon.velocityAt(t);
  const orbitR = moon.radiusM + 50_000;
  rocket.position = moonPos.add(new Vec2(orbitR, 0));
  rocket.velocity = moonVel.add(new Vec2(0, Math.sqrt(moon.mu / orbitR)));
  rocket.landed = false;

  const sample = new Telemetry(session).sample();
  console.log(
    `  Body: ${sample.bodyName}, alt ${(sample.altitudeM / 1000).toFixed(1)} km, ` +
      `status ${sample.status}`,
  );
  check(sample.bodyName === 'Moon', 'dominant body detected as the Moon');
  check(Math.abs(sample.altitudeM - 50_000) < 100, 'altitude is Moon-relative');
  check(sample.status === 'orbiting', 'circular lunar orbit classified as orbiting');
  // Moon-relative rails warp is now supported: a stable lunar orbit is
  // eligible, and rails propagation preserves it relative to the moving Moon.
  check(session.checkRailsEligibility().ok, 'rails warp allowed on a stable lunar orbit');
  session.stepWarp(-3); // physics 4x -> 1x
  for (let i = 0; i < 5; i++) session.stepWarp(1); // climb into rails warp
  check(session.warp.mode === TimeWarpMode.RailsWarp, 'rails warp engages inside the Moon SOI');
  const railsStartR = rocket.position.sub(moon.positionAt(world.simTime)).length();
  for (let i = 0; i < 200; i++) session.update(1); // analytic propagation
  const railsEndR = rocket.position.sub(moon.positionAt(world.simTime)).length();
  console.log(
    `  Lunar rails radius ${(railsStartR / 1000).toFixed(1)} -> ` +
      `${(railsEndR / 1000).toFixed(1)} km`,
  );
  check(
    Math.abs(railsEndR - orbitR) < 1000,
    'lunar orbit preserved under Moon-relative rails warp',
  );

  // Hand back to the integrator and confirm the Moon still holds the vessel.
  for (let i = 0; i < 5; i++) session.stepWarp(-1); // rails -> 1x
  session.stepWarp(3); // physics 4x
  const end = world.simTime + 1000;
  while (world.simTime < end) session.update(5);
  const relR = rocket.position.sub(moon.positionAt(world.simTime)).length();
  console.log(`  After 1000 s integrated: lunar orbit radius ${(relR / 1000).toFixed(1)} km`);
  check(
    relR > moon.radiusM && Math.abs(relR - orbitR) < orbitR * 0.25,
    'vessel stays in a bound lunar orbit under integration',
  );
}

// ------------------------------------------------------- radial boosters --
console.log('== Radial boosters ==');
{
  const boosterDesign = new RocketDesign('Booster Test', [
    // Core (stock orbiter layout)
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    { defId: 'procedural-fuel-tank', xCells: -1, yCells: 2, custom: { widthCells: 2, heightCells: 4 } },
    {
      defId: 'procedural-decoupler',
      xCells: -1,
      yCells: 6,
      custom: { widthCells: 2, heightCells: 1 },
    },
    { defId: 'engine-wisp', xCells: -1, yCells: 7 },
    { defId: 'procedural-fuel-tank', xCells: -1, yCells: 9, custom: { widthCells: 2, heightCells: 2 } },
    { defId: 'pod-mk1', xCells: -1, yCells: 11 },
    // Right booster: engine + tank + nose, hung on a radial decoupler.
    { defId: 'radial-decoupler', xCells: 1, yCells: 3 },
    { defId: 'engine-mule', xCells: 2, yCells: 0 },
    { defId: 'procedural-fuel-tank', xCells: 2, yCells: 2, custom: { widthCells: 2, heightCells: 4 } },
    { defId: 'nose-cone', xCells: 2, yCells: 6 },
    // Left booster (mirror).
    { defId: 'radial-decoupler', xCells: -2, yCells: 3 },
    { defId: 'engine-mule', xCells: -4, yCells: 0 },
    { defId: 'procedural-fuel-tank', xCells: -4, yCells: 2, custom: { widthCells: 2, heightCells: 4 } },
    { defId: 'nose-cone', xCells: -4, yCells: 6 },
  ]);

  const boosterValid = validateDesign(boosterDesign, catalog);
  check(boosterValid.ok, `booster design validates (${boosterValid.problems.join('; ')})`);

  const boosterAnalysis = analyzeVehicle(
    instantiateParts(boosterDesign, catalog),
    EARTH_CONFIG.surfaceGravity,
  );
  console.log(
    `  Stages: ${boosterAnalysis.stages.length}, liftoff thrust ` +
      `${(boosterAnalysis.stages[0].thrustSeaLevelN / 1000).toFixed(0)} kN, ` +
      `TWR ${boosterAnalysis.stages[0].twrSeaLevel.toFixed(2)}, ` +
      `CoM offset ${boosterAnalysis.comLateralOffsetM?.toFixed(3)} m`,
  );
  check(boosterAnalysis.stages.length === 3, 'boosters add a third stage');
  check(
    Math.abs(boosterAnalysis.stages[0].thrustSeaLevelN - 3 * 95_000) < 1,
    'all three engines lit at stage 1',
  );
  check(
    Math.abs(boosterAnalysis.comLateralOffsetM ?? 99) < 1e-9,
    'symmetric design has zero lateral CoM offset',
  );
  check(
    boosterAnalysis.warnings.some((w) => w.includes('Parallel')),
    'parallel-staging approximation is flagged',
  );

  const bs = FlightSession.launchNew(boosterDesign, catalog, quietLog);
  const br = bs.activeRuntime;
  check(br.activeEngines.length === 3, 'runtime lights core + both boosters at launch');
  br.throttle = 1;
  for (let i = 0; i < 20; i++) bs.update(0.5); // 10 s of symmetric ascent
  check(!br.landed && !br.crashed, 'booster rocket lifts off');
  check(Math.abs(br.angularVelocityRadS) < 0.01, 'symmetric thrust produces no net rotation');

  // Booster separation: one press drops BOTH side groups at once.
  bs.stage();
  check(
    bs.vessels.vessels.length === 3,
    'one staging event produced two debris vessels (both boosters)',
  );
  check(br.activeEngines.length === 1, 'core engine still lit after booster separation');
  check(br.parts.length === 6, 'core stack intact after booster separation');

  // Asymmetric thrust: keep flying on the core while a "stuck" booster
  // configuration is tested separately below.
  for (let i = 0; i < 10; i++) bs.update(0.5);
  check(!br.crashed, 'core continues flying after separation');
}

// Asymmetric thrust: the ONLY engine hangs on one side, so its torque about
// the CoM far exceeds the control authority — the vessel must spin. (With a
// core engine burning too, the CoM sits between the engines and the torques
// nearly cancel — physically correct and SAS-holdable, so not a spin test.)
{
  const asym = new RocketDesign('Asymmetric Test', [
    { defId: 'procedural-fuel-tank', xCells: -1, yCells: 2, custom: { widthCells: 2, heightCells: 4 } },
    { defId: 'pod-mk1', xCells: -1, yCells: 6 },
    { defId: 'radial-decoupler', xCells: 1, yCells: 3 },
    { defId: 'engine-mule', xCells: 2, yCells: 0 },
    { defId: 'procedural-fuel-tank', xCells: 2, yCells: 2, custom: { widthCells: 2, heightCells: 4 } },
    { defId: 'nose-cone', xCells: 2, yCells: 6 },
  ]);
  const as = FlightSession.launchNew(asym, catalog, quietLog);
  const ar = as.activeRuntime;
  ar.throttle = 1;
  for (let i = 0; i < 12; i++) as.update(0.5); // 6 s
  console.log(
    `  Asymmetric: angular velocity ${((ar.angularVelocityRadS * 180) / Math.PI).toFixed(1)} deg/s ` +
      `after 6 s of one-sided thrust`,
  );
  check(
    Math.abs(ar.angularVelocityRadS) > 0.5,
    'one-sided thrust torque overwhelms SAS (vessel spins)',
  );
}

// ---------------------------------------------------------------- thermal --
console.log('== Reentry heating ==');
{
  // Steep hot reentry: pod + tank + engine falling engine-first from 65 km.
  const reentryDesign = new RocketDesign('Reentry Test', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    { defId: 'procedural-fuel-tank', xCells: -1, yCells: 2, custom: { widthCells: 2, heightCells: 2 } },
    { defId: 'pod-mk1', xCells: -1, yCells: 4 },
  ]);
  const rs = FlightSession.launchNew(reentryDesign, catalog, quietLog);
  const rr = rs.activeRuntime;
  const R = rs.world.earth.radiusM;
  // "Wind tunnel": pin altitude/speed each frame so drag/gravity cannot end
  // the test early — pure thermal behavior under sustained hot flow.
  const pinPos = new Vec2(0, R + 30_000);
  const pinVel = new Vec2(2900, 0); // hot enough that even the engine's
  // radiative equilibrium (T_eq ~ 2440 K) exceeds its 2200 K limit
  rr.landed = false;
  rr.sasMode = 'off';

  const ambient = rr.parts[0].temperatureK;
  let lostSomething = false;
  let peakTemp = 0;
  for (let i = 0; i < 300; i++) {
    rr.position = pinPos;
    rr.velocity = pinVel;
    rr.angleRad = Math.PI / 2;
    const ev = rs.update(0.5);
    peakTemp = Math.max(peakTemp, ...rr.parts.map((p) => p.temperatureK));
    if (ev.partsLost.length > 0) {
      lostSomething = true;
      break;
    }
  }
  console.log(
    `  Peak part temperature ${peakTemp.toFixed(0)} K (ambient ${ambient.toFixed(0)} K), ` +
      `part lost: ${lostSomething}`,
  );
  check(peakTemp > ambient + 200, 'sustained hot flow heats the vessel');
  check(lostSomething, 'unshielded hot flight destroys a part');

  // Same entry with heating disabled: nothing heats, nothing dies.
  const cold = FlightSession.launchNew(
    RocketDesign.fromData(reentryDesign.toData()),
    catalog,
    quietLog,
    { heatingEnabled: () => false },
  );
  const cr = cold.activeRuntime;
  cr.position = new Vec2(0, R + 65_000);
  cr.velocity = new Vec2(2400, -1200);
  cr.landed = false;
  let coldLost = false;
  for (let i = 0; i < 120 && !cr.crashed; i++) {
    if (cold.update(0.5).partsLost.length > 0) coldLost = true;
  }
  check(!coldLost, 'heating difficulty toggle disables thermal destruction');
}

// -------------------------------------------------------------------- SAS --
console.log('== SAS prograde hold ==');
{
  const s = FlightSession.launchNew(RocketDesign.fromData(DEFAULT_ROCKET_DESIGN), catalog, quietLog);
  const r = s.activeRuntime;
  const R = s.world.earth.radiusM;
  r.position = new Vec2(0, R + 100_000);
  r.velocity = new Vec2(2300, 300); // prograde ~7.4 deg above +X
  r.landed = false;
  r.angleRad = Math.PI / 2; // start pointing straight up
  r.sasMode = 'prograde';
  for (let i = 0; i < 16; i++) s.update(0.5); // 8 s
  const error = Math.abs(
    ((r.angleRad - r.velocity.angle() + Math.PI) % (2 * Math.PI)) - Math.PI,
  );
  console.log(`  Heading error after 8 s: ${((error * 180) / Math.PI).toFixed(1)} deg`);
  check(error < 0.15, 'SAS prograde converges onto the velocity vector');
}

// ------------------------------------------------------------------ career --
console.log('== Career foundations ==');
{
  const logs: string[] = [];
  const career = new CareerSystem((_l, m) => logs.push(m));
  const fundsBefore = career.state.funds;
  career.award('firstOrbit', 100);
  career.award('firstOrbit', 200); // duplicate must not double-pay
  check(
    career.state.funds === fundsBefore + 25_000 && career.state.science === 25,
    'milestone awards once and pays out',
  );
  career.chargeLaunch(designCost(design, catalog), design.name);
  check(designCost(design, catalog) > 3000, 'stock rocket has a realistic launch cost');
  const roundTrip = JSON.parse(JSON.stringify(career.serialize()));
  const restored = new CareerSystem((_l, m) => logs.push(m));
  restored.restore(roundTrip);
  check(
    restored.state.funds === career.state.funds &&
      restored.state.milestones.firstOrbit === 100,
    'career state survives serialization',
  );
}

// ------------------------------------------------------- landing legs (P8) --
console.log('== Landing legs ==');
{
  const legDesign = new RocketDesign('Leg test', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 2 },
    { defId: 'pod-mk1', xCells: -1, yCells: 4 },
  ]);
  const legValid = validateDesign(legDesign, catalog);
  check(legValid.ok, `leg test design validates (${legValid.problems.join('; ')})`);

  const touchdown = (legState: LegState, impactSpeedMS: number) => {
    const parts = instantiateParts(legDesign, catalog);
    for (const p of parts) {
      if (p.def.category === 'legs') p.legState = legState;
    }
    const runtime = new RocketRuntime(parts);
    runtime.spawnAt(new Vec2(0, EARTH_CONFIG.radiusM));
    runtime.landed = false;
    runtime.velocity = new Vec2(0, -impactSpeedMS);
    const session = FlightSession.launchNew(legDesign, catalog, quietLog);
    stepRocket(runtime, {
      gravity: session.world.gravity,
      bodies: session.world.bodies,
      simTime: 0,
      heatingEnabled: false,
    }, 1 / 60);
    const leg = runtime.parts.find((p) => p.def.category === 'legs')!;
    return { crashed: runtime.crashed, landed: runtime.landed, legState: leg.legState };
  };

  const soft = touchdown('deployed', 8);
  check(soft.landed && !soft.crashed && soft.legState === 'deployed', 'deployed legs survive a soft touchdown');

  const stowedHard = touchdown('stowed', 15);
  check(stowedHard.crashed, 'stowed legs crash at 15 m/s (no tolerance bonus)');

  const deployedHard = touchdown('deployed', 15);
  check(
    deployedHard.landed && !deployedHard.crashed && deployedHard.legState === 'broken',
    'deployed legs break but vehicle survives at 15 m/s',
  );

  const excessive = touchdown('deployed', 25);
  check(excessive.crashed, 'deployed legs still crash above leg tolerance (25 m/s)');

  // Soft land with residual horizontal speed must stick — no skating around Earth.
  {
    const parts = instantiateParts(legDesign, catalog);
    for (const p of parts) {
      if (p.def.category === 'legs') p.legState = 'deployed';
    }
    const runtime = new RocketRuntime(parts);
    runtime.spawnAt(new Vec2(0, EARTH_CONFIG.radiusM));
    runtime.landed = false;
    runtime.velocity = new Vec2(40, -6); // lateral + soft vertical
    const session = FlightSession.launchNew(legDesign, catalog, quietLog);
    const env = physicsEnv(session);
    stepRocket(runtime, env, 1 / 60);
    check(runtime.landed && !runtime.crashed, 'lateral soft land still counts as landed');
    check(runtime.velocity.length() < 0.05, 'soft land sticks to surface (no residual skate velocity)');
    const x0 = runtime.position.x;
    for (let i = 0; i < 600; i++) stepRocket(runtime, env, 1 / 60);
    check(Math.abs(runtime.position.x - x0) < 0.5, 'resting vessel does not skate along the surface');
    check(runtime.landed, 'resting vessel stays landed over 10 s');
  }
}

// -------------------------------------------------------- parachutes (P10) --
console.log('== Parachutes ==');
{
  const session = FlightSession.launchNew(
    RocketDesign.fromData(DEFAULT_ROCKET_DESIGN),
    catalog,
    quietLog,
  );
  const env = physicsEnv(session);
  const R = EARTH_CONFIG.radiusM;
  const dt = 1 / 60;

  const combo = chuteTestRuntime(CHUTE_PRESETS.combo.config);
  combo.runtime.position = new Vec2(0, R + 4500);
  combo.runtime.velocity = new Vec2(90, 0);
  combo.runtime.landed = false;
  combo.runtime.angleRad = Math.PI / 2;
  let dragBefore = 0;
  for (let i = 0; i < 360; i++) {
    dragBefore = combo.runtime.chuteDragCdA;
    stepRocket(combo.runtime, env, dt);
  }
  check(combo.chute.drogueFraction >= 1, 'combo drogue deploys below 4× main altitude');
  check(
    airDensityAt(session.world.earth, 4500) > 1e-5,
    'drogue test runs inside the atmosphere',
  );

  combo.runtime.position = new Vec2(0, R + 900);
  combo.runtime.velocity = new Vec2(35, -15);
  combo.chute.drogueFraction = 1;
  for (let i = 0; i < 720; i++) stepRocket(combo.runtime, env, dt);
  check(
    combo.chute.mainFraction > 0.4 || combo.chute.chuteState === 'deployed',
    'main canopy opens below deploy altitude',
  );
  check(
    combo.runtime.chuteDragCdA > dragBefore + 0.5,
    'deployed canopy adds substantial drag',
  );

  const unsafe = chuteTestRuntime(CHUTE_PRESETS.smallMain.config);
  unsafe.runtime.position = new Vec2(0, R + 1000);
  unsafe.runtime.velocity = new Vec2(40, -8);
  unsafe.runtime.landed = false;
  unsafe.runtime.angleRad = Math.PI / 2;
  for (let i = 0; i < 900; i++) stepRocket(unsafe.runtime, env, dt);
  check(unsafe.chute.mainFraction > 0.2, 'main opens inside the safe envelope first');
  unsafe.runtime.velocity = new Vec2(360, 0);
  for (let i = 0; i < 120; i++) stepRocket(unsafe.runtime, env, dt);
  check(unsafe.chute.chuteState === 'failed', 'chute fails outside the safe speed envelope');
}

// ---------------------------------------------------- launch clamps (P10) --
console.log('== Launch clamps ==');
{
  const clampDesign = new RocketDesign('Clamp test', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'pod-mk1', xCells: -1, yCells: 4 },
    {
      defId: 'launch-clamp',
      xCells: -3,
      yCells: 0,
      custom: { igniteStage: 2, heightCells: 4, clampUmbilicalCells: 2 },
    },
  ]);
  const clampValid = validateDesign(clampDesign, catalog);
  check(clampValid.ok, `clamp design validates (${clampValid.problems.join('; ')})`);

  const cs = FlightSession.launchNew(clampDesign, catalog, quietLog);
  const cr = cs.activeRuntime;
  const padY = cr.position.y;
  cr.throttle = 1;
  for (let i = 0; i < 24; i++) cs.update(0.5);
  check(cr.hasLaunchClamps, 'clamps hold the vessel on the pad');
  check(Math.abs(cr.position.y - padY) < 0.2, 'clamped vessel does not translate under thrust');

  check(cs.stage() !== null, 'stage 1 fires while clamps remain');
  check(cr.hasLaunchClamps, 'clamp still attached after its ignition stage');
  const pinnedY = cr.position.y;
  for (let i = 0; i < 16; i++) cs.update(0.5);
  check(Math.abs(cr.position.y - pinnedY) < 0.2, 'vessel stays pinned through stage-1 burn');

  const vesselCountBefore = cs.vessels.vessels.length;
  check(cs.stage() !== null, 'stage 2 releases the clamp');
  check(!cr.hasLaunchClamps, 'active vessel no longer reports launch clamps');
  check(!cr.parts.some((p) => p.def.category === 'clamp'), 'clamp part removed from active stack');
  check(
    cs.vessels.vessels.length > vesselCountBefore,
    'released clamp becomes a separate debris vessel',
  );
  check(
    cs.vessels.vessels.some((v) =>
      v.runtime.parts.some((p) => p.def.category === 'clamp'),
    ),
    'debris vessel still contains the clamp part',
  );

  for (let i = 0; i < 40; i++) cs.update(0.5);
  check(!cr.landed && cr.position.y > padY + 2, 'vessel lifts off once clamps are gone');
}

// ------------------------------------------------------ electricity (P10) --
console.log('== Electricity ==');
{
  const elecDesign = new RocketDesign('Electric test', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'probe-1', xCells: -1, yCells: 4 },
    { defId: 'battery-1', xCells: -2, yCells: 4 },
    { defId: 'solar-1', xCells: 1, yCells: 4 },
  ]);
  const es = FlightSession.launchNew(elecDesign, catalog, quietLog);
  const er = es.activeRuntime;
  const charge0 = er.electricCharge;
  er.throttle = 1;
  while (er.landed && es.world.simTime < 12) es.update(0.5);
  for (let i = 0; i < 20; i++) es.update(0.5);
  check(!er.landed, 'electric test stack lifts off');
  check(er.electricCharge > 0, 'battery stays charged during sunlit ascent');

  const probeOnly = new RocketRuntime(
    instantiateParts(new RocketDesign('Probe wheel test', [{ defId: 'probe-1', xCells: -1, yCells: 0 }]), catalog),
  );
  const R = EARTH_CONFIG.radiusM;
  probeOnly.spawnAt(new Vec2(0, R + 250_000));
  probeOnly.landed = false;
  probeOnly.electricCharge = 0.5;
  probeOnly.sasMode = 'stability';
  probeOnly.rotationInput = 1;
  const env = physicsEnv(es);
  for (let i = 0; i < 30; i++) stepRocket(probeOnly, env, 0.5);
  check(probeOnly.electricCharge === 0, 'probe battery drains to zero in eclipse (no sun)');
  check(probeOnly.reactionWheelNm === 0, 'reaction wheels offline at zero charge');

  probeOnly.angularVelocityRadS = 0;
  for (let i = 0; i < 24; i++) stepRocket(probeOnly, env, 0.5);
  check(
    Math.abs(probeOnly.angularVelocityRadS) < 0.03,
    'depleted probe cannot SAS-spin (no wheel torque)',
  );

  probeOnly.electricCharge = probeOnly.electricCapacity;
  check(probeOnly.reactionWheelNm > 0, 'charged probe regains wheel torque');
  probeOnly.angularVelocityRadS = 0;
  probeOnly.sasMode = 'off';
  for (let i = 0; i < 37; i++) stepRocket(probeOnly, env, 0.5);
  check(
    Math.abs(probeOnly.angularVelocityRadS) > 0.05,
    'charged probe spins under player rotation input',
  );

  probeOnly.electricCharge = 15;
  probeOnly.sasMode = 'stability';
  for (let i = 0; i < 240; i++) probeOnly.updateElectricity(0.5, 0);
  check(probeOnly.electricCharge < 8, 'eclipse drain draws the battery down without solar');
  er.electricCharge = charge0;
  er.sasMode = 'off';
  for (let i = 0; i < 60; i++) er.updateElectricity(0.5, 0);
  const eclipseDrain = er.electricCharge;
  for (let i = 0; i < 120; i++) er.updateElectricity(0.5, 1);
  check(er.electricCharge > eclipseDrain, 'solar panels recharge the battery after eclipse');
}

// --------------------------------------------- full recovery mission (P10) --
console.log('== Full recovery mission ==');
{
  const recoveryDesign = new RocketDesign('Recovery capstone', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 2 },
    { defId: 'legs-1', xCells: 1, yCells: 2 },
    { defId: 'pod-mk1', xCells: -1, yCells: 5 },
    {
      defId: 'parachute-1',
      xCells: -0.5,
      yCells: 7,
      custom: { chute: CHUTE_PRESETS.combo.config },
    },
    {
      defId: 'launch-clamp',
      xCells: -3,
      yCells: 0,
      custom: { igniteStage: 2, heightCells: 4, clampUmbilicalCells: 2 },
    },
  ]);
  const recValid = validateDesign(recoveryDesign, catalog);
  check(recValid.ok, `recovery design validates (${recValid.problems.join('; ')})`);

  const rs = FlightSession.launchNew(recoveryDesign, catalog, quietLog);
  const rr = rs.activeRuntime;
  const R = EARTH_CONFIG.radiusM;
  const padY = rr.position.y;

  rr.throttle = 1;
  while (rr.hasLaunchClamps && rs.world.simTime < 8) rs.update(0.5);
  check(rr.hasLaunchClamps, 'mission starts clamped to the pad');
  rs.stage();
  check(rr.hasLaunchClamps, 'first stage leaves clamps engaged');
  rs.stage();
  check(!rr.hasLaunchClamps, 'second stage releases clamps');
  for (let i = 0; i < 24; i++) rs.update(0.5);
  check(rr.position.y > padY + 5, 'mission ascends after clamp release');

  rr.position = new Vec2(0, R + 3500);
  rr.velocity = new Vec2(35, -55);
  rr.landed = false;
  rr.angleRad = Math.PI / 2;
  rr.armParachutes();
  for (const p of rr.parts) {
    if (p.def.category === 'legs') p.legState = 'deployed';
  }

  let landed = false;
  for (let i = 0; i < 10_000 && !rr.crashed; i++) {
    rs.update(1 / 30);
    if (rr.landed) {
      landed = true;
      break;
    }
  }
  const chute = rr.parachutes[0]!;
  console.log(
    `  Touchdown: landed=${landed}, crashed=${rr.crashed}, ` +
      `chute=${chute.chuteState}, legs=${rr.parts.filter((p) => p.def.category === 'legs').map((p) => p.legState).join('/')}`,
  );
  check(landed && !rr.crashed, 'recovery mission lands without crashing');
  check(
    chute.chuteState === 'deployed' || chute.mainFraction > 0.5,
    'parachutes deployed before touchdown',
  );
  check(
    rr.parts.filter((p) => p.def.category === 'legs').every((p) => p.legState !== 'stowed'),
    'landing struts were deployed for touchdown',
  );
}

// ------------------------------------------------------------ engine plate --
console.log('== Procedural engine plate ==');
{
  const plateDesign = new RocketDesign('Cluster Test', [
    { defId: 'engine-mule', xCells: -2, yCells: 0 },
    { defId: 'engine-mule', xCells: 0, yCells: 0 },
    { defId: 'engine-plate', xCells: -2, yCells: 2, custom: { widthCells: 4, heightCells: 1 } },
    { defId: 'procedural-fuel-tank', xCells: -2, yCells: 3, custom: { widthCells: 4, heightCells: 4 } },
    { defId: 'pod-mk1', xCells: -1, yCells: 7 },
  ]);
  const valid = validateDesign(plateDesign, catalog);
  check(valid.ok, `engine-plate cluster validates (${valid.problems.join('; ')})`);
  const a = analyzeVehicle(instantiateParts(plateDesign, catalog), EARTH_CONFIG.surfaceGravity);
  console.log(
    `  Cluster: thrust ${(a.stages[0].thrustSeaLevelN / 1000).toFixed(0)} kN, ` +
      `dv(vac) ${a.stages[0].deltaVVacuum.toFixed(0)} m/s`,
  );
  check(Math.abs(a.stages[0].thrustSeaLevelN - 190_000) < 1, 'both cluster engines lit');
  check(a.stages[0].deltaVVacuum > 500, 'fuel flows through the engine plate');
}

// ----------------------------------------------------------------- summary --
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nSUCCESS: all simulation checks passed.');
