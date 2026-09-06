# Next Phase Prompt — Phase 8 (Deployable Landing Legs) & Phase 9 (Root Parts + Transform / Rotate / Reroot)

> **Historical prompt (2026-07-12).** Phases 8 and 9 **shipped**. Rotate was
> later rebuilt in Phase 13. **Do not implement from this file.** Current
> brief: **`HANDOFF.md`**.

**To:** next coding agent (Grok / Cursor)
**Continues from:** `documents/Grok additions/VAB overhaul.md` (Sessions 1–2, Phase 7 fractional grid).
Read that file first. This prompt assumes it's current and correct except where flagged below.

Invariants from the previous handoff still apply and are repeated here since they're load-bearing:

1. SI units in physics; pixels only in camera/render layer.
2. Physics never imports rendering (`npm run sim` stays headless).
3. All VAB mutations go through `BuilderScene.designChanged()` (undo/redo safe).
4. Staging: one pure `fireStage` in `StageSystem.ts` — run sim after any edits touching it.
5. Saves: new serialized fields must be optional, for backward compatibility.

---

## Step 0 — Audit before building (do this first)

The Phase 7 handoff contradicts itself on landing legs:

- "Systems that work in-browser but lack sim coverage" lists legs as already having deploy/retract, crash tolerance, and break-on-hard-landing.
- "Suggested next steps" #3 says deployment animation/state is *not* implemented.

Don't trust either claim — check the actual code (wherever `legs-1` behavior lives) and confirm which is true before starting Phase 8. Correct `CURRENT_STATUS.md` and note the real state at the top of whatever handoff doc you write for this phase.

---

## Priority order

**Phase 8 first** — contained, ships a real gameplay feature, and closes the recovery-loop sim-coverage gap the last handoff already flagged as its own top suggested next step.
**Phase 9 second** — larger, touches shared core files (`RocketDesign`, `AttachmentNode`, `StageSystem`, all of `builder/`). Better to do it once, after Phase 8 is stable, so it doesn't need revisiting.

---

## Phase 8 — Deployable Landing Legs

### Goal
Legs have a real stowed / deployed / broken state, controllable in flight, that gates their function instead of always acting extended.

### State table

| State | Ground collision | Crash tolerance | Visual |
|---|---|---|---|
| `stowed` | none — hull/pod collides directly | hull-level (low) | flush profile, current rect art |
| `deployed` | leg extends contact footprint, spring-damper suspension | elevated, per-leg threshold | extended strut |
| `broken` | none | already failed | visually snapped/bent, stays attached but non-functional |

### Data model
- Add `legState: 'stowed' | 'deployed' | 'broken'` as an **optional** per-part runtime (flight-only) field. Defaults to `'stowed'` for old saves and fresh spawns.
- This is not a VAB placement concept — the VAB always renders legs stowed. `legState` only exists on the live flight vessel.

### Controls
Default assumption (override if you find something lighter-touch): one flight action, keybind `L`, toggles **all** `legs-1` parts on the active vessel together. Per-leg individual toggling via context click is a nice-to-have, not required for v1.

### Rendering
Two/three art states in `RocketRenderer.ts` per the table above. Instant toggle is fine for v1 — animated transition is a nice-to-have. The triangle/polygon approach used for the Phase 7 parachute is a reasonable reference for non-rect leg art.

