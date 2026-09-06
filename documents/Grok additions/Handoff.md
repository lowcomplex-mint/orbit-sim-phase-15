# Orbit Simulator — Signed Handoff (Phase 15 complete)

**Read this file first.** It is written for an agent with **zero prior context**.
Do not rummage the repo to reconstruct status, phase numbering, or “what’s next.”
Other markdown is either a pointer, a living QA sheet, or a **historical** plan.

| Field | Value |
|-------|--------|
| **Owner** | Hasan |
| **Product** | **v0.2.1** (`package.json`) |
| **Phase** | **15 finished and signed off.** Do not restyle chrome. |
| **Code tip** | `0ff4ee0` — *Release v0.2.1: Phase 14 C gestures/PWA and Phase 15 SFS chrome.* |
| **This docs snapshot** | 2026-09-06 |
| **GitHub** | https://github.com/lowcomplex-mint/orbit-sim-phase-15 |
| **Local checkout** | `/home/hasan/orbit-simulator` |
| **Phone used for QA** | `25069PTEBG` (Android, 1280×2772 @ density 520 → ~394×853 CSS, notch ~47px) |
| **Hasan on UI** | “satisfied with the UI for now” (2026-09-01). Phase 15 is **closed**. |

**Default next work:** Phase 16 — hyperbolic rails + patched-conic map (gameplay, not chrome).
If Hasan’s prompt names a different task, do that instead. Do **not** start an APK,
do **not** restyle the HUD, do **not** push `origin` (dad’s repo — 403 for this login).

---

## 0. What this project is

A **2D, mobile-first** orbital sandbox inspired by Kerbal Space Program and
Spaceflight Simulator. **All-original** TypeScript + Vite + PixiJS v8. Fictional
**1:10-scale Earth** + Moon. Browser app (PWA / Add to Home Screen). Not a native APK.

**Loop that already works:** VAB build → pad clamps → launch → orbit → warp →
Moon SOI (logged, not a true Moon-centered orbit) → reenter → chutes → legs → land.

**Scenes:** Space Center (hub) → VAB → Flight → Tracking Station / pause.

---

## 1. Clone, remotes, run, gates

### Remotes

| Remote | URL | Role |
|--------|-----|------|
| **`grok-era`** (push this) | https://github.com/lowcomplex-mint/orbit-sim-phase-15.git | Public Grok-era repo. **This is the working remote.** |
| **`origin`** | https://github.com/omerbakalovic/orbit-simulator.git | Dad / Sol. **`lowcomplex-mint` gets 403.** Do not push unless Hasan asks and auth is fixed. |

Old GitHub name `orbi-sim-grok-era` redirected after the 2026-09-06 rename.

```bash
cd /home/hasan/orbit-simulator          # or: git clone https://github.com/lowcomplex-mint/orbit-sim-phase-15.git
npm install
npm run dev                             # http://localhost:5173/
# Phone over USB:
adb reverse tcp:5173 tcp:5173           # then open http://127.0.0.1:5173/ on the device
```

LAN (`http://<host-ip>:5173/`) only works if the phone and PC share Wi-Fi.
USB reverse is the reliable path. After `adb` re-enumerates, reverse is **gone**
— re-run it or the phone shows a white screen.

### Gates (run the ones that match your change)

```bash
npm run build           # tsc --noEmit + vite production build
npm run sim             # headless physics / recovery / rails / clamps / legs
npm run test:graph      # attachment graph (node + surface edges)
npm run test:builder    # selection, group ops, BUILD CHECKS
npm run test:rotate     # Rotate v2 + subassemblies
npm run test:gestures   # PointerTracker pan/pinch math
npx tsx scripts/testSymmetry.ts
```

| You touched… | Run… |
|--------------|------|
| Graph, group, rotate, subassembly, SYM, surface attach | graph + builder + rotate + testSymmetry |
| Staging, rails, landing, clamps, warp eligibility | `sim` |
| Save fields | keep new fields **optional** + `sim` |
| Gesture tracker math | `test:gestures` |
| CSS / HUD / dock (only if Hasan asks) | `build` + live phone (`MOBILE_QA_CHECKLIST.md`) |

`npm run sim` drives a real `FlightSession` in Node. Physics must never import
Pixi/DOM or this suite dies.

---

## 2. Ground rules (do not violate)

1. **SI units everywhere.** Pixels exist only in `CameraController.apply`.
2. **Fixed 1/60 s** symplectic Euler. Physics warp = more substeps (cap 4×).
   Rails warp = analytic Kepler, body-relative, gated (see §7).
