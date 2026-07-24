import { Vec2 } from '../math/Vec2';
import { legContactPointsLocal, stackCoreCenterXCells } from '../vehicle/LandingLegs';
import type { PartInstance } from '../vehicle/PartInstance';
import type { RocketRuntime } from '../vehicle/RocketRuntime';
import { GRID_CELL_METERS } from '../config/constants';
import type { CelestialBody } from './CelestialBody';

/** Rotate stack-local (x right, y along heading) into world axes. */
function rotateLocalToWorld(local: Vec2, heading: number): Vec2 {
  return Vec2.fromAngle(heading, local.y).add(Vec2.fromAngle(heading - Math.PI / 2, local.x));
}

function baseOriginOf(parts: PartInstance[]): { xM: number; yM: number } | null {
  if (parts.length === 0) return null;
  let bottom = parts[0];
  for (const p of parts) {
    if (p.yCells < bottom.yCells) bottom = p;
  }
  return {
    xM: (bottom.xCells + bottom.widthCells / 2) * GRID_CELL_METERS,
    yM: bottom.yCells * GRID_CELL_METERS,
  };
}

/** Hull bottom corners in stack-local meters (relative to rocket.position). */
function hullContactPointsLocal(rocket: RocketRuntime): Vec2[] {
  const base = baseOriginOf(rocket.parts);
  if (!base) return [];
  const cell = GRID_CELL_METERS;
  const pts: Vec2[] = [Vec2.ZERO];
  for (const p of rocket.parts) {
    if (p.def.category === 'legs') continue;
    const y = p.yCells * cell - base.yM;
    const xL = p.xCells * cell - base.xM;
    const xR = (p.xCells + p.widthCells) * cell - base.xM;
    pts.push(new Vec2(xL, y), new Vec2(xR, y));
  }
  return pts;
}

function stackCenterXCells(parts: PartInstance[]): number {
  return stackCoreCenterXCells(
    parts.map((p) => ({
      xCells: p.xCells,
      widthCells: p.widthCells,
      category: p.def.category,
    })),
  );
}

/** All ground contact samples in stack-local meters. */
export function contactPointsLocal(rocket: RocketRuntime): Vec2[] {
  const base = baseOriginOf(rocket.parts);
  if (!base) return [];
  const centerX = stackCenterXCells(rocket.parts);
  const pts = hullContactPointsLocal(rocket);
  for (const p of rocket.parts) {
    for (const foot of legContactPointsLocal(p, base.xM, base.yM, centerX)) {
      pts.push(new Vec2(foot.x, foot.y));
    }
  }
  return pts;
}

function localToWorld(rocket: RocketRuntime, local: Vec2): Vec2 {
  return rocket.position.add(rotateLocalToWorld(local, rocket.angleRad));
}

/** Minimum altitude (m) of any contact point above the body surface. Negative = penetrating. */
export function minContactAltitudeM(
  rocket: RocketRuntime,
  bodyPos: Vec2,
  bodyRadiusM: number,
): number {
  let minAlt = Infinity;
  for (const local of contactPointsLocal(rocket)) {
    const world = localToWorld(rocket, local);
    const alt = world.sub(bodyPos).length() - bodyRadiusM;
    minAlt = Math.min(minAlt, alt);
  }
  return minAlt === Infinity ? rocket.position.sub(bodyPos).length() - bodyRadiusM : minAlt;
}

/** Raise the vessel along the surface normal until the lowest contact sits on the ground. */
export function clampToSurface(
  rocket: RocketRuntime,
  bodyPos: Vec2,
  bodyRadiusM: number,
): number {
  const minAlt = minContactAltitudeM(rocket, bodyPos, bodyRadiusM);
  if (minAlt >= 0) return minAlt;
  const radial = rocket.position.sub(bodyPos);
  const dist = radial.length();
  if (dist < 1e-6) return minAlt;
  rocket.position = bodyPos.add(radial.scale((dist - minAlt) / dist));
  return 0;
}

/** True when any deployed leg contributes a foot contact sample. */
export function landingOnDeployedLegs(rocket: RocketRuntime): boolean {
  const base = baseOriginOf(rocket.parts);
  if (!base) return false;
  const centerX = stackCenterXCells(rocket.parts);
  for (const p of rocket.parts) {
    if (p.def.category === 'legs' && p.legState === 'deployed') {
      const feet = legContactPointsLocal(p, base.xM, base.yM, centerX);
      if (feet.length > 0) return true;
    }
  }
  return false;
}

/** Inward radial speed toward the body surface, m/s (positive = moving into ground). */
export function inwardRadialSpeedMS(
  rocket: RocketRuntime,
  bodyPos: Vec2,
  bodyVel: Vec2,
): number {
  const radial = rocket.position.sub(bodyPos);
  const dist = radial.length();
  if (dist < 1e-6) return 0;
  const relVel = rocket.velocity.sub(bodyVel);
  return -relVel.dot(radial.scale(1 / dist));
}

/**
 * World velocity of a point fixed on the body's surface (or interior).
 * Bodies currently have no planetary spin, so every surface point shares the
 * body's center velocity (Earth = 0; Moon = its orbital velocity).
 * When spin is added, this becomes bodyVel + ω × r.
 */
export function surfaceVelocityAt(body: CelestialBody, _worldPos: Vec2, simTime: number): Vec2 {
  return body.velocityAt(simTime);
}

/** Unit outward normal of the spherical surface at a world point. */
export function surfaceNormalAt(worldPos: Vec2, bodyPos: Vec2): Vec2 {
  const radial = worldPos.sub(bodyPos);
  const dist = radial.length();
  if (dist < 1e-6) return new Vec2(0, 1);
  return radial.scale(1 / dist);
}

/**
 * Rest a vessel on the surface: seat contact points and match surface velocity
 * so the craft does not skate around the planet (fake "ice" sliding).
 */
export function stickToSurface(
  rocket: RocketRuntime,
  body: CelestialBody,
  simTime: number,
): void {
  const bodyPos = body.positionAt(simTime);
  clampToSurface(rocket, bodyPos, body.radiusM);
  rocket.velocity = surfaceVelocityAt(body, rocket.position, simTime);
  rocket.angularVelocityRadS = 0;
}

/**
 * Contact normal constraint only: cancel relative velocity into the surface
 * so engines can still produce outward lift-off velocity.
 */
export function applySurfaceNormalConstraint(
  rocket: RocketRuntime,
  bodyPos: Vec2,
  surfaceVel: Vec2,
): void {
  const n = surfaceNormalAt(rocket.position, bodyPos);
  const relVel = rocket.velocity.sub(surfaceVel);
  const intoGround = -relVel.dot(n); // positive = moving into the surface
  if (intoGround > 0) {
    rocket.velocity = rocket.velocity.add(n.scale(intoGround));
  }
}