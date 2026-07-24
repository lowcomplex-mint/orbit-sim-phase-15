# Orbit Simulator

A 2D, mobile-first spaceflight simulator (inspired by KSP / Spaceflight
Simulator, all-original code and assets). Build a rocket on a strict grid,
launch it, fly it to orbit around a fictional 1:10-scale Earth, warp to the
Moon, reenter, and land. TypeScript + Vite + PixiJS, no backend, deterministic
custom physics.

For a precise breakdown of what works vs. what is stubbed, see
[CURRENT_STATUS.md](CURRENT_STATUS.md). For the developer-facing system map,
see [ARCHITECTURE.md](ARCHITECTURE.md). The latest continuation notes live in
[HANDOFF.md](HANDOFF.md).

## Requirements

- Node.js 20+ (developed on Node 22)
- npm 10+
- A modern browser (WebGL/WebGPU via PixiJS v8)

## Run it after cloning

```bash
npm install      # install dependencies
npm run dev      # start the dev server, open the printed URL
                 # (works on a phone on the same LAN too)
```

Other scripts:

```bash
npm run build         # type-check (tsc --noEmit) + production build to dist/
npm run preview       # serve the production build locally
npm run sim           # headless physics / recovery / rails / clamps / legs
npm run test:graph    # attachment graph / tree (node + surface edges)
npm run test:builder  # Phase 12 selection, group-op, and warning checks
npm run test:rotate   # Phase 13 rotate v2 + subassemblies
npx tsx scripts/testSymmetry.ts   # SYM mirror placement
```

`npm run sim` is the fastest way to confirm the physics/systems layer is
healthy after a change — it drives a real `FlightSession` in Node and checks
ascent, staging, warp, saves, reentry heating, SAS, career, Moon-relative
rails warp, landing-strut touchdown, and launch-clamp hold/release.

## Controls

| Input | Action |
| --- | --- |
| Drag from palette / placed part | Place / move (node snap **or** surface flush for legs/utility/clamps) |
| Drag empty space · wheel / pinch | Pan / zoom the editor camera |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| Select tool or `Shift`+drag | Box-select parts (`Shift`+click toggles) |
| Move tool + drag selected part | Move selected subtrees as one rigid group |
| Rotate tool · Q/E · ↺/↻ | Rotate subtree about mount joint (stack → 90°; radial uses Rot step) |
| `Ctrl+D` / `Delete` | Duplicate / delete the selected subtrees |
| SUB+ / SUB… / selection SUB | Save / place subassemblies (localStorage library) |
| SYM button | Mirror placement across x=0 (re-snaps twin; pickup removes twin) |
| Right-click a placed part | Context: engines, chutes, tanks, **clamp height/umbilical**, etc. |
| STAGING panel (hover/tap a stage) | Highlights that stage's parts |
| Throttle slider / `W` `S` / `Z` `X` | Throttle / full / cut |
| `A` / `D` or ⟲ ⟳ | Rotate — rate command, torque-limited by wheels + gimbal |
| `G` / SAS button | Cycle SAS: stability / prograde / retrograde / off |
| `Space` / STAGE | Fire next stage (spent stage becomes a persistent vessel) |
| 🪂 / LEGS / `L` | Arm parachutes / deploy or stow all landing struts (`L` in flight only) |
| `M` / MAP | Map view (pan by dragging, pinch/wheel zoom, FOLLOW/CENTER, Ap/Pe markers) |
| `,` / `.` or ◄◄ ►► | Time warp: 1–4x physics, 10–1000x rails (bound vacuum arcs, Earth or Moon) |
| `Esc` / ⏸ | Pause menu (resume, reverts, scene exits, quicksave/-load) |
| `F5` / `F9` · `F3` | Quicksave / Quickload · debug overlay |
| `L` / LOG · `R` / reset | Debug log · revert to launch |

## Architecture (one-paragraph tour)

```
src/
  app/       GameApp (loop, scenes, session lifecycle, save orchestration)
  config/    tuning data: parts, celestial bodies, constants, stock rocket
  math/      Vec2, two-body orbit math, unit formatting
  physics/   fixed-timestep multi-vessel world: gravity, dominant-body
             atmosphere/collision, torque-based attitude, reentry ThermalModel
  space/     Kepler rails propagation, SOI helpers, celestial-frame notes
  systems/   TimeWarp, VesselManager, FlightSession, VehicleAnalysis,
             CareerSystem; Resources & ManeuverNodes (data models)
  vehicle/   part definitions vs. instances, customization resolution,
             design JSON, runtime (serialize/restore), graph staging, CoM
  builder/   grid/snapping, palette, engineering + staging panels, context menu
  flight/    flight scene, controls, cameras, telemetry (dominant-relative)
  center/    Space Center hub (settings, saved games) and Tracking Station
  render/    PixiJS renderers: bodies, parts, vessel views, orbits, effects
  ui/        HUD, navball, engineer panel, pause menu, dialogs, debug overlay
  storage/   SaveSystem (blueprints + rotating game-save slots), Settings
  future/    HabitationSystem (documented placeholder)
scripts/
  simAscent.ts  deterministic regression suite (`npm run sim`)
```

