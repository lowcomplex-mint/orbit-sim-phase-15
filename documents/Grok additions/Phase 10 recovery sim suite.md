# Phase 10 — Recovery sim suite

> **Historical. Shipped.** Do not re-run this as a work order. Current brief:
> **[`HANDOFF.md`](../../HANDOFF.md)**.

**Status:** complete (2026-07-12)  
**Regression:** `npm run sim` — blocks `== Parachutes ==`, `== Launch clamps ==`, `== Electricity ==`, `== Full recovery mission ==`

## What shipped

Headless regression coverage for the recovery loop systems that were live in flight but had no automated tests. All blocks live in `scripts/simAscent.ts` (imports: `CHUTE_PRESETS`, `airDensityAt`, `PhysicsEnvironment`, helpers `physicsEnv`, `chuteTestRuntime`).

### Parachutes

- Combo preset: drogue deploys below 4× main altitude (4.5 km test point).
- Main opens below deploy altitude with substantial drag increase.
- Nylon small-main: opens inside safe envelope, then fails when velocity spiked past material limits (failure requires an open canopy — deploy first, abuse second).

### Launch clamps

- Design validates with clamp radial-attached to tank (`launch-clamp` at `xCells: -2, yCells: 0` — right node meets tank left at `(-1, 3)`).
- `igniteStage: 2`: vessel pinned through stage 1 burn; stage 2 releases clamp as debris vessel; active stack lifts off.

### Electricity

- Sunlit ascent keeps battery charged on a probe + battery + solar stack.
- Isolated probe: drains to zero in eclipse, reaction wheels offline, no spin at zero charge.
- Recharged probe regains wheel authority and spins under rotation input.
- Eclipse drain (no sun) draws charge down; solar recharges afterward.

### Full recovery mission (capstone)

- Stack: engine, tank, symmetric legs, capsule, combo chute, clamp (`igniteStage: 2`).
- Scripted path: pad hold → stage 1 (clamps stay) → stage 2 (clamp release) → ascent → teleport to 3.5 km entry → armed chutes + deployed legs → sim until touchdown.
- Asserts: lands without crash, chutes deployed, legs were deployed (may break on touchdown — acceptable).

## Placement notes (clamp)

Clamp attachment nodes are at `yCells: 3` on the part (mid-height of 4-cell clamp). For a 2×2 procedural tank at `(-1, 2)`, the left flank node is at world `(-1, 3)`. Place the clamp at `yCells: 0` so its right node coincides. `yCells: -2` does **not** attach (validation fails).

## Next phase

Per `phase planning/phase-10-11-plan.md`: **Phase 11** node/attachment overhaul — do not start until this sim suite stays green through any staging/graph edits.