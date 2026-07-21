# Current Status

Snapshot for handoff. Validated on 2026-07-21: `npm run build`, `npm run sim`,
`npm run test:graph`, and `npm run test:builder` all pass. Phase 12 VAB flows
were also exercised in a real browser at desktop and 390×844 mobile sizes with
no page errors.

Phases landed: MVP → persistent world → radial attachment → sandbox systems →
recovery loop → **Phase 7 fractional VAB grid** → **Phase 8 deployable legs** →
**Phase 9 tree/Move/Root scaffolding** → **Phase 10 recovery sim suite** →
**Phase 11 node/attachment graph** → **Phase 12 VAB warnings + group ops**.

---

## ✅ Works and is regression-tested

### `npm run sim`

- **Flight core**: fixed-timestep gravity/integration, ascent, staging, saves,
  reentry heating, attitude/SAS, career foundations, and vehicle analysis.
- **Time warp**: physics warp plus body-relative analytic rails for bound
  elliptic vacuum arcs, including suborbital coasts; atmosphere/SOI auto-drop.
- **Landing/recovery**: deployable landing struts, surface-rest anti-skate,
  parachutes, launch clamps, electricity, and the full recovery mission.

### `npm run test:graph`

- **Attachment graph (Phase 11)**: explicit stack/radial edges, derived trees,
  structural validation, reroot, subtree move, mirror parent sync, and
  disconnected-component detection.
- Detached components retain their own deterministic derived tree while still
  being reported as disconnected from the designated rocket root.

### `npm run test:builder`

- **Selection geometry**: marquee normalization in every drag direction and
  fractional-width part intersection.
- **Group operations**: subtree-union expansion, fractional rigid move,
  ancestor deduplication, multi-root/partial-subtree behavior, collision
  rollback, duplicate with fresh ids/deep customization/exact parent topology,
  and graph/root-safe deletion.
- **Live VAB advisories**: missing control source, crew-capable return without
  a chute retained across release parts, and landing struts off a hull flank.

## ✅ Works and is browser-verified

- **VAB Select tool**: box select for mouse/touch; `Shift` temporarily selects
  from any tool; click toggles membership.
- **Group operations**: switch to Move and drag any selected part; selected
  subtree roots move rigidly. Floating DUP/DEL toolbar plus `Ctrl+D`/`Delete`.
  Each committed operation is one undo/redo step; failed/cancelled moves do not
  mutate the graph or history. Escape, undo/redo, design replacement, and
  pointer cancellation safely retire in-flight selection gestures.
- **Builder checks** appear live in the Engineer panel and remain advisory;
  `validateDesign()` still owns launch-blocking structure/minimum-part rules.
- Persistent selection/root overlays no longer conflict with stage hover.
- Mobile top controls scroll horizontally; Engineer/Staging collapse correctly.
- Existing Place, Move-subtree, Root, Snap, SYM, staging preview, CoM marker,
  context menus, Space Center, Tracking Station, pause, map, and flight HUD.

## 🟡 Partial / stubbed

- `systems/Resources.ts` — only electricity simulated.
- `systems/ManeuverNodes.ts` — data model only.
- Map: single-body conic; no patched-conic SOI continuation.
- Leg deploy animation / per-leg toggle / suspension / tip-over.
- **Rotate v2** — pivot spec exists; the VAB control remains disabled.
- A freshly duplicated group is intentionally detached and launch-invalid
  until the player moves it onto a valid attachment node.

## ❌ Not started

- **Phase 13**: Rotate v2 + reusable subassemblies.
- Tracking Station rename/filter/search; procedural adapters; RCS/docking;
  tutorial/onboarding; audio; input rebinding.
- Hyperbolic escape rails and patched-conic map previews.

## ⚠️ Do not touch without the matching gates

- `vehicle/PartGraph.ts`, `vehicle/PartTree.ts`, builder group transforms:
  run `npm run test:graph` and `npm run test:builder`.
- `vehicle/StageSystem.ts`, `RocketRuntime.stage()`, recovery/rails physics:
  run `npm run sim`.
- Save serialization: all new persisted fields must remain optional and
  backward compatible.

## Recommended next steps

1. **Phase 13 design pass** — turn the existing pivot rules into Rotate v2
   acceptance cases before re-enabling the control.
2. **Subassemblies** — build save/load on stable ids, graph edges, and the
   Phase 12 duplicate/group-selection backend.
3. Optional flight depth: animated leg deployment, hyperbolic rails, then
   patched-conic map continuation.
