# Current Status

Snapshot for handoff. Validated: `tsc --noEmit` clean, `npm run build` clean,
`npm run sim` all checks pass, `npm run test:graph` all checks pass.

Phases landed: MVP → persistent world → radial attachment → sandbox systems →
recovery loop → **Phase 7 fractional VAB grid** → **Phase 8 deployable legs**
→ **Phase 9 root/transform/rotate/reroot** → **Phase 10 recovery sim suite**
→ **Phase 11 node/attachment overhaul**.

---

## ✅ Works and is regression-tested

### `npm run sim`

- **Flight core**: fixed-timestep gravity/integration, two-body orbit math,
  ascent to a stable orbit with the stock rocket.
- **Staging**: connectivity-graph model; radial boosters; parallel staging;
  per-fuel-group draining; engine-plate clusters.
- **Attitude**: torque about the live center of mass, SAS modes; one-sided thrust
  overwhelms SAS.
- **Time warp**: physics warp + analytic body-relative rails warp.
- **Reentry heating**, **saves**, **career foundations**, **vehicle analysis**.
- **Landing legs (Phase 8)**: deploy/stow/break, foot contact, sim gates.
- **Recovery loop (Phase 10)**: parachutes, clamps, electricity, capstone mission.

### `npm run test:graph`

- **Attachment graph (Phase 11)**: explicit edges (stack/radial), derived tree,
  structural validation, reroot, subtree move, mirror parent sync, disconnect
  detection.

## ✅ Works, verified live (build + boot)

- **Procedural parachutes**, **launch clamps**, **electricity** — sim-covered (P10).
- **Reentry visual FX**, **Space Center / Tracking Station / pause menu**.
- **VAB tools**: Place, Move, Root (reroot); **Rotate disabled** until Phase 13.
  Snap + fractional grid, explicit edge list + derived tree, SYM mirror parentId
  fix, CoM marker, staging preview, context menus.

## 🟡 Partial / stubbed

- `systems/Resources.ts` — only electricity simulated.
- `systems/ManeuverNodes.ts` — data model only.
- Map: single-body conic; no patched-conic SOI continuation.
- Leg deploy animation / per-leg toggle.
- **Rotate v2** — spec in `phase-11-pivot-rules.md`; UI greyed out.

## ❌ Not started

- **Phase 12**: VAB gameplay-rule warnings + box select / group ops.
- **Phase 13**: Rotate v2 + subassemblies.
- Tracking Station rename/filter/search; procedural adapters; RCS; tutorial; audio.

## ⚠️ Do not touch without `npm run sim` + `npm run test:graph`

- `vehicle/PartGraph.ts`, `vehicle/StageSystem.ts`, `RocketRuntime.stage()`
- `physics/PhysicsWorld.ts` rails engage/advance
- Save serialization — new fields optional only (`edges` optional)

## Recommended next steps

1. **Phase 12** — validation warnings (no chute on crewed return, etc.) + box select.
2. **Phase 13** — Rotate v2 per pivot spec (quantized stack, radial spin).
3. Animated leg deploy (nice-to-have).