/**
 * Headless Phase 12 regression suite: selection geometry, graph-safe group
 * operations, and advisory VAB gameplay warnings.
 * Run: npm run test:builder
 */
import { analyzeDesignWarnings } from '../src/builder/DesignWarnings';
import {
  deleteGroup,
  duplicateGroup,
  expandGroupIds,
  moveGroup,
} from '../src/builder/GroupOps';
import {
  normalizeSelectionBox,
  partsInSelectionBox,
} from '../src/builder/SelectionBox';
import { validateDesign } from '../src/builder/RocketAssembler';
import { DEFAULT_ROCKET_DESIGN } from '../src/config/defaultRocket';
import { GRID_CELL_METERS } from '../src/config/constants';
import { createPartCatalog } from '../src/config/parts';
import { Vec2 } from '../src/math/Vec2';
import { syncDesignGraph } from '../src/vehicle/PartGraph';
import { RocketDesign } from '../src/vehicle/RocketDesign';
import { rerootDesign } from '../src/vehicle/PartTree';

let failures = 0;
function check(condition: boolean, label: string): void {
  if (condition) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

function near(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

const catalog = createPartCatalog();
const warningCodes = (design: RocketDesign) => {
  // Warning analysis deliberately stays read-only; callers own graph sync.
  syncDesignGraph(design, catalog);
  return analyzeDesignWarnings(design, catalog).map((warning) => warning.code);
};

console.log('== Selection box ==');
{
  const design = new RocketDesign('Fractional selection', [
    { defId: 'battery-1', xCells: 1.25, yCells: 2 },
    { defId: 'probe-1', xCells: 6, yCells: 6 },
  ]);
  syncDesignGraph(design, catalog);
  const start = new Vec2(2 * GRID_CELL_METERS, 4.5 * GRID_CELL_METERS);
  const end = new Vec2(1.1 * GRID_CELL_METERS, 1.5 * GRID_CELL_METERS);
  const box = normalizeSelectionBox(start, end);
  check(
    near(box.minXCells, 1.1) && near(box.minYCells, 1.5) && near(box.widthCells, 0.9),
    'reverse drag normalizes to ascending fractional cell bounds',
  );
  const selected = partsInSelectionBox(design, catalog, start, end);
  check(selected.length === 1, 'marquee intersects the fractional-width battery only');
  check(
    design.parts.find((part) => part.id === selected[0])?.defId === 'battery-1',
    'selection returns stable part ids',
  );
}

console.log('== Fractional group move ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  const rootId = design.rootPartId!;
  const edgesBefore = design.edges.length;
  const before = new Map(
    design.parts.map((part) => [part.id!, { x: part.xCells, y: part.yCells }]),
  );
  check(
    expandGroupIds(design, [rootId]).length === design.parts.length,
    'selecting the root expands to the full subtree exactly once',
  );
  check(moveGroup(design, catalog, [rootId], 0.5, 0.25), 'fractional group move succeeds');
  check(
    design.parts.every((part) => {
      const previous = before.get(part.id!)!;
      return part.xCells === previous.x + 0.5 && part.yCells === previous.y + 0.25;
    }),
    'every subtree member moves once and preserves relative geometry',
  );
  check(design.edges.length === edgesBefore, 'fractional move preserves internal graph edges');
  check(validateDesign(design, catalog).ok, 'moved full craft remains launch-valid');
}

console.log('== Duplicate + atomic rejection ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  const originalRoot = design.rootPartId!;
  const sourceTopology = design.parts.map((part) => ({
    id: part.id!,
    parentId: part.parentId ?? null,
    defId: part.defId,
    xCells: part.xCells,
    yCells: part.yCells,
  }));
  const originalIds = new Set(design.parts.map((part) => part.id!));
  const originalEdges = design.edges.length;
  const copies = duplicateGroup(design, catalog, [originalRoot]);
  check(copies?.length === originalIds.size, 'duplicate clones the expanded selection');
  const copyIds = new Set(copies?.map((part) => part.id!) ?? []);
  check(
    [...copyIds].every((id) => !originalIds.has(id)),
    'duplicates receive fresh stable ids',
  );
  check(design.rootPartId === originalRoot, 'duplicate never replaces the original root');
  check(
    design.edges.filter(
      (edge) => copyIds.has(edge.partAId) && copyIds.has(edge.partBId),
    ).length === originalEdges,
    'detached duplicate preserves internal attachment edges',
  );
  check(
    copies?.filter((part) => part.parentId === null).length === 1 &&
      copies.filter((part) => part.parentId !== null).length === copies.length - 1,
    'detached duplicate retains a derived component tree',
  );
  const sourceRoot = sourceTopology.find((part) => part.id === originalRoot)!;
  const copyRoot = copies?.find((part) => part.parentId === null);
  const copyDx = copyRoot ? copyRoot.xCells - sourceRoot.xCells : NaN;
  const copyDy = copyRoot ? copyRoot.yCells - sourceRoot.yCells : NaN;
  const copyBySourceId = new Map(
    sourceTopology.map((source) => [
      source.id,
      copies?.find(
        (copy) =>
          copy.defId === source.defId &&
          copy.xCells === source.xCells + copyDx &&
          copy.yCells === source.yCells + copyDy,
      ),
    ]),
  );
  check(
    copyRoot?.defId === sourceRoot.defId &&
      sourceTopology.every((source) => {
        const copy = copyBySourceId.get(source.id);
        const expectedParentId = source.parentId
          ? copyBySourceId.get(source.parentId)?.id
          : null;
        return Boolean(copy) && (copy!.parentId ?? null) === (expectedParentId ?? null);
      }),
    'duplicate preserves the source root and exact parent topology',
  );

  const sourceEngine = design.parts.find(
    (part) => originalIds.has(part.id!) && part.defId === 'engine-mule',
  )!;
  const copyEngine = copies!.find((part) => part.defId === 'engine-mule')!;
  const dxOntoOriginal = sourceEngine.xCells - copyEngine.xCells;
  const serializedBefore = JSON.stringify(design.toData());
  check(
    !moveGroup(design, catalog, [...copyIds], dxOntoOriginal, 0),
    'group move onto occupied originals is rejected',
  );
  check(
    JSON.stringify(design.toData()) === serializedBefore,
    'rejected move is byte-for-byte atomic',
  );
}

console.log('== Multi-root subtree operations ==');
{
  const design = new RocketDesign('Branching lander', [
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 0,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 0 },
    { defId: 'legs-1', xCells: 1, yCells: 0 },
    { defId: 'pod-mk1', xCells: -1, yCells: 3 },
  ]);
  syncDesignGraph(design, catalog);
  const tank = design.parts.find((part) => part.defId === 'procedural-fuel-tank')!;
  const [leftLeg, rightLeg] = design.parts.filter((part) => part.defId === 'legs-1');
  const pod = design.parts.find((part) => part.defId === 'pod-mk1')!;

  const nestedSelection = expandGroupIds(design, [tank.id!, leftLeg.id!]);
  check(
    nestedSelection.length === 3 && new Set(nestedSelection).size === 3,
    'ancestor + descendant selection deduplicates and includes unselected siblings in the subtree',
  );
  check(
    expandGroupIds(design, [leftLeg.id!, rightLeg.id!]).length === 2,
    'two sibling leaves remain two independent group roots',
  );

  const coreBefore = [tank, pod].map((part) => [part.xCells, part.yCells]);
  check(
    moveGroup(design, catalog, [leftLeg.id!, rightLeg.id!], 0, 4),
    'multi-root sibling move succeeds atomically',
  );
  check(
    leftLeg.yCells === 4 && rightLeg.yCells === 4 &&
      tank.xCells === coreBefore[0][0] && tank.yCells === coreBefore[0][1] &&
      pod.xCells === coreBefore[1][0] && pod.yCells === coreBefore[1][1],
    'multi-root move changes each selected branch once and leaves the core fixed',
  );

  check(
    deleteGroup(design, catalog, [leftLeg.id!]) === 1,
    'partial group delete removes only the selected detached branch',
  );
  check(
    design.parts.includes(rightLeg) && design.parts.includes(tank) && design.parts.includes(pod),
    'partial group delete preserves the unselected sibling and connected core',
  );
  check(
    design.edges.every(
      (edge) =>
        design.parts.some((part) => part.id === edge.partAId) &&
        design.parts.some((part) => part.id === edge.partBId),
    ),
    'partial group delete leaves no dangling graph references',
  );
}

console.log('== Deep clone customization ==');
{
  const design = new RocketDesign('Chute clone', [
    { defId: 'pod-mk1', xCells: -1, yCells: 0 },
    {
      defId: 'parachute-1',
      xCells: -0.5,
      yCells: 2,
      custom: {
        chute: { type: 'main', diameterM: 10, deployAltM: 1200, material: 'nylon' },
      },
    },
  ]);
  syncDesignGraph(design, catalog);
  const sourceChute = design.parts.find((part) => part.defId === 'parachute-1')!;
  const copies = duplicateGroup(design, catalog, [design.rootPartId!])!;
  const copyChute = copies.find((part) => part.defId === 'parachute-1')!;
  copyChute.custom!.chute!.diameterM = 14;
  check(
    sourceChute.custom!.chute!.diameterM === 10,
    'nested parachute customization is deep-cloned',
  );
}

console.log('== Graph-safe subtree delete ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  const originalRoot = design.rootPartId!;
  const copies = duplicateGroup(design, catalog, [originalRoot])!;
  const removed = deleteGroup(design, catalog, [originalRoot]);
  check(removed === DEFAULT_ROCKET_DESIGN.parts.length, 'delete removes the selected root subtree');
  check(design.parts.length === copies.length, 'detached duplicate survives original subtree deletion');
  check(
    design.rootPartId !== null && design.parts.some((part) => part.id === design.rootPartId),
    'deleting the root chooses an existing deterministic replacement',
  );
  check(
    design.edges.every(
      (edge) =>
        design.parts.some((part) => part.id === edge.partAId) &&
        design.parts.some((part) => part.id === edge.partBId),
    ),
    'delete leaves no dangling edge references',
  );
  check(validateDesign(design, catalog).ok, 'surviving duplicated craft becomes launch-valid');
  deleteGroup(design, catalog, [design.rootPartId!]);
  check(
    design.parts.length === 0 && design.edges.length === 0 && design.rootPartId === null,
    'deleting the final root leaves a canonical empty design',
  );
}

console.log('== Custom root survives duplicate handoff ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  const sourceEngine = design.parts.find((part) => part.defId === 'engine-mule')!;
  check(rerootDesign(design, sourceEngine.id!), 'stock craft reroots to its main engine');
  const copies = duplicateGroup(design, catalog, [sourceEngine.id!])!;
  const copyRoot = copies.find((part) => part.parentId === null)!;
  const copyParentsBefore = new Map(
    copies.map((part) => [part.id!, part.parentId ?? null]),
  );
  check(copyRoot.defId === 'engine-mule', 'duplicate preserves the custom engine root');

  deleteGroup(design, catalog, [sourceEngine.id!]);
  check(
    design.rootPartId === copyRoot.id,
    'deleting the original promotes the surviving duplicate custom root',
  );
  check(
    copies.every((part) => (part.parentId ?? null) === copyParentsBefore.get(part.id!)),
    'custom-root duplicate keeps its parent topology after root handoff',
  );
  check(validateDesign(design, catalog).ok, 'surviving custom-root duplicate stays launch-valid');
}

console.log('== Gameplay warnings ==');
{
  const stock = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  check(
    warningCodes(stock).includes('crewed-return-without-parachute'),
    'stock crew-capable craft warns when no chute is attached',
  );
  const stockBeforeWarningAnalysis = JSON.stringify(stock.toData());
  analyzeDesignWarnings(stock, catalog);
  check(
    JSON.stringify(stock.toData()) === stockBeforeWarningAnalysis,
    'advisory warning analysis does not mutate the graph-synced design',
  );

  const crewWithChute = new RocketDesign('Crew recovery', [
    { defId: 'pod-mk1', xCells: -1, yCells: 0 },
    { defId: 'parachute-1', xCells: -0.5, yCells: 2 },
  ]);
  check(
    !warningCodes(crewWithChute).includes('crewed-return-without-parachute'),
    'attached chute clears the crew-capable return warning',
  );

  const stagedAwayChute = new RocketDesign('Bad recovery staging', [
    { defId: 'pod-mk1', xCells: -1, yCells: 0 },
    { defId: 'procedural-decoupler', xCells: -1, yCells: 2 },
    { defId: 'parachute-1', xCells: -0.5, yCells: 3 },
  ]);
  check(
    warningCodes(stagedAwayChute).includes('crewed-return-without-parachute'),
    'chute across a release part does not satisfy the retained return component',
  );

  const probe = new RocketDesign('Probe', [
    { defId: 'probe-1', xCells: -1, yCells: 0 },
  ]);
  const probeWarnings = warningCodes(probe);
  check(!probeWarnings.includes('no-control-source'), 'probe core counts as a control source');
  check(
    !probeWarnings.includes('crewed-return-without-parachute'),
    'uncrewed probe does not receive a return-chute warning',
  );

  const noControl = new RocketDesign('No control', [
    { defId: 'procedural-fuel-tank', xCells: -1, yCells: 0 },
  ]);
  check(warningCodes(noControl).includes('no-control-source'), 'missing control source warns live');

  const flankLeg = new RocketDesign('Mounted leg', [
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 0,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 0 },
  ]);
  check(
    !warningCodes(flankLeg).includes('landing-leg-not-on-flank'),
    'radially attached strut passes the flank-mount check',
  );

  const clampMountedLeg = new RocketDesign('Clamp is not a hull', [
    { defId: 'launch-clamp', xCells: 0, yCells: 0 },
    { defId: 'legs-1', xCells: 1, yCells: 2 },
  ]);
  check(
    warningCodes(clampMountedLeg).includes('landing-leg-not-on-flank'),
    'strut attached to a clamp still warns because the clamp is not a hull flank',
  );

  flankLeg.parts[1].xCells = 5;
  const looseCodes = warningCodes(flankLeg);
  check(looseCodes.includes('landing-leg-not-on-flank'), 'detached strut warns about its mount');
  check(new Set(looseCodes).size === looseCodes.length, 'warning codes are deterministic and unique');
}

if (failures > 0) {
  console.error(`\n${failures} Phase 12 check(s) FAILED.`);
  process.exit(1);
}
console.log('\nSUCCESS: all Phase 12 builder checks passed.');
