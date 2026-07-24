/**
 * VAB mirror-symmetry (SYM) regression.
 * Run: `npx tsx scripts/testSymmetry.ts` (or via npm run test:builder suite later).
 */
import { createPartCatalog } from '../src/config/parts';
import { RocketDesign } from '../src/vehicle/RocketDesign';
import { syncDesignGraph } from '../src/vehicle/PartGraph';
import { resolvePartProps } from '../src/vehicle/ProceduralPart';
import { validateDesign } from '../src/builder/RocketAssembler';
import { computeSymmetryTwin, findMirroredPart, mirrorOriginX } from '../src/builder/Symmetry';
import { findSnap } from '../src/builder/SnapSystem';
import { Vec2 } from '../src/math/Vec2';
import { GRID_CELL_METERS } from '../src/config/constants';

let failures = 0;
function check(condition: boolean, label: string): void {
  if (condition) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const catalog = createPartCatalog();

console.log('== Origin mirror math ==');
{
  check(mirrorOriginX(-2, 1) === 1, 'leg-width origin -2 → 1');
  check(mirrorOriginX(-1, 2) === -1, 'center 2-wide tank stays on axis');
  check(mirrorOriginX(1, 1) === -2, 'inverse of leg mirror');
}

console.log('== Radial leg twin attaches ==');
{
  const design = new RocketDesign('Core', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'pod-mk1', xCells: -1, yCells: 5 },
  ]);
  syncDesignGraph(design, catalog);

  const legDef = catalog.get('legs-1')!;
  const props = resolvePartProps(legDef);
  // Snap a left leg onto the tank flank.
  const pointer = new Vec2((-2 + 0.5) * GRID_CELL_METERS, (2 + 1.5) * GRID_CELL_METERS);
  const snap = findSnap(design, catalog, { def: legDef, props }, pointer, 0.5);
  check(snap.valid && snap.attached, 'left leg snaps to tank');

  design.addPart('legs-1', snap.xCells, snap.yCells, undefined, snap.parentId ?? null);
  const twin = computeSymmetryTwin(
    design,
    catalog,
    props,
    snap.xCells,
    snap.yCells,
    snap.parentId,
    snap.parentNodeIndex,
    snap.childNodeIndex,
  );
  check(twin.valid && !twin.isIdentity, 'symmetry twin is valid and off-axis');
  check(twin.xCells > 0, 'twin sits on the +X side');

  design.addPart('legs-1', twin.xCells, twin.yCells, undefined, twin.parentId);
  syncDesignGraph(design, catalog);
  const valid = validateDesign(design, catalog);
  check(valid.ok, `mirrored legs design validates (${valid.problems.join('; ')})`);

  const left = design.parts.find((p) => p.defId === 'legs-1' && p.xCells < 0)!;
  const right = findMirroredPart(design, catalog, left);
  check(right !== null, 'findMirroredPart locates the twin');
  check(design.edges.filter((e) => e.mountKind === 'radial').length >= 2, 'two radial edges after SYM');
}

console.log('== Centerline placement is identity ==');
{
  const design = new RocketDesign('Center', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
  ]);
  syncDesignGraph(design, catalog);
  const props = resolvePartProps(catalog.get('procedural-fuel-tank')!, {
    widthCells: 2,
    heightCells: 2,
  });
  const twin = computeSymmetryTwin(
    design,
    catalog,
    props,
    -1,
    2,
    design.parts[0].id,
    undefined,
    undefined,
  );
  // 2-wide at -1 mirrors to itself.
  check(twin.isIdentity || twin.xCells === -1, '2-wide center stack is identity under SYM');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nSUCCESS: all symmetry checks passed.');
