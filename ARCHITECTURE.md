# Orbit Simulator — Architecture Notes

Developer reference for how the systems fit together. Read alongside
README.md (player-facing) and the TODO comments at each extension point.

## Layering (imports point downward only)

```
config/            pure data: parts, celestial bodies, constants, stock craft
math/              Vec2, two-body orbit math, formatting
vehicle/           part model: definitions -> customization -> resolved
                   instances; design (blueprint JSON); runtime (flight state);
                   connectivity-graph staging; center of mass
physics/           fixed-timestep integration, gravity (all bodies),
                   dominant-body atmosphere/collision, attitude/torque,
                   thermal model
space/             analytic Kepler propagation (rails warp), SOI helpers,
                   celestial frame migration notes
systems/           orchestration: FlightSession, VesselManager, TimeWarp,
                   VehicleAnalysis, CareerSystem, Resources/Maneuver stubs
storage/           SaveSystem (slots, corruption-protected), Settings
render/            PixiJS views (meters -> pixels only via CameraController)
ui/                DOM overlays: HUD, navball, panels, dialogs, debug
builder/ flight/ center/   the four scenes
app/               GameApp (loop, scene routing, save orchestration)
```

**Hard rule:** nothing below `render/` imports DOM or Pixi. `npm run sim`
drives a full FlightSession headless and is the regression suite.

## World & save architecture

- The persistent world is `FlightSession`: world clock + `VesselManager`
  (every craft/debris is a `Vessel` with a `RocketRuntime`) + `TimeWarpSystem`.
- World time advances ONLY while the unpaused flight scene updates the
  session. VAB, Space Center, Tracking Station, and the pause menu are
  non-simulation areas. TODO: background/catch-up simulation.
- A `SaveGame` = craft blueprint (design JSON, v2) + serialized session
  (every vessel: parts with fuel/temperature/customization, state vectors,
  stages fired, SAS mode) + career state. Blueprints and world saves are
  deliberately separate objects.
- Slots: `quick`, rotating `auto-1..3` (newest first), `slot-1..3`.
  Writes go to a `:pending` key, are verified, then swapped — a mid-write
  crash cannot corrupt the previous save. Version field checked on load.
- Restores are bit-identical under further integration (sim-verified).
- IDs: vessels have persistent numeric ids (`VesselManager.nextId` is saved).
  VAB placements have stable design-local ids plus explicit attachment edges;
  runtime part state is still serialized positionally within a vessel. Docking
  will need runtime/cross-vessel part identity.

## Vessel / staging model

- A craft is a set of parts on the fractional builder grid. Explicit
  `AttachmentEdge` records are rebuilt from exact attachment-node coincidence
  (top/bottom stack nodes, left/right flanks), then `parentId` is derived from
  those edges plus `rootPartId`. Detached components retain an internal tree
  for editing but fail structural validation until joined to the root craft.
- `vehicle/StageSystem.ts` derives everything from the attachment graph:
  activation stages (radial decouplers default stage 1; stack decouplers
  bottom-up; engines ignite after the last stack decoupler below them),
  fuel groups (components with decouplers cut), and `fireStage` — the ONE
  pure function used by the flight runtime, the analysis, and the staging
  panel. Firing a stage can jettison several groups at once (booster pairs);
  each becomes its own vessel (pod aboard -> controllable probe, else debris).
- Splitting is therefore implemented; MERGING (docking) is the planned
  inverse: union two part sets, re-run `computeStagePlan`. Docking-port
  parts + approach/targeting UI are TODO.
- The default root is the command pod (fallback: first part). The VAB Root tool
  can select any part and re-derive parent links without changing staging.

## Physics

- Semi-implicit Euler at a fixed 1/60 s; physics warp = more substeps
  (max 4x); rails warp = analytic conic (`space/KeplerOrbit`), gated to
  unpowered bound elliptic arcs outside the dominant body's atmosphere.
- Attitude: A/D is a rate command. An SAS controller (modes: off /
  stability / prograde / retrograde) requests torque clamped to real
  authority — reaction wheels + engine gimbal x lever arm from the live
  CoM — against the true moment of inertia; off-CoM thrust adds real
  disturbance torque. Rotation happens about the CoM.
- SOI: collision, atmosphere, telemetry, and the navball use the dominant
  body (`space/SphereOfInfluence`). Bodies are data-driven configs
  (`config/celestialBodies.ts`) on analytic circular orbits with positions
  AND velocities; adding a moon/planet is a config entry.
