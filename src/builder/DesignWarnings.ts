import type { PartCategory, PartDefinition } from '../vehicle/PartDefinition';
import type { RocketDesign } from '../vehicle/RocketDesign';

export type DesignWarningCode =
  | 'no-control-source'
  | 'crewed-return-without-parachute'
  | 'landing-leg-not-on-flank';

/** A live, advisory VAB gameplay check. Structural validity stays Phase 11. */
export interface DesignWarning {
  code: DesignWarningCode;
  message: string;
  /** Stable ids involved, suitable for future click-to-highlight UI. */
  partIds: string[];
}

/** Categories that represent a load-bearing vehicle hull flank. */
const HULL_CATEGORIES = new Set<PartCategory>([
  'pod',
  'tank',
  'engine',
  'nose',
  'structural',
  'heatshield',
]);

function componentFrom(
  startId: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const visited = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return visited;
}

/**
 * Phase 12 gameplay-rule warnings. These do not block launch; validateDesign
 * remains the authority for launch-blocking structural and minimum-part rules.
 *
 * The caller must provide a graph-synced design (stable ids + current edges).
 * Keeping this analyzer read-only prevents a UI advisory from changing the
 * craft it is inspecting. BuilderScene satisfies the precondition via
 * design.ensureTree() before refreshing the engineering panel.
 */
export function analyzeDesignWarnings(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): DesignWarning[] {
  if (design.isEmpty) return [];

  const warnings: DesignWarning[] = [];
  const byId = new Map(design.parts.filter((part) => part.id).map((part) => [part.id!, part]));
  const categoryOf = (id: string) => catalog.get(byId.get(id)?.defId ?? '')?.category;
  const adjacency = new Map<string, string[]>();
  for (const edge of design.edges) {
    // Recovery advisories follow the component that remains after all release
    // parts fire. A chute on a jettisoned booster must not satisfy a crewed
    // capsule's return warning.
    if (
      categoryOf(edge.partAId) === 'decoupler' ||
      categoryOf(edge.partBId) === 'decoupler' ||
      categoryOf(edge.partAId) === 'clamp' ||
      categoryOf(edge.partBId) === 'clamp'
    ) {
      continue;
    }
    const fromA = adjacency.get(edge.partAId) ?? [];
    fromA.push(edge.partBId);
    adjacency.set(edge.partAId, fromA);
    const fromB = adjacency.get(edge.partBId) ?? [];
    fromB.push(edge.partAId);
    adjacency.set(edge.partBId, fromB);
  }

  const controlParts = design.parts.filter(
    (part) => catalog.get(part.defId)?.category === 'pod',
  );
  if (controlParts.length === 0) {
    warnings.push({
      code: 'no-control-source',
      message: 'No control source: add a capsule or probe core.',
      partIds: [],
    });
  }

  const chuteIds = new Set(
    design.parts
      .filter((part) => catalog.get(part.defId)?.category === 'parachute' && part.id)
      .map((part) => part.id!),
  );
  const unprotectedCrew = design.parts.filter((part) => {
    const def = catalog.get(part.defId);
    if (!part.id || !def?.crewCapacity || def.crewCapacity <= 0) return false;
    const component = componentFrom(part.id, adjacency);
    return ![...chuteIds].some((chuteId) => component.has(chuteId));
  });
  if (unprotectedCrew.length > 0) {
    warnings.push({
      code: 'crewed-return-without-parachute',
      message:
        unprotectedCrew.length === 1
          ? 'Crew-capable return has no attached parachute.'
          : `${unprotectedCrew.length} crew-capable modules have no attached parachute.`,
      partIds: unprotectedCrew.map((part) => part.id!),
    });
  }

  const flankMountedLegIds = new Set<string>();
  for (const edge of design.edges) {
    if (edge.mountKind !== 'radial') continue;
    const categoryA = categoryOf(edge.partAId);
    const categoryB = categoryOf(edge.partBId);
    if (categoryA === 'legs' && categoryB && HULL_CATEGORIES.has(categoryB)) {
      flankMountedLegIds.add(edge.partAId);
    }
    if (categoryB === 'legs' && categoryA && HULL_CATEGORIES.has(categoryA)) {
      flankMountedLegIds.add(edge.partBId);
    }
  }
  const looseLegs = design.parts.filter(
    (part) =>
      part.id &&
      catalog.get(part.defId)?.category === 'legs' &&
      !flankMountedLegIds.has(part.id),
  );
  if (looseLegs.length > 0) {
    warnings.push({
      code: 'landing-leg-not-on-flank',
      message:
        looseLegs.length === 1
          ? 'Landing strut is not mounted to a hull flank.'
          : `${looseLegs.length} landing struts are not mounted to hull flanks.`,
      partIds: looseLegs.map((part) => part.id!),
    });
  }

  return warnings;
}