3. **Physics never imports rendering.** `FlightSession` is headless.
4. **The world is vessels.** `VesselManager` is the persistent model. Saves
   serialize the whole session and restore bit-identically (`sim`-verified).
5. **Part stats flow one way:** `config/parts.ts` → `PartCustomization` →
   resolved `PartInstance` → physics / `VehicleAnalysis`. UI never computes
   engineering numbers.
6. **Staging is a graph.** One pure `fireStage` in `vehicle/StageSystem.ts`
   drives runtime, analysis, and the staging panel.
7. **All VAB mutations go through `BuilderScene.designChanged()`** (undo/redo,
   analysis, CoM stay coherent).
8. **New save fields are optional** (backward compatible).
9. **Phase 12 BUILD CHECKS are advisory.** Launch blockers stay in
   `RocketAssembler.validateDesign()`.
10. **Surface attach** (legs, battery, solar, clamps): flush hull edges, not a
    node pair. Stack parts still use node coincidence.
11. **Chrome is frozen.** Black, square, hairline, no blue, no rounded pills.
    Tokens in `src/style.css` (`--bg`, `--panel`, `--hairline`, `--radius: 0`).

---

## 3. What works (do not rebuild)

### Flight / physics — `npm run sim`

- Gravity, two-body `OrbitMath`, stock ascent → orbit, graph staging, debris.
- Attitude: CoM torque, SAS (stability / prograde / retrograde / off).
- Reentry heating (`ThermalModel`), career milestones, vehicle analysis.
- **Landing legs:** stowed / deployed / broken; foot contact; stick-to-surface
  rest (no pad skating). Outward sign uses **core stack center** (not clamps).
- **Launch clamps:** KSP-cheaty **infinite hold** until the clamp stage fires;
  debris left on pad. Tower height 2–12, umbilical 1–8 (part settings).
- **Parachutes:** procedural, deploy gates, failure, recovery-mission block.
- **Electricity:** pooled charge, solar, SAS drain.
- **Rails:** any **bound elliptic** vacuum arc (incl. suborbital) around the
  **dominant body**. Auto-drop on atmosphere or SOI change. **Escape /
  near-parabolic is TODO** (this is Phase 16).
- **Map:** single-body conic (ellipse *and* hyperbola drawing already exist in
  `OrbitPredictor`). FOLLOW / CENTER = lower-left stack, **map-only**.
- **Flight HUD (signed off):** Ap/Pe stacked **top-left**; Alt/Vel stacked
  **top-right**; extras in collapsible **Flight ▾** strip (fuel, status, warp,
  time, stage, log). ENGINEER left, under Ap/Pe; header drag / tap collapse.
- **Dock:** icon row + **STAGE** word; SAS caption; clock on warp; pause.
- **Throttle:** **custom** vertical track (not `<input type=range>` — Android
  ignored CSS height). Height ≈ navball, just above the dock. Hit zone =
  **slider → right screen edge, same Y band** (`.throttle-hit` / `.flight-side`).
  `FlightControls.setThrottle` **must** fire `onThrottleChanged`. Android
  `pointermove` often has `buttons === 0` — do not gate the drag on `buttons`.
- **Navball:** heading chevron tracks the nose (do **not** extra-counter-rotate);
  pitch readout centered.

### VAB — `test:graph` / `test:builder` / `test:rotate` / `testSymmetry`

| Feature | Behavior |
|---------|----------|
| Surface attach | Legs, battery, solar, clamps snap flush on tank/pod/engine **L/R flanks** |
| SYM | Mirror glyph (not ✗/✓). Re-snaps twin (left↔right nodes); pickup/delete removes twin |
| Rotate v2 | Mount-joint pivot; stack 90°; radial uses Rot step; Q/E and ↺/↻ |
| Subassemblies | SUB+ / SUB… / selection SUB; **localStorage**; DOM modals (not `window.prompt`) |
| Select / group | Marquee, DUP/DEL, Ctrl+D, rigid multi-subtree move |
| BUILD CHECKS | Advisory: no control, crewed return without chute, legs off flank |
| Part settings | Right-click, **long-press**, or selection **Edit** |
| Phone chrome | `◄ KSC`; **no FIT button** (`fitView()` still on enter); divider after Rot; LOG `☰` **in the bar** (no floating `#ui-root` button); Default **kept**; flush notch paint |

### Hub / PWA

- Hub: VAB, Launch, Tracking, Resume (**shown disabled** if no session), Saves,
  Settings. **No Mission Control. No gradient.**