- Rails warp is BODY-RELATIVE (`PhysicsWorld.engageRails/advanceOnRails`):
  it captures the conic around whichever body dominates, translates by that
  body's live position/velocity while propagating, and auto-drops warp when
  a vessel crosses an SOI boundary (`railsSoiBreak`). Map conics + Ap/Pe
  markers are drawn around the dominant body too. Remaining gaps: patched-
  conic continuation across the SOI edge, body-relative frames
  (`space/CelestialFrame.ts` documents the migration), planet rotation,
  multiple launch sites.
- Thermal (`physics/ThermalModel.ts`): per-part temperature; Sutton-Graves
  stagnation flux on the part LEADING into the airstream (bottom part when
  entering retrograde — heat shields are real), wake fraction for the rest,
  radiative + convective cooling, destruction above per-part limits with
  structural consequences (`RocketRuntime.destroyParts`). Difficulty toggle
  in Settings. TODO: ablation, conduction, fairing shielding, part-level
  drag/center-of-pressure + aerodynamic stability (CoP vs CoM warning).

## Career foundations

- `systems/CareerSystem.ts`: funds/science/reputation, world-first
  milestones (liftoff, staging, space, orbit, landing, SOI crossing),
  launch-cost charging from resolved part costs. Persisted in saves.
- Career mode = a future RULE layer over these systems (gate launches by
  funds, parts by tech tree, revert by difficulty). Sandbox and career share
  everything. TODO: contracts, tech tree, facility upgrades, recovery value.

## Editor

- All design mutations funnel through `BuilderScene.designChanged()`, which
  drives redraw, analysis, staging panel, CoM marker, AND the undo/redo
  snapshot stack — new mutation sources stay undo-safe automatically.
- Canvas pan/pinch/long-press priority is documented in
  `ui/CanvasGestures.ts`; VAB, map, and flight vessel-view share
  `PointerTracker` so two-finger pinch wins over one-finger camera pan and
  over VAB marquee/long-press/group-move.
- Free pan/zoom/pinch camera; mirror symmetry (2D equivalent of radial
  symmetry) with twin ghosts; right-click context menus (thrust limiter,
  ignition stage, procedural dims — editor-only by construction, nose
  shapes); procedural parts resolve through `vehicle/ProceduralPart.ts`.
- Phase 12 multi-selection is scene-local stable ids: the Select tool (or
  Shift) builds an AABB marquee, then Move/DUP/DEL operate on the deduplicated
  union of selected subtrees. Pure `builder/GroupOps.ts` performs atomic
  collision/bounds checks and re-syncs the graph after a commit; previews do
  not mutate design/history. `scripts/testBuilder.ts` covers this headlessly.
- `builder/DesignWarnings.ts` supplies typed, advisory gameplay checks to the
  Engineer panel. Structural/minimum-part launch blockers remain in
  `RocketAssembler.validateDesign()`.
- TODO: part search/category tabs, pad-clearance warnings, Rotate v2, and
  reusable subassemblies.

## Recovery loop (parachutes / legs / clamps / electricity)

Implemented and covered by the `npm run sim` recovery blocks — see
CURRENT_STATUS.md.

- **Parachutes** are procedural (`ProceduralPart.resolveChute`): per-instance
  type/diameter/material/deploy-altitude drive mass, cost, area, and safety
  limits. Live state (`packed/armed/deployed/cut/failed` + drogue/main
  fractions) lives on `PartInstance`; `RocketRuntime.stepChutes` runs per
  physics step doing gradual deployment, altitude/speed/q/heat gating, and
  failure. Canopy drag is added to `dragCdA` via `chuteDragCdA`.
- **Landing legs (Phase 8)**: `PartInstance.legState` (`stowed` | `deployed` |
  `broken`); `RocketRuntime.toggleLegs`, `legsDeployedAtBottom`,
  `breakBottomLegs`. Ground contact in `RocketPhysics` uses elevated tolerance
  only when legs are deployed; hard landings mark legs broken (attached, dead).
  VAB always draws stowed. Toggle: LEGS button or `L` in flight.
- **Launch clamps**: category `clamp`, treated as a release part in
  `StageSystem` (jettisoned by staging). While present, `RocketPhysics` pins
  the vessel to the pad.
- **Electricity** is the first real generalized resource: pooled on
  `RocketRuntime` (`electricCharge`, `updateElectricity`), drained by avionics/
  SAS, generated by solar (eclipse check via `sunlightFactor`), gates reaction
  wheels at zero charge. All of the above serialize in `SerializedRuntime`
  (optional fields → backward compatible).

## Deliberate stubs (data models exist, gameplay does not)

`systems/Resources.ts` (generalized resources beyond electricity),
`systems/ManeuverNodes.ts`, `future/HabitationSystem.ts`,
`space/CelestialFrame.ts`. Audio, camera shake, input rebinding, tutorials,
RCS/docking, and the developer console are documented TODOs without stubs.
