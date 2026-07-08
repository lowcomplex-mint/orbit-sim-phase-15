# Current Status

Snapshot for handoff. Validated: `tsc --noEmit` clean, `npm run build` clean,
`npm run sim` all checks pass, dev server boots, and a launch → flight smoke
test (including the new recovery parts) runs with no console errors.

This project was built in phases (MVP → persistent world → radial attachment
→ sandbox systems → recovery loop). Phase 6 (recovery + Moon rails) is
partially landed — see below for exactly what is and isn't finished.

---

## ✅ Works and is regression-tested (`npm run sim`)

- **Flight core**: fixed-timestep gravity/integration, two-body orbit math,
  ascent to a stable orbit with the stock rocket.
- **Staging**: connectivity-graph model; radial boosters; parallel staging
  (one press drops both boosters as separate persistent debris vessels);
  per-fuel-group draining; engine-plate clusters.
- **Attitude**: torque about the live center of mass, moment of inertia from
  real mass distribution, engine gimbal + reaction-wheel authority; SAS modes
  (off / stability / prograde / retrograde). One-sided thrust genuinely
  overwhelms SAS.
- **Time warp**: physics warp (≤4x, more substeps) and analytic rails warp.
  **Rails warp is now body-relative** — it engages and preserves orbits around
  **both Earth and the Moon**, and auto-drops on SOI transitions. (This was the
  headline fix of this session; verified: lunar orbit radius preserved to <1 km
  over multiple orbits on rails.)
- **Reentry heating**: per-part temperatures, orientation-aware Sutton–Graves
  flux on the leading part, radiative/convective cooling, thermal destruction
  with structural consequences, difficulty toggle.
- **Saves**: quicksave/quickload, rotating 3-deep autosave history,
  corruption-protected writes (write-verify-swap), bit-identical restore under
  further integration. Blueprints are separate from world saves.
- **Career foundations**: part + launch costs, funds/science/reputation,
  world-first milestones — all persisted.
- **Vehicle analysis**: per-stage thrust/mass/Δv/TWR/burn-time, thrust limiter,
  ignition-stage overrides.

## ✅ Works, verified live (build + boot smoke test), not yet in `npm run sim`

These are wired end-to-end (part definitions → runtime → physics →
serialization → UI) and were confirmed to boot and run without crashing, but
they do **not yet have automated regression coverage**. Validate them first in
the next session and add sim checks.

- **Procedural parachutes** (RealChute-inspired): right-click config in the VAB
  (type / diameter / material / deploy altitude, presets), gradual deployment,
  safety gates (vacuum / speed / dynamic pressure / heat) and failure states,
  real drag, canopy + plasma rendering. Armed via the 🪂 button or staging.
- **Landing legs**: deploy/retract (LEGS button), raise crash tolerance, break
  on hard-but-survivable impact, serialized.
- **Launch clamps**: pin the vessel to the pad until their stage releases them.
- **Electricity** (first generalized resource): batteries store charge, solar
  panels generate (eclipse-aware), probe core drains; reaction wheels go
  offline at zero charge on vessels that have an electrical system. Serialized.
- **Reentry visual FX**: screen-edge vignette + plasma sheath on the leading
  edge, scaled by the heating model.
- **Space Center / Tracking Station / pause menu**: hub navigation, vessel
  switching + deletion, confirmation dialogs, settings, saved-games browser.
- **VAB usability**: pan/zoom/pinch camera, undo/redo, mirror symmetry,
  procedural tanks/engine-plates/nose-cones, part context menus, CoM marker,
  stage preview highlighting.

## 🟡 Partial / stubbed (data model exists, gameplay does not)

- `systems/Resources.ts` — generalized resource definitions; only electricity
  is actually simulated. Fuel is still its own `PartInstance.fuel` field.
- `systems/ManeuverNodes.ts` — data model + notes only; no node editing.
- `future/HabitationSystem.ts` — crew/volume aggregation only.
- Map view draws the current two-body conic around the dominant body with
  Ap/Pe markers and a Moon SOI circle, but **no patched-conic continuation**
  across the SOI boundary (rails auto-drops there instead).

## ❌ Not started (were planned for Phase 6, cleanly deferred)

- VAB box selection & group move/delete/duplicate; copy/paste; subassemblies.
- Re-root tool.
- Tracking Station rename / filter / search / details panel (it currently has
  switch + delete only).
- VAB part search / category tabs / favorites.
- VAB validation warnings (landing-speed estimate, pad-clearance / engine-below-
  pad, no-chute-on-crewed-craft, etc.).
- Procedural adapters / fairings / interstages.
- RCS + docking (no stub yet).
- Tutorial/onboarding overlays; audio; input rebinding.

## ⚠️ Do not touch without a proper dev session

- **`vehicle/StageSystem.ts` + `RocketRuntime.stage()`**: the graph staging /
  `fireStage` logic is subtle (parallel groups, fuel isolation, release parts).
  It is correct and tested — change only with the sim running.
- **`physics/PhysicsWorld.ts` rails engage/advance**: body-relative capture and
  SOI-break handling. Correct and tested; easy to break silently.
- **Save serialization** (`RocketRuntime.serialize/restore`, `SaveSystem`):
  bit-identical restore is a load-bearing invariant. Any new persisted field
  must be optional for backward compatibility.

## Build / boot caveats

- Save data is browser `localStorage`, per-browser, not synced or exported.
- Requires WebGL/WebGPU (PixiJS v8). Headless `npm run sim` needs no browser.
- No known boot/build blockers as of this handoff.

## Recommended next development phase

1. **Validate & test the recovery loop** already implemented: write `npm run
   sim` checks for chute deploy/refuse-in-vacuum/fail-at-speed, combo drogue→
   main, leg deploy/break, clamp hold+release, battery drain, and a full
   launch→reenter→parachute→land run. Fix anything they surface.
2. Then resume the deferred Phase 6 list, starting with **VAB box selection +
   group ops** (unlocks copy/paste/subassemblies) and **Tracking Station
   rename/filter/search**.
3. Longer term: patched-conic map continuation across SOI; generalized fuel
   resources; RCS/docking.