Ground rules baked into the code (do not violate when continuing):

- **SI units everywhere**; pixels exist only in `CameraController.apply`.
- **Fixed 1/60 s timestep** (symplectic Euler). Physics warp = more substeps
  (capped 4x); rails warp is analytic Kepler propagation, body-relative and
  gated to stable orbits.
- **Physics never imports rendering** — `FlightSession` runs headless, which
  is why `npm run sim` can exist.
- **The world is vessels**: `VesselManager` is the persistent model; saves
  serialize the whole session and restore bit-identically (sim-verified).
- **Part stats flow one way**: config definition → PartCustomization →
  resolved PartInstance → physics/analysis. UI never computes engineering
  numbers (`systems/VehicleAnalysis` does).
- **Staging is a graph**: activation stages + fuel groups come from the
  attachment graph; one pure `fireStage` drives runtime, analysis, and the
  staging panel.
- **All editor mutations funnel through `BuilderScene.designChanged()`** so
  undo/redo, analysis, and the CoM marker never go stale.
- **Phase 12 builder checks are advisory**: live warnings flag missing control,
  crew-capable recovery without a retained chute, and incorrectly mounted
  landing struts. Launch-blocking structure rules remain in `validateDesign()`.
- **Surface attach (KSP-style):** legs, batteries, solar panels, and clamps may
  mate flush to a host hull without a node pair (`surfaceAttach` + flush edges
  in `PartGraph` / `partsAttached`). Stack parts still use node coincidence.
- **Rails warp** is allowed on any bound elliptic arc outside the atmosphere
  (including suborbital coasts); it drops on atmosphere entry or SOI change.

## Landing struts (VAB + flight)

Each **Landing Strut** part (`legs-1`) is a single LT-2-style radial leg — not a
whole gear set. **Surface-attach** anywhere along a tank/pod/engine flank (not
only mid-height nodes); use **SYM** for mirrored pairs.

- **Stowed** (default in the VAB and at spawn): strut folded upward along the hull.
- **Deployed** (`LEGS` / `L`): hinges outward, hydraulic extension, foot pad;
  the craft **sits on the feet** (ground contact uses foot positions, not just a
  crash-speed buff). Throttle up to lift off again.
- **Broken**: hard-but-survivable touchdown with legs deployed; struts stay on
  the craft but no longer support or cushion.
- On the ground, resting vessels **stick** to the body (no ice-skating around
  the planet while “landed”).

Deployed legs raise impact tolerance (12 → 20 m/s hull vs. foot contact).
Stowed or broken legs use hull tolerance only. Geometry is shared between art
and physics in `src/vehicle/LandingLegs.ts`.

## Launch clamps

**Launch Clamp** parts are KSP-cheaty pad holders:

- Surface-attach (or node) to a stack flank; stage them away to release.
- **Infinite holding strength** — mass/TWR ignored; engines can burn but the
  vessel does not translate until clamps release.
- Right-click: **tower height** (2–12 cells) and **umbilical length** (1–8 cells).
- Released clamps remain as debris on the pad.

## Known limitations / caveats

- Save data lives in browser `localStorage`; it is per-browser and not synced.
- Trajectory prediction draws the current two-body conic around the dominant
  body; it does **not** yet draw a patched-conic continuation across an SOI
  boundary (rails warp auto-drops on the transition instead).
- Reentry heating/drag is a whole-vessel model (leading-part exposure), not
  per-part occlusion. Aerodynamic stability (center of pressure) is not modeled.
- Some parts are placeholders (see CURRENT_STATUS.md): RCS/docking, solar
  eclipse nuance, fairings/adapters, and the generalized resource system
  beyond electricity.

## Current status & next steps

The launch → orbit → Moon → reenter → land loop works, including procedural
parachutes, LT-2-style landing struts with foot contact, launch clamps,
electricity, Moon-relative rails warp, and graph-safe VAB multi-selection. See
[CURRENT_STATUS.md](CURRENT_STATUS.md) for the full done/partial/stubbed
breakdown and the recommended next development phase.
