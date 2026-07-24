import { cellsNear, nodesMatch } from './AttachmentNode';
import type { PartInstance } from './PartInstance';
import { instancesSurfaceAttached } from './SurfaceAttach';

/**
 * Connectivity-based staging (Phase 4). The old vertical-segment model is
 * gone; stages are now defined on the ATTACHMENT GRAPH, which makes radial
 * boosters and parallel staging work with the same rules as plain stacks:
 *
 *  - Every decoupler/engine has an ACTIVATION stage (1-based, "the N-th
 *    press of the STAGE button... plus one for engines lit from launch").
 *    Defaults: radial decouplers fire at stage 1; stack decouplers fire
 *    bottom-up after them; an engine ignites one stage after the last stack
 *    decoupler BELOW it in its own column (so core + booster engines all
 *    light at stage 1, upper-stage engines light when what's below departs).
 *    `custom.igniteStage` overrides any of these.
 *  - Firing a stage removes its decouplers; every connected component that
 *    loses the root (the pod) is jettisoned as its own debris group, with
 *    the fired decoupler leaving alongside the group it released.
 *  - FUEL GROUPS are the components left when ALL decouplers are cut:
 *    engines only drink from tanks in their own group (no crossfeed — TODO).
 *
 * For a plain vertical stack these rules reduce exactly to the previous
 * segment model, which keeps the regression sim bit-identical.
 */

export interface StagePlan {
  /** Activation stage per part (overrides applied), local 1-based. */
  activation: Map<PartInstance, number>;
  /** Activation stage per part ignoring overrides (context-menu "auto"). */
  defaultActivation: Map<PartInstance, number>;
  /** Highest activation stage present (>= 1). */
  totalStages: number;
  /** Fuel-isolation group id per non-decoupler part. */
  fuelGroup: Map<PartInstance, number>;
}

/** True when two parts share a node pair OR a KSP-style surface flush mate. */
export function partsAttached(a: PartInstance, b: PartInstance): boolean {
  for (const na of a.worldNodes()) {
    for (const nb of b.worldNodes()) {
      if (
        cellsNear(na.xCells, nb.xCells) &&
        cellsNear(na.yCells, nb.yCells) &&
        nodesMatch(na.kind, nb.kind)
      ) {
        return true;
      }
    }
  }
  return instancesSurfaceAttached(a, b);
}

export function buildAdjacency(parts: PartInstance[]): Map<PartInstance, PartInstance[]> {
  const adjacency = new Map<PartInstance, PartInstance[]>(parts.map((p) => [p, []]));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (partsAttached(parts[i], parts[j])) {
        adjacency.get(parts[i])!.push(parts[j]);
        adjacency.get(parts[j])!.push(parts[i]);
      }
    }
  }
  return adjacency;
}

/** Parts that RELEASE something when their stage fires (removed from the craft). */
export function isReleasePart(part: PartInstance): boolean {
  return part.def.category === 'decoupler' || part.def.category === 'clamp';
}

/** A release part that connects via left/right nodes (vs. a stack decoupler). */
export function isRadialDecoupler(part: PartInstance): boolean {
  return (
    isReleasePart(part) &&
    part.def.attachmentNodes.some((n) => n.kind === 'left' || n.kind === 'right')
  );
}

function isStackDecoupler(part: PartInstance): boolean {
  return isReleasePart(part) && !isRadialDecoupler(part);
}

/** The part whose TOP node coincides with `part`'s BOTTOM node (same column). */
function bottomNeighbor(part: PartInstance, parts: PartInstance[]): PartInstance | null {
  const bottoms = part.worldNodes().filter((n) => n.kind === 'bottom');
  if (bottoms.length === 0) return null;
  for (const other of parts) {
    if (other === part) continue;
    for (const node of other.worldNodes()) {
      if (
        node.kind === 'top' &&
        bottoms.some((b) => b.xCells === node.xCells && b.yCells === node.yCells)
      ) {
        return other;
      }
    }
  }
  return null;
}

/**
 * Compute activation stages and fuel groups. `stageOffset` shifts override
 * values into local numbering for a partially-staged vessel (overrides are
 * stored in the ORIGINAL global numbering; local = global - stagesFired).
 */
