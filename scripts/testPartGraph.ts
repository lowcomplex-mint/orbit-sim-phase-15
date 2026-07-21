/**
 * Headless regression tests for the attachment graph (Phase 11).
 * Run: `npm run test:graph`
 */
import { validateDesign } from '../src/builder/RocketAssembler';
import { DEFAULT_ROCKET_DESIGN } from '../src/config/defaultRocket';
import { createPartCatalog } from '../src/config/parts';
import { tryTranslateSubtree } from '../src/builder/TransformTool';
import {
  buildEdgesFromGeometry,
  deriveTreeFromEdges,
  findMirroredPart,
  mirroredParentId,
  mirroredXCells,
  mountKindForNodes,
  syncDesignGraph,
  validateStructure,
} from '../src/vehicle/PartGraph';
import { rerootDesign } from '../src/vehicle/PartTree';
import { RocketDesign } from '../src/vehicle/RocketDesign';

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

console.log('== Stock rocket graph ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  check(design.edges.length >= 5, `stock rocket has stack edges (${design.edges.length})`);
  check(
    design.edges.every((e) => e.mountKind === 'stack'),
    'center-column stack is all stack mounts',
  );
  check(design.rootPartId !== null, 'root part assigned (pod heuristic)');
  const valid = validateDesign(design, catalog);
  check(valid.ok, `stock rocket validates (${valid.problems.join('; ')})`);
}

console.log('== Mount kind classification ==');
{
  check(mountKindForNodes('top', 'bottom') === 'stack', 'top/bottom is stack');
  check(mountKindForNodes('left', 'right') === 'radial', 'left/right is radial');
}

console.log('== Radial leg attachment ==');
{
  const design = new RocketDesign('Legs', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 2 },
    { defId: 'legs-1', xCells: 1, yCells: 2 },
    { defId: 'pod-mk1', xCells: -1, yCells: 4 },
  ]);
  syncDesignGraph(design, catalog);
  const radial = design.edges.filter((e) => e.mountKind === 'radial');
  check(radial.length === 2, `two radial leg edges (${radial.length})`);
  const valid = validateDesign(design, catalog);
  check(valid.ok, `leg stack validates (${valid.problems.join('; ')})`);
}

console.log('== Disconnected part detection ==');
{
  const design = new RocketDesign('Broken', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    { defId: 'pod-mk1', xCells: 5, yCells: 10 },
  ]);
  syncDesignGraph(design, catalog);
  const structure = validateStructure(design, catalog);
  check(!structure.ok, 'floating pod fails structural check');
  check(
    structure.problems.some((p) => p.includes('not attached')),
    'reports disconnected part',
  );
}

console.log('== Reroot preserves edges ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  const edgesBefore = design.edges.length;
  const engine = design.parts.find((p) => p.defId === 'engine-mule');
  check(engine?.id != null, 'engine has id');
  if (engine?.id) {
    rerootDesign(design, engine.id);
    check(design.rootPartId === engine.id, 'root is now engine');
    check(design.edges.length === edgesBefore, 'edge count unchanged after reroot');
    const tank = design.parts.find((p) => p.defId === 'procedural-fuel-tank');
    check(tank?.parentId === engine.id, 'tank parent is engine after reroot');
  }
}

console.log('== Move subtree preserves connectivity ==');
{
  const design = new RocketDesign('Movable', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'pod-mk1', xCells: -1, yCells: 4 },
  ]);
  syncDesignGraph(design, catalog);
  const pod = design.parts.find((p) => p.defId === 'pod-mk1')!;
  const edgesBefore = design.edges.length;
  check(
    tryTranslateSubtree(design, catalog, pod.id!, 0, 1),
    'root subtree moves up 1 cell',
  );
  syncDesignGraph(design, catalog);
  check(design.edges.length === edgesBefore, 'edges preserved after move');
  check(validateDesign(design, catalog).ok, 'moved stack still validates');
}

console.log('== Mirror symmetry parent resolution ==');
{
  const design = new RocketDesign('Sym', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 2 },
    { defId: 'legs-1', xCells: 1, yCells: 2 },
  ]);
  syncDesignGraph(design, catalog);
  const leftLeg = design.parts.find((p) => p.xCells === -2)!;
  const tank = design.parts.find((p) => p.defId === 'procedural-fuel-tank')!;
  leftLeg.parentId = tank.id!;
  const rightLeg = findMirroredPart(design, catalog, leftLeg);
  check(rightLeg !== null, 'right leg mirror twin exists');
  check(
    mirroredParentId(design, catalog, tank.id) === tank.id,
    'center tank mirrors to itself',
  );
  check(mirroredXCells(-2, 1) === 1, 'mirroredX maps -2 to 1 for width 1');
}

console.log('== Tree derivation from edges ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  const edges = buildEdgesFromGeometry(design, catalog);
  design.rootPartId = design.parts.find((p) => p.defId === 'pod-mk1')?.id ?? null;
  deriveTreeFromEdges(design, edges);
  const pod = design.parts.find((p) => p.defId === 'pod-mk1')!;
  check(pod.parentId === null, 'pod is tree root');
  const visited = new Set<string>();
  const queue = [design.rootPartId!];
  while (queue.length) {
    const id = queue.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of edges) {
      if (e.partAId === id && !visited.has(e.partBId)) queue.push(e.partBId);
      if (e.partBId === id && !visited.has(e.partAId)) queue.push(e.partAId);
    }
  }
  check(visited.size === design.parts.length, 'BFS reaches every part');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nSUCCESS: all part-graph checks passed.');