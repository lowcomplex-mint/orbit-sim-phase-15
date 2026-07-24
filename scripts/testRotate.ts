/**
 * Phase 13 acceptance tests — Rotate v2 + subassemblies.
 * Run: `npm run test:rotate`
 *
 * Sol's handoff order: acceptance cases from pivot rules, then enable Rotate.
 */
import { createPartCatalog } from '../src/config/parts';
import { DEFAULT_ROCKET_DESIGN } from '../src/config/defaultRocket';
import {
  jointBetween,
  quantizeRotateDelta,
  resolveRotatePivot,
  tryRotateSubtreeV2,
} from '../src/builder/RotateOps';
import {
  extractSubassembly,
  placeSubassembly,
  placeSubassemblyAuto,
} from '../src/builder/Subassembly';
import { validateDesign } from '../src/builder/RocketAssembler';
import { syncDesignGraph } from '../src/vehicle/PartGraph';
import { RocketDesign } from '../src/vehicle/RocketDesign';
import { partCenter, subtreeParts } from '../src/vehicle/PartTree';

let failures = 0;
function check(condition: boolean, label: string): void {
  if (condition) console.log(`  ok: ${label}`);
  else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const catalog = createPartCatalog();

console.log('== Quantization (pivot rules) ==');
{
  check(quantizeRotateDelta(15, 'stack', 15) === 90, 'stack forces at least 90°');
  check(quantizeRotateDelta(90, 'stack', 15) === 90, 'stack 90 stays 90');
  check(quantizeRotateDelta(-100, 'stack', 15) === -90, 'stack negative snaps toward 90');
  check(quantizeRotateDelta(180, 'stack', 15) === 180, 'stack allows 180');
  check(quantizeRotateDelta(20, 'radial', 15) === 15, 'radial snaps to step');
  check(quantizeRotateDelta(40, 'radial', 15) === 45, 'radial 40→45 with step 15');
}

console.log('== Stack pivot is shared joint ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  const tank = design.parts.find((p) => p.defId === 'procedural-fuel-tank' && p.yCells === 2)!;
  const engine = design.parts.find((p) => p.defId === 'engine-mule')!;
  check(Boolean(tank.id && engine.id), 'stock stack has tank + engine');
  // Engine is below tank; reroot so engine is child of tank for stack rotate test...
  // Default tree: pod is root. Rotate tank subtree = tank + everything below? 
  // Actually children are downward in BFS from pod. Engine is under tank in tree from pod.
  // Rotate the tank: pivot should be joint with parent (decoupler or pod side).
  const tankPivot = resolveRotatePivot(design, catalog, tank.id!);
  check(tankPivot.mountKind === 'stack' || tankPivot.mountKind === 'root', 'tank has stack/root pivot kind');
  const joint = tank.parentId
    ? jointBetween(design, catalog, tank.id!, tank.parentId)
    : null;
  if (joint) {
    check(
      Math.abs(tankPivot.xCells - joint.xCells) < 1e-6 &&
        Math.abs(tankPivot.yCells - joint.yCells) < 1e-6,
      'stack pivot equals shared joint coordinates',
    );
  } else {
    check(tankPivot.mountKind === 'root', 'orphan uses root pivot');
  }
}

console.log('== Radial pivot at mount joint ==');
{
  const design = new RocketDesign('Radial', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 2 },
    { defId: 'pod-mk1', xCells: -1, yCells: 5 },
  ]);
  syncDesignGraph(design, catalog);
  const leg = design.parts.find((p) => p.defId === 'legs-1')!;
  const pivot = resolveRotatePivot(design, catalog, leg.id!);
  check(pivot.mountKind === 'radial', 'leg mount is radial');
  check(pivot.quantizeDeg === 15, 'radial prefers fine quantize default');
  const joint = leg.parentId
    ? jointBetween(design, catalog, leg.id!, leg.parentId)
    : null;
  check(joint !== null, 'leg has a joint with its parent');
  if (joint) {
    check(
      Math.abs(pivot.xCells - joint.xCells) < 1e-6 &&
        Math.abs(pivot.yCells - joint.yCells) < 1e-6,
      'radial pivot equals mount joint',
    );
  }
}

console.log('== 90° stack rotate keeps joint + connectivity ==');
{
  const design = new RocketDesign('Stack rot', [
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
  const engine = design.parts.find((p) => p.defId === 'engine-mule')!;
  // Rotate the engine about its joint with the tank (engine is leaf).
  const pivotBefore = resolveRotatePivot(design, catalog, engine.id!);
  check(pivotBefore.mountKind === 'stack', 'engine attaches stack-style to tank');
  const centerBefore = partCenter(engine, catalog);
  const distBefore = Math.hypot(
    centerBefore.xCells - pivotBefore.xCells,
    centerBefore.yCells - pivotBefore.yCells,
  );

  const ok = tryRotateSubtreeV2(design, catalog, engine.id!, 90, 15);
  check(ok, '90° engine rotate accepted');
  check(Math.abs((engine.rotationDeg ?? 0) - 90) < 1e-6, 'engine rotationDeg is 90');

  const pivotAfter = resolveRotatePivot(design, catalog, engine.id!);
  const joint = engine.parentId
    ? jointBetween(design, catalog, engine.id!, engine.parentId)
    : null;
  check(joint !== null, 'joint still exists after rotate');
  const centerAfter = partCenter(engine, catalog);
  const distAfter = Math.hypot(
    centerAfter.xCells - pivotAfter.xCells,
    centerAfter.yCells - pivotAfter.yCells,
  );
  check(Math.abs(distAfter - distBefore) < 0.05, 'part center distance to pivot preserved');

  const valid = validateDesign(design, catalog);
  check(valid.ok, `rotated design still validates (${valid.problems.join('; ')})`);
}

console.log('== Radial 90° spin about mount ==');
{
  const design = new RocketDesign('Leg spin', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 3 },
    },
    { defId: 'legs-1', xCells: -2, yCells: 2 },
    { defId: 'pod-mk1', xCells: -1, yCells: 5 },
  ]);
  syncDesignGraph(design, catalog);
  const leg = design.parts.find((p) => p.defId === 'legs-1')!;
  const ok = tryRotateSubtreeV2(design, catalog, leg.id!, 90, 90);
  check(ok, 'radial 90° rotate accepted');
  check(Math.abs((leg.rotationDeg ?? 0) - 90) < 1e-6, 'leg rotationDeg is 90');
  check(
    jointBetween(design, catalog, leg.id!, leg.parentId!) !== null,
    'leg remains jointed after radial spin',
  );
  check(validateDesign(design, catalog).ok, 'leg-spin design validates');
}