export function computeStagePlan(parts: PartInstance[], stageOffset = 0): StagePlan {
  const activation = new Map<PartInstance, number>();
  const defaultActivation = new Map<PartInstance, number>();

  const decouplers = parts.filter(isReleasePart);
  const radial = decouplers.filter(isRadialDecoupler);
  const stack = decouplers
    .filter((d) => !isRadialDecoupler(d))
    .sort((a, b) => a.yCells - b.yCells);

  const stackBase = radial.length > 0 ? 1 : 0;
  for (const dec of radial) defaultActivation.set(dec, 1);
  stack.forEach((dec, index) => defaultActivation.set(dec, index + 1 + stackBase));

  // Engines: one stage after the last stack decoupler below them in their
  // own column (radial decouplers hang sideways and don't delay ignition).
  for (const engine of parts.filter((p) => p.def.category === 'engine')) {
    let stageBelow = 0;
    const seen = new Set<PartInstance>([engine]);
    let below = bottomNeighbor(engine, parts);
    while (below && !seen.has(below)) {
      seen.add(below);
      if (isStackDecoupler(below)) {
        stageBelow = Math.max(stageBelow, defaultActivation.get(below) ?? 0);
      }
      below = bottomNeighbor(below, parts);
    }
    defaultActivation.set(engine, stageBelow + 1);
  }

  // Parachutes activate one stage after everything else by default (KSP
  // convention: chutes at the top of the stack), overridable like engines.
  let maxSoFar = 1;
  for (const v of defaultActivation.values()) maxSoFar = Math.max(maxSoFar, v);
  for (const part of parts.filter((p) => p.def.category === 'parachute')) {
    defaultActivation.set(part, maxSoFar + 1);
  }

  for (const [part, fallback] of defaultActivation) {
    const override = part.igniteStageOverride;
    activation.set(
      part,
      override === undefined ? fallback : Math.max(1, Math.round(override) - stageOffset),
    );
  }

  let totalStages = 1;
  for (const stage of activation.values()) totalStages = Math.max(totalStages, stage);

  // Fuel groups: connected components with every decoupler removed.
  const fuelGroup = new Map<PartInstance, number>();
  const adjacency = buildAdjacency(parts);
  let groupId = 0;
  for (const start of parts) {
    if (isReleasePart(start) || fuelGroup.has(start)) continue;
    groupId++;
    const queue = [start];
    fuelGroup.set(start, groupId);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (isReleasePart(next) || fuelGroup.has(next)) continue;
        fuelGroup.set(next, groupId);
        queue.push(next);
      }
    }
  }

  return { activation, defaultActivation, totalStages, fuelGroup };
}

export interface FireStageResult {
  kept: PartInstance[];
  /** Jettisoned connected components (fired decouplers included). */
  groups: PartInstance[][];
}

/**
 * Fire one activation stage (pure): removes the stage's decouplers, keeps
 * the component holding the root (a pod, else the largest component), and
 * returns every other component as a jettison group. Fired decouplers leave
 * with the group they released. Used by both RocketRuntime.stage() and the
 * static staging preview/analysis — single source of truth.
 */
export function fireStage(
  parts: PartInstance[],
  activation: Map<PartInstance, number>,
  stageNumber: number,
): FireStageResult {
  const firing = parts.filter(
    (p) => isReleasePart(p) && activation.get(p) === stageNumber,
  );
  if (firing.length === 0) return { kept: [...parts], groups: [] };

  const firingSet = new Set(firing);
  const remaining = parts.filter((p) => !firingSet.has(p));
  const adjacency = buildAdjacency(remaining);

  const componentOf = new Map<PartInstance, PartInstance[]>();
  const components: PartInstance[][] = [];
  for (const start of remaining) {
    if (componentOf.has(start)) continue;
    const component: PartInstance[] = [];
    const queue = [start];
    componentOf.set(start, component);
    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!componentOf.has(next)) {
          componentOf.set(next, component);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }

  const root =
    components.find((c) => c.some((p) => p.def.category === 'pod')) ??
    components.reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), components[0]);

  const groups = components.filter((c) => c !== root);

  // Each fired decoupler departs with an adjacent non-root component.
  const fullAdjacency = buildAdjacency(parts);
  for (const dec of firing) {
    const neighborGroup = (fullAdjacency.get(dec) ?? [])
      .map((n) => componentOf.get(n))
      .find((c) => c !== undefined && c !== root);
    if (neighborGroup) neighborGroup.push(dec);
    else groups.push([dec]); // dangling decoupler becomes its own debris
  }

  return { kept: root ?? [], groups };
}

export interface StagePreview {
  stageNumber: number;
  /** Engines that ignite at this stage (and are still attached then). */
  ignites: PartInstance[];
  /** Parachutes armed at this stage. */
  arms: PartInstance[];
  /** Groups that separate when this stage fires. */
  separates: PartInstance[][];
}

/** Static walkthrough of every stage, for the staging panel and analysis. */
export function previewStages(parts: PartInstance[]): StagePreview[] {
  const plan = computeStagePlan(parts);
  const previews: StagePreview[] = [];
  let current = [...parts];
  for (let stage = 1; stage <= plan.totalStages; stage++) {
    const ignites = current.filter(
      (p) => p.def.category === 'engine' && plan.activation.get(p) === stage,
    );
    const arms = current.filter(
      (p) => p.def.category === 'parachute' && plan.activation.get(p) === stage,
    );
    const { kept, groups } = fireStage(current, plan.activation, stage);
    previews.push({ stageNumber: stage, ignites, arms, separates: groups });
    current = kept;
  }
  return previews;
}
