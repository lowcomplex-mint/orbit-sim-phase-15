import type { PartDefinition } from '../vehicle/PartDefinition';
import { validateStructure } from '../vehicle/PartGraph';
import { PartInstance } from '../vehicle/PartInstance';
import type { RocketDesign } from '../vehicle/RocketDesign';

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
    instances.push(
      new PartInstance(def, placed.xCells, placed.yCells, placed.custom, placed.rotationDeg ?? 0),
    );
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

  const structure = validateStructure(design, catalog);
  for (const msg of structure.problems) {
    if (!problems.includes(msg)) problems.push(msg);
  }

  return { ok: problems.length === 0, problems };
}