- PWA: `public/manifest.json`, icons, **pass-through** SW
  (`public/sw.js`, cache name `orbit-sim-passthrough-1`). Hub **Add to Home
  Screen**. Chrome **tab** still shows URL bar + Android nav — that is browser
  chrome, not missing CSS. A previous caching SW caused a **white screen**;
  `index.html` one-shots unregister + cache wipe via
  `sessionStorage['orbit-sw-cleared']`. **Do not make the SW cache Vite HTML.**

### Gestures (Phase 14 C) — `src/ui/CanvasGestures.ts`

Two-finger pinch **preempts** pan, marquee, long-press, and group-move.
Placement ghost stays; camera pinches under it. Shared `PointerTracker`.
Hasan signed gestures off 2026-08-29.

---

## 4. Partial / not started

| Status | Item |
|--------|------|
| Partial | Generalized resources (electricity only) |
| Partial | Maneuver nodes (data model only, `systems/ManeuverNodes.ts`) |
| Partial | Map: single-body conic (no patched continuation across SOI) |
| Partial | Legs: no deploy animation / suspension / tip-over |
| Partial | Surface attach: lateral L/R only (not free-form top/bottom) |
| Partial | Subassembly library: localStorage only (no file export) |
| Partial | Phase 14 **D**: frame-budget profile on mid-tier Android |
| Partial | SOI: dominant body used for collision/atm/telemetry/rails capture; **world frame is still Earth-origin**. Moon orbit/landing is not real yet |
| Not started | **Hyperbolic / near-parabolic rails** |
| Not started | **Patched-conic map + CelestialFrame migration** |
| Not started | RCS / docking (merge vessels) |
| Not started | Fairings / adapters |
| Not started | Tutorial, audio, contracts / tech tree |
| Not started | Tracking Station rename/filter; native APK |

---

## 5. File map (go here, not on a fishing expedition)

```
src/
  app/         GameApp (loop, scenes, saves)
  config/      parts, celestialBodies, constants, stock rocket
  math/        Vec2, OrbitMath (already computes unbound conics), Units
  physics/     PhysicsWorld, RocketPhysics, GroundContact, ThermalModel,
               OrbitPredictor (already *draws* hyperbolas)
  space/       KeplerOrbit (elliptic rails only), SphereOfInfluence, CelestialFrame (doc-only)
  systems/     FlightSession (rails eligibility), VesselManager, TimeWarp,
               VehicleAnalysis, CareerSystem; Resources & ManeuverNodes stubs
  vehicle/     PartGraph, StageSystem, LandingLegs, SurfaceAttach, RocketRuntime
  builder/     BuilderScene + snap/rotate/SYM/group/subassembly/context menu
  flight/      FlightScene (HUD/dock/throttle/map), FlightControls, cameras, Telemetry
  center/      SpaceCenterScene, TrackingStationScene
  render/      Pixi views (meters → pixels only via camera)
  ui/          Hud, Navball, CanvasGestures, PwaInstall, FlightEngineerPanel, DebugLog
  storage/     SaveSystem, Settings
  future/      HabitationSystem (placeholder)
scripts/       simAscent.ts, testPartGraph.ts, testBuilder.ts, testRotate.ts,
               testGestures.ts, testSymmetry.ts
public/        manifest.json, sw.js (pass-through), icons
```

| Path | Why you care |
|------|----------------|
| `src/space/KeplerOrbit.ts` | Elliptic rails; `MAX_RAILS_ECCENTRICITY = 0.95`; TODO universal-variable hyperbola |
| `src/systems/FlightSession.ts` `checkRailsEligibility()` | Rejects unbound: *“hyperbolic rails propagation is TODO”* |
| `src/physics/PhysicsWorld.ts` | `engageRails` / `advanceOnRails`; Earth pinned at origin |
| `src/space/SphereOfInfluence.ts` | `getDominantBody`, SOI radius; 4-step patched-conic TODO in the file header |
| `src/space/CelestialFrame.ts` | Agreed frame-migration plan. **Nothing implements it yet.** |
| `src/math/OrbitMath.ts` | `isBound`, `apoapsisRadius = Infinity` on escape; already hyperbola-capable |
| `src/physics/OrbitPredictor.ts` | Map polyline for ellipse **and** hyperbola (draw ≠ warp) |
| `src/config/celestialBodies.ts` | Earth + Moon; `APPLY_MOON_GRAVITY`; Sun is decorative |
| `src/flight/FlightScene.ts` | Throttle hit strip, HUD, map camera; patched-conic draw TODO |
| `src/flight/FlightControls.ts` | `setThrottle` must notify UI |
| `src/style.css` | Phase 15 tokens; `.throttle-hit` / `.flight-side { right: 0; width ~48px }` |
| `src/ui/Hud.ts` | Ap/Pe, Alt/Vel, Flight ▾ strip |
| `src/vehicle/PartGraph.ts` | Edges (stack / radial / surface) |
| `src/builder/RotateOps.ts` / `Symmetry.ts` / `SurfaceAttach.ts` / `Subassembly.ts` | VAB tools |
| `src/ui/CanvasGestures.ts` | Shared pan/pinch + priority |
| `public/sw.js` | Pass-through only |

