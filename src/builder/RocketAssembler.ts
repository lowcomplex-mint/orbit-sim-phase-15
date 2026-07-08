import type { PartDefinition } from '../vehicle/PartDefinition';
import { PartInstance } from '../vehicle/PartInstance';
import type { RocketDesign } from '../vehicle/RocketDesign';
import { partsAttached } from '../vehicle/StageSystem';

/**
 * Turns a design into flyable part instances, and validates that the design
 * is actually a rocket (connected, has a pod, an engine, and fuel).
 */

export interface AssemblyCheck {
  ok: boolean;
  problems: string[];
}

export function instantiateParts(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): PartInstance[] {
  const instances: PartInstance[] = [];
  for (const placed of design.parts) {
    const def = catalog.get(placed.defId);
    if (!def) throw new Error(`Unknown part id in design: ${placed.defId}`);
    instances.push(new PartInstance(def, placed.xCells, placed.yCells, placed.custom));
  }
  return instances;
}

export function validateDesign(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): AssemblyCheck {
  const problems: string[] = [];
  if (design.isEmpty) {
    return { ok: false, problems: ['The rocket has no parts.'] };
  }

  const parts = instantiateParts(design, catalog);

  if (!parts.some((p) => p.def.category === 'pod')) {
    problems.push('The rocket needs a command pod.');
  }
  if (!parts.some((p) => p.def.category === 'engine')) {
    problems.push('The rocket needs at least one engine.');
  }
  if (!parts.some((p) => p.def.fuelCapacity > 0)) {
    problems.push('The rocket needs at least one fuel tank.');
  }

  // Connectivity: parts are linked when compatible nodes coincide exactly
  // (top/bottom or left/right). BFS from the first part must reach all.
  if (parts.length > 1) {
    const visited = new Set<PartInstance>([parts[0]]);
    const queue: PartInstance[] = [parts[0]];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const other of parts) {
        if (visited.has(other)) continue;
        if (partsAttached(current, other)) {
          visited.add(other);
          queue.push(other);
        }
      }
    }
    if (visited.size < parts.length) {
      problems.push(
        `${parts.length - visited.size} part(s) are not attached to the rocket.`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}