### Physics
- Crash tolerance check should reuse whatever pattern already gates thermal destruction (Sutton-Graves per-part temperature, per the architecture map's `physics/`) — a per-part scalar threshold checked in the same place, not a parallel system.
- Only the individual leg that exceeds tolerance breaks; the rest of the vehicle is unaffected.
- Landing while stowed gets no tolerance bonus — hull-level tolerance applies, which should generally mean a bad landing.

### Sim coverage
Add to `npm run sim`: a scripted descent-and-touchdown check — legs deployed at a survivable velocity (pass), legs stowed at the same velocity (fails, proves the gate works), legs deployed at an excessive velocity (leg breaks, vehicle survives).

### Save compatibility
`legState` optional, defaults `'stowed'`. No save version bump needed if it's a genuinely optional field per the existing pattern.

---

## Phase 9 — Root Parts + Transform / Rotate / Reroot

> I'm going to send the exact tool spec myself. Everything below is architecture scaffolding so this isn't starting from zero — treat control scheme, pivot rules, rotation increments, and mid-build subassembly behavior as placeholders to override once the real spec arrives.

### Why this needs a rewrite
The current model infers connectivity from node-coincidence (`AttachmentNode.cellsNear`) rather than maintaining an explicit tree. Transform, rotate, and reroot all need unambiguous answers to "what's this part's parent," "what's the subtree that moves with it," and "which part is root" — that has to be first-class data, not inferred after the fact.

### New data model
- New explicit tree, likely on `RocketDesign`: `rootPartId`, and per-instance `parentId` (null only for root). Keep `cellsNear` adjacency around as a validation/debug check (does the tree match physical coincidence?) rather than as the source of truth going forward.
- Add `rotationDeg: number` (default `0`) to part instances.
- Add a helper — `AttachmentNode.rotateOffset(node, rotationDeg)` — that rotates a node's local offset before combining with part world position. Every consumer of node position (`SnapSystem`, `RocketRenderer`, `StageSystem`'s `cellsNear`) needs to route through this once rotation exists.
- Note for whoever implements this: rotating a filled rectangle about its own centroid doesn't change its own out-of-plane moment of inertia (`I_z = m(w² + h²)/12` regardless of orientation), so this should stay a position/attachment/render-layer change and not require touching `physics/` integration. Verify that assumption against how moment of inertia is actually computed before relying on it.

### Migration (old saves)
No existing save has `rootPartId` / `parentId` / `rotationDeg`. One-time load migration: `rotationDeg` defaults to 0 everywhere. For the tree, run the existing `cellsNear` adjacency once to build a spanning tree; root heuristic = command pod / probe core if present, else the part with no attachments among top nodes, else first-placed part. Persist the derived tree back into the save on next write. Comment this clearly as a one-time migration path, not something new saves should ever exercise.

### Reroot tool
Reparents the tree by reversing parent/child edges along the path from the current root to the newly chosen part. Staging order (`StageSystem`) is a separate, user-authored concern — reroot must **not** silently reorder stages. Flag explicitly in your handoff doc if the real spec says otherwise.

### Transform tool
Select a part; translate it and its entire subtree rigidly (children keep relative offset and rotation to parent). Should respect the Phase 7 snap step for the part being dragged.

### Rotate tool
Rotate a selected part + subtree around a pivot — recommended default: the part's own attachment point to its parent (children swing naturally), root part rotates about its own center. Mirror the Phase 7 `SnapControls.ts` UX pattern with a new `RotateControls.ts`: a floor-limited increment control (e.g. 5° minimum, never fully free), same "guided placement, not sloppy drag" reasoning Phase 7 used for position snapping.

### Suggested file map

| File | Status | Role |
|---|---|---|
| `src/vehicle/PartTree.ts` | NEW | root/parent/child tree model, reroot logic. Lives in `vehicle/`, not `builder/`, to preserve the downward-only import rule the same way `cellsNear` was kept in `AttachmentNode.ts`. |
| `src/builder/TransformTool.ts` | NEW | VAB translate-subtree tool |
| `src/builder/RotateControls.ts` | NEW | rotate increment UI, mirrors `SnapControls.ts` |
| `src/vehicle/RocketDesign.ts` | MODIFIED | root/parent tree fields, migration |
| `src/vehicle/AttachmentNode.ts` | MODIFIED | `rotateOffset()` helper |
| `src/vehicle/StageSystem.ts` | MODIFIED | route `cellsNear` through rotated node positions |
| `src/builder/GridSystem.ts` / `SnapSystem.ts` | MODIFIED | rotation-aware hit-testing and snapping |
| `src/render/RocketRenderer.ts` / `GridRenderer.ts` | MODIFIED | render rotated parts |
| save/serialization file (name TBD — locate it) | MODIFIED | optional `rootPartId`/`parentId`/`rotationDeg`, migration path |

### Reuse what Phase 7 already established
Route everything through `BuilderScene.designChanged()` per Invariant 3, same as Phase 7. Keep the downward-import rule intact the same way Phase 7 did.

---

## Deliverables (both phases)
- `npm run build` clean, `npm run sim` all checks pass, plus new recovery-loop tests from Phase 8.
- Update `CURRENT_STATUS.md` this time — not deferred.
- A new handoff doc, same format as `VAB overhaul.md`, documenting what changed file-by-file for Phase 8 and Phase 9.
- Call out loudly if either phase genuinely requires breaking one of the five invariants — don't do it silently.