---

## 6. Phase 15 UI contract (frozen)

Reference mockup on Hasan’s machine: `Pictures/mock up.png` (not in git).
Plan (historical, shipped): `phase planning/phase-15-visual-overhaul.md`.

Hasan defaults (locked): **Default stays on the VAB bar.** **Resume shown
disabled** when no session. **Dock is icons-only** except STAGE as a word.

Do **not**:

- Reintroduce blue, gradients, or `border-radius` on chrome.
- Put LOG back as a floating `#ui-root` button.
- Put FIT back on the VAB bar.
- Put FOLLOW/CENTER on the vessel dock.
- Use a native vertical `<input type=range>` for throttle.
- Cache Vite `/` HTML in the service worker.
- Treat Chrome-tab empty rows as a CSS bug.

---

## 7. Recommended next — Phase 16 (hyperbolic rails / patched conics)

**Goal:** warp along escape trajectories, and show a map that continues across
an SOI instead of a single Earth-centered conic. This is the highest-leverage
gameplay gap. UI is done.

### Already true (do not re-derive)

- `OrbitMath.computeOrbitInfo` classifies bound vs escape and returns a finite
  periapsis for hyperbolas via the semi-latus rectum.
- `OrbitPredictor.predictOrbitPoints` already samples hyperbolic legs (clipped).
- Rails capture is **already dominant-body-relative** (`FlightSession` subtracts
  the dominant body’s position/velocity before `computeOrbitInfo`).
- Collision, atmosphere, telemetry, navball already use `getDominantBody`.
- Rails **already drop** on atmosphere entry and SOI change.
- World frame is still **Earth at the origin**. Moon gravity is a second
  point-mass. You can enter the Moon SOI in the log and still not *orbit* it
  as a primary. True Moon orbit/landing needs `CelestialFrame` (step 2 below).

### Suggested split (ship in this order unless Hasan says otherwise)

**16a. Hyperbolic + near-parabolic rails** (smallest useful slice)

1. Extend `space/KeplerOrbit.ts` with a universal-variable (or equivalent)
   propagator for `e ≥ 1` and high-e ellipses. Keep elliptic path working.
2. Relax `canPropagateOnRails` / `MAX_RAILS_ECCENTRICITY` and the reject
   strings in `FlightSession.checkRailsEligibility`.
3. Still refuse: crashed, landed, throttle > 0, inside atmosphere.
4. Add a `npm run sim` block: burn to escape, engage rails, assert position
   matches the analytic hyperbola after a large dt (and still auto-drops in
   atmosphere).
5. Do **not** wait on CelestialFrame to ship 16a.

**16b. Patched-conic map**

1. Map currently draws one conic around the dominant body
   (`FlightScene` / `OrbitRenderer` / `OrbitPredictor`).
2. At the SOI sphere, convert state into the next body’s frame (subtract/add
   analytic body position **and** velocity — see `CelestialFrame.ts` comments)
   and draw the continuation.
3. Ap/Pe markers should follow the conic they belong to.

**16c. Real Moon orbit / landing** (only if Hasan wants the full SOI switch)

Follow the 4-step list already in `SphereOfInfluence.ts`:

1. Store vessel state relative to the dominant body (`CelestialFrame`).
2. On SOI transition, convert state vectors between frames.
3. Collide against the dominant body’s surface (not only Earth’s).
4. Rails capture around the dominant `mu` (16a + 16b make this natural).

Then Earth may eventually orbit the Sun; today `SUN_VISUAL` is a map disc.

### Out of scope for Phase 16 unless Hasan asks

Chrome, APK, RCS/docking, fairings, leg animation, contracts, audio.

---

## 8. Gotchas (rediscovering these wastes tokens)