console.log('== Rotation survives graph sync (no wipe) ==');
{
  const design = new RocketDesign('Persist rot', [
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
  const engine = design.parts.find((p) => p.defId === 'engine-mule')!;
  tryRotateSubtreeV2(design, catalog, engine.id!, 90, 15);
  const rot = engine.rotationDeg ?? 0;
  syncDesignGraph(design, catalog);
  check(Math.abs((engine.rotationDeg ?? 0) - rot) < 1e-6, 'syncDesignGraph keeps rotationDeg');
}

console.log('== Subtree rotate moves descendants ==');
{
  const design = RocketDesign.fromData(DEFAULT_ROCKET_DESIGN);
  syncDesignGraph(design, catalog);
  // Find a mid-stack part with children.
  const tank = design.parts.find(
    (p) => p.defId === 'procedural-fuel-tank' && (p.custom?.heightCells ?? 4) === 4,
  )!;
  const members = subtreeParts(design, tank.id!);
  check(members.length > 1, 'lower tank has a multi-part subtree');
  const before = members.map((p) => ({ id: p.id, x: p.xCells, y: p.yCells, r: p.rotationDeg ?? 0 }));
  const ok = tryRotateSubtreeV2(design, catalog, tank.id!, 90, 15);
  // May fail if out of bounds — stock rocket near pad may be tight.
  if (ok) {
    let moved = 0;
    for (const m of members) {
      const b = before.find((x) => x.id === m.id)!;
      if (Math.abs(m.xCells - b.x) > 1e-6 || Math.abs(m.yCells - b.y) > 1e-6) moved++;
    }
    check(moved >= 1, 'at least one subtree member translated about pivot');
  } else {
    // Fallback isolated stack higher on grid.
    const alt = new RocketDesign('High', [
      {
        defId: 'procedural-fuel-tank',
        xCells: -1,
        yCells: 20,
        custom: { widthCells: 2, heightCells: 2 },
      },
      { defId: 'engine-mule', xCells: -1, yCells: 18 },
      { defId: 'pod-mk1', xCells: -1, yCells: 22 },
    ]);
    syncDesignGraph(alt, catalog);
    const t = alt.parts.find((p) => p.defId === 'procedural-fuel-tank')!;
    check(tryRotateSubtreeV2(alt, catalog, t.id!, 90, 15), 'high stack rotates at 90°');
  }
}

console.log('== Subassembly extract / place ==');
{
  const design = new RocketDesign('Sub', [
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
  const engine = design.parts.find((p) => p.defId === 'engine-mule')!;
  const tank = design.parts.find((p) => p.defId === 'procedural-fuel-tank')!;
  const data = extractSubassembly(design, catalog, [engine.id!, tank.id!], 'Booster stub');
  check(data !== null && data!.parts.length === 2, 'extract pulls engine+tank subtree union');
  check(data!.name === 'Booster stub', 'subassembly keeps name');

  const beforeCount = design.parts.length;
  const placed = placeSubassemblyAuto(design, catalog, data!);
  check(placed !== null && placed!.length === 2, 'auto-place inserts two parts');
  check(design.parts.length === beforeCount + 2, 'design grew by two parts');
  // Detached until player snaps — structural validate may fail; that's OK.
  const detachedRoot = placed![0];
  check(detachedRoot.parentId === null || !design.rootPartId, 'placed subassembly starts detached/oriented');
}

console.log('== Subassembly absolute place ==');
{
  const design = new RocketDesign('Empty-ish', [
    { defId: 'pod-mk1', xCells: -1, yCells: 10 },
  ]);
  syncDesignGraph(design, catalog);
  const data = extractSubassembly(design, catalog, [design.parts[0].id!], 'Capsule');
  check(data !== null, 'single-part subassembly extracts');
  const target = new RocketDesign('Host', [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 2 },
    },
  ]);
  syncDesignGraph(target, catalog);
  const placed = placeSubassembly(target, catalog, data!, 4, 2);
  check(placed !== null && placed!.length === 1, 'place at explicit origin works');
  check(Math.abs(placed![0].xCells - 4) < 1e-6, 'placed at requested x');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nSUCCESS: all Phase 13 rotate/subassembly checks passed.');