| Trap | Truth |
|------|--------|
| Native vertical range slider | Android draws it through the dock ignoring CSS height. Custom track/fill/thumb only. |
| Throttle UI not updating | `setThrottle` must call `onThrottleChanged`. Keyboard path already does. |
| `pointermove` + `e.buttons === 0` | Normal on Android. Keep a drag flag; don’t require buttons. |
| Throttle hit zone | Same **vertical band** as the slider, from the track to the **right edge**. Not full-height, not above/below. |
| Heading chevron always-up | Do not apply an extra counter-rotation on the chevron. |
| LOG overlapping VAB | Caused by floating `#ui-root` toggle vs `--log-gutter`. Toggle is **in-bar** now. |
| White screen on phone | (1) `adb reverse` dropped after USB re-enumeration; (2) SW cached Vite HTML. Pass-through SW + one-shot unregister in `index.html`. |
| Chrome “empty rows” | URL bar + Android nav. Cannot paint there in a tab. Add to Home Screen / `display: standalone`. |
| `git push origin` | 403 for `lowcomplex-mint`. Push **`grok-era`**. |
| Commit author | Repo history uses `lowcomplex-mint <lowcomplex-mint@users.noreply.github.com>`. Set local `user.name` / `user.email` if git complains. |
| `gh repo view` with no args | Resolves `origin` (dad’s `orbit-simulator`), not grok-era. Use `lowcomplex-mint/orbit-sim-phase-15`. |
| Historical markdown | Phase 8–14 plans still exist. They are **done**. Banners say so. Trust **this file**. |
| Rotate “still TODO” in old docs | **Shipped in Phase 13.** `test:rotate`. |
| Subassemblies “still TODO” | **Shipped in Phase 13.** localStorage only. |
| FIT button | **Removed** from the VAB bar in Phase 15. `fitView()` still runs on enter. |

---

## 9. Doc map (what to open)

| File | Role |
|------|------|
| **`HANDOFF.md` (this file)** | **Single source of truth.** Also mirrored at `documents/Grok additions/Handoff.md` and, on Hasan’s machine, `/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md`. Keep the three in sync. |
| `CURRENT_STATUS.md` | Short living done / partial / next list |
| `README.md` | Player-facing clone/run/controls |
| `ARCHITECTURE.md` | Layering and invariants (developer reference, not a task list) |
| `MOBILE_AUDIT.md` | **Historical** Phase 14 A audit (2026-07-25) + closure notes |
| `MOBILE_QA_CHECKLIST.md` | Living device QA sheet |
| `phase planning/phase-15-visual-overhaul.md` | **Shipped** UI spec (do not re-execute) |
| `phase planning/phase-14-mobile-port-plan.md` | **Shipped** A–C; D (frame budget) still open |
| `phase planning/phase-10-11-plan.md`, `phase-11-pivot-rules.md`, `next-phase-ideas.md` | **Historical.** Phases 10–13 done |
| `next-phase-prompt-legs-and-root-rewrite.md` | **Historical** Phase 8/9 prompt |
| `documents/Grok additions/Phase *.md` | **Historical** session notes |

---

## 10. History (one screen)

```
MVP → persistent world → radial attach → sandbox systems → recovery loop
  →  7  fractional VAB grid
  →  8  LT-2 landing struts
  →  9  Move / Root scaffolding
  → 10  recovery sim suite          (commit era dd481a7)
  → 11  attachment graph
  →     rails outside atm + stick-to-surface
  → 12  VAB warnings + group ops    (Sol/Codex, 1ce409c)
  → 13  Rotate v2 + subassemblies
  →     surface attach + clamps + SYM + leg outward-sign   (a4c0a20)
  → 14  A–C mobile: long-press, VAB phone layout, gestures, PWA
        (v0.2.0 = 4b481c0 A–B; v0.2.1 C in 0ff4ee0)
  → 15  SFS chrome, mockup HUD, custom throttle            (0ff4ee0, signed off)
```

Authors: Grok (8–11, 13–15) · Sol/Codex (Phase 12).

---

## 11. One-line briefing

> Orbit sim **v0.2.1**, GitHub **`lowcomplex-mint/orbit-sim-phase-15`**, tip
> **`0ff4ee0`**. Phase 15 SFS chrome is **finished and signed off**. Next:
> **hyperbolic rails / patched-conic map**. Gates: `build`, `sim`, `test:graph`,
> `test:builder`, `test:rotate`, `testSymmetry`, `test:gestures`. Push
> `grok-era`, not `origin`. Read **this file**, not the historical plans.

---

**Signed:** Hasan (owner) · Grok (executor, 2026-09-06)  
Phase 15 UI accepted on `25069PTEBG`. Chrome frozen. Gameplay continues at Phase 16.
