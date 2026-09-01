# Orbit Simulator — Master Handoff

**Audience:** Hasan, Grok, Sol (Codex), and any future agent  
**Updated:** 2026-09-01 (**v0.2.1** — Phase 15 **finished**; Hasan signed off the UI)  
**Authors (session history):** Grok (8–11 + rails/landing stick) → Sol/Codex (Phase 12) → Grok (Phase 13, SYM, surface attach, clamps) → Grok (Phase 14 mobile A–C) → Grok (Phase 15 SFS chrome)  
**This file is the single source of truth for status and history.**

| Location | Path |
|----------|------|
| **Canonical (Documents)** | `/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md` |
| Repo mirror | `documents/Grok additions/Handoff.md` |
| Short status | Worktree `CURRENT_STATUS.md` |
| Root pointer | Worktree `HANDOFF.md` |
| Mobile audit | Worktree `MOBILE_AUDIT.md` |
| Phase 14 plan | Worktree `phase planning/phase-14-mobile-port-plan.md` |
| **Phase 15 plan** | Worktree `phase planning/phase-15-visual-overhaul.md` — **finished** (Hasan satisfied 2026-09-01) |

---

## 1. Where the code is right now

| Item | Value |
|------|--------|
| **Grok-era GitHub** | https://github.com/lowcomplex-mint/orbi-sim-grok-era |
| **Local checkout** | `/home/hasan/orbit-simulator` — grok-era clone (`grok-era` + `origin` remotes). Old worktree path is gone. |
| **Product state** | **v0.2.1** — Phase 13 + 14 A–C + **Phase 15 complete**. Uncommitted on `/home/hasan/orbit-simulator`. Phone: **25069PTEBG**. |
| **Package version** | `0.2.1` (`package.json`) |
| **Last Sol tip** | `1ce409c` — Phase 12 VAB warnings + group ops |
| **Grok era tag** | `dd481a7` — Phases 8–11 + rails + surface stick |

### Remotes

| Remote | URL | Role |
|--------|-----|------|
| **`origin`** | https://github.com/omerbakalovic/orbit-simulator.git | Dad / Sol push target |
| **`grok-era`** | https://github.com/lowcomplex-mint/orbi-sim-grok-era.git | Public Grok-era mirror |

```bash
cd /home/hasan/orbit-simulator
git push origin main      # after commit, if pushing to omerbakalovic
git push grok-era main    # refresh public mirror
```

### Validation gates

```bash
npm run build
npm run sim
npm run test:graph
npm run test:builder
npm run test:rotate
npx tsx scripts/testSymmetry.ts
npm run test:gestures
```

Dev: `npm run dev` → http://localhost:5173/  
Phone (USB): `adb reverse tcp:5173 tcp:5173` → http://127.0.0.1:5173/

---

## 2. Product snapshot

Browser **2D orbit / rocket sandbox** (Pixi.js + Vite + TypeScript).

**Scenes:** Space Center → VAB → Flight → Tracking Station / pause.

**Phases / features (chronological):**

```
MVP → persistent world → radial attachment → sandbox systems → recovery loop
  → Phase 7 fractional VAB grid
  → Phase 8 LT-2 landing struts
  → Phase 9 Move / Root / tree scaffolding
  → Phase 10 recovery sim suite
  → Phase 11 attachment graph overhaul
  → post-11: rails outside atmosphere + surface stick-to-body landing
  → Phase 12 VAB warnings + box select / group ops (Sol)
  → Phase 13 Rotate v2 + subassemblies
  → Surface attach (KSP-style) + launch clamp overhaul + SYM reliability
  → Phase 14 A–C: mobile audit, touch part settings, VAB phone layout, palette scroll,
    unified gesture priority, landscape chrome, PWA
  → 2026-08-29 phone QA + SFS-ish flight chrome — then **Phase 15** (tokens, hub, LOG-in-bar, mockup HUD)
```

**Planning docs:** `phase planning/phase-10-11-plan.md`, `phase-11-pivot-rules.md`,
`phase-14-mobile-port-plan.md`, `phase-15-visual-overhaul.md`, `next-phase-ideas.md`.

---

## 3. What works (by layer)

### Flight / physics (`npm run sim`)

- Fixed-timestep gravity, two-body orbit math, stock ascent → orbit.
- Graph staging, radial boosters, parallel debris, engine plates.
- Attitude (CoM torque, SAS); reentry heating; saves; career; vehicle analysis.
- **Landing legs:** stowed / deployed / broken; foot contact; stick-to-surface rest.
- **Launch clamps (KSP-cheaty):** infinite hold until clamp stage fires.
- **Recovery sim:** parachutes, clamps, electricity, full mission path.
- **Rails:** bound elliptic vacuum arcs (incl. suborbital); auto-drop atmosphere + SOI.
- **Mobile flight:** dock — rotate, **STAGE**, SAS (caption above), warp (clock icon),
  map, chutes, legs, pause. Custom vertical throttle (navball-height) above the dock;
  hit zone = slider to the right screen edge, same vertical band. Vessel-view pinch.
- **Navball:** heading chevron tracks the nose; pitch readout **centered**.
- **Flight ENGINEER:** left, under Ap/Pe; header drag / tap to collapse.
- **Flight HUD (mockup, `Pictures/mock up.png`):** Ap/Pe stacked top-left; Alt/Vel
  stacked top-right (opposite engineer); extra telemetry in a collapsible **Flight ▾**
  strip (fuel, status, warp, time, stage, log).
- **Map:** FOLLOW / CENTER on a **lower-left stack**, only while map is open.

### Attachment / graph (`npm run test:graph`)

- Explicit edges (`stack` / `radial`); tree from edges + root; disconnect detection.
- **Surface edges:** flush hull contact for `surfaceAttach` parts when no node mate.
- Detached-component forest (dup/subassembly remain movable until re-snapped).

### VAB (`npm run test:builder` / `test:rotate` / `testSymmetry` + browser)

| Feature | Behavior |
|---------|----------|
| **Surface attach** | Legs, battery, solar, clamps snap flush on tank/pod/engine flanks |
| **SYM** | Re-snaps twin (left↔right nodes); pickup/delete removes geometric twin |
| **Rotate v2** | Mount joint pivot; stack 90°; radial uses Rot step; Q/E ↺/↻ |
| **Subassemblies** | SUB+ / SUB… / selection SUB; localStorage; **DOM modals** (not `prompt`) |
| **Select / group** | Marquee, DUP/DEL, Ctrl+D, rigid multi-subtree move |
| **BUILD CHECKS** | Advisory: no control, crewed return without chute, legs off flank |
| **Part settings** | Right-click, **long-press (touch)**, or selection **Edit** — chutes, engines, clamps, procedural dims, nose shapes |
| **Undo/redo** | Toolbar ↶ / ↷ (and Ctrl+Z/Y) |
| **Phone layout** | Grouped bars + divider after Rot; **◄ KSC**; FIT gone (still `fitView()` on enter); SYM is a mirror glyph; LOG is `☰` on the bar (no floating button); flush notch padding; tighter palette |

---

## 4. Partial / not started

| Status | Item |
|--------|------|
| Partial | Electricity only; maneuver nodes data-only |
| Partial | Map: single-body conic |
| Partial | Legs: no deploy animation / suspension / tip-over |
| Partial | Surface attach: lateral L/R flanks (not free-form top/bottom) |
| Partial | Subassembly library: localStorage only |
| Partial | Phase 14 D: frame-budget profile on mid-tier Android |
| Not started | Hyperbolic rails; patched conics; RCS; fairings; tutorial; audio |

---

## 5. Known fixes vs watch items

| Severity | Item | Notes |
|----------|------|--------|
| Fixed | Landed “skating” | `stickToSurface` matches surface velocity |
| Fixed | Rails denied for suborbital vacuum | Bound elliptic outside atm OK |
| Fixed | SYM only X-flipped origin | Now re-snaps mirrored nodes; pickup removes twin |
| Fixed | Utility parts node-only attach | Surface attach for legs/utility/clamp |
| Fixed | Clamps awkward / weak UX | Adjustable tower + umbilical; infinite hold |
| Fixed | Legs both point same way in VAB | Stack center ignored clamps/legs; use core column |
| Fixed | No touch path for part settings | Long-press + Edit + bottom-sheet menu |
| Fixed | VAB phone UI unusable | Scrollable bars, capped panels, scrollable palette |
| Fixed | Flight ENGINEER not movable | Drag header; tap to collapse (v0.2.1) |
| Fixed | Navball heading always screen-up | Chevron no longer counter-rotates; radii scale with ball size |
| Fixed | LOG overlapping VAB top bar | Floating toggle removed; `☰` lives in VAB row 1 and Flight strip |
| By design | Empty rows in a Chrome **tab** | URL bar + Android nav. Cannot paint there. PWA standalone / Add to Home Screen hides the URL bar. |
| Watch | Recovery legs often “broken” on chute land | Survive asserted |
| By design | Dup / subassembly starts detached | Snap on for launch-valid craft |

---

## 6. Regression commands

```bash
cd /home/hasan/orbit-simulator
npm run build && npm run sim && npm run test:graph && npm run test:builder && npm run test:rotate
npx tsx scripts/testSymmetry.ts
npm run test:gestures
```

| Touch… | Run… |
|--------|------|
| Graph, group, rotate, subassembly, SYM, surface | graph + builder + rotate + testSymmetry |
| Staging, rails, landing, clamps | `sim` |
| Saves | optional fields + `sim` |
| Gesture tracker math | `test:gestures` |
| Mobile UI | `MOBILE_QA_CHECKLIST.md` + live 25069PTEBG (`adb reverse tcp:5173`) |

---

## 7. Key file map

| Path | Role |
|------|------|
| `src/vehicle/SurfaceAttach.ts` | Surface attach rules + flush detection |
| `src/builder/SurfaceAttach.ts` | VAB surface snap candidates |
| `src/builder/Symmetry.ts` | SYM twin re-snap + twin find |
| `src/builder/RotateOps.ts` | Rotate v2 pivots |
| `src/builder/Subassembly.ts` | Subassembly extract/place/library |
| `src/builder/PartContextMenu.ts` | Part settings menu |
| `src/builder/PartPalette.ts` | Palette; scroll vs drag disambiguation |
| `src/ui/ModalForms.ts` | Touch-friendly text/list modals |
| `src/builder/GroupOps.ts` / `SelectionBox.ts` / `DesignWarnings.ts` | Phase 12 |
| `src/vehicle/PartGraph.ts` | Edges (node + surface), tree, validation |
| `src/vehicle/LandingLegs.ts` | LT-2 geometry |
| `src/physics/GroundContact.ts` | Foot contact, stick-to-surface |
| `src/physics/RocketPhysics.ts` | Integration, clamps pin, landing |
| `src/ui/CanvasGestures.ts` | Shared pan/pinch tracker + gesture priority |
| `src/ui/FlightEngineerPanel.ts` | In-flight ENGINEER; header drag / tap collapse |
| `src/style.css` | Phase 15 tokens (`--bg`, `--hairline`, `--radius: 0`); HUD / dock / VAB |
| `src/ui/Hud.ts` | Ap/Pe, Alt/Vel, collapsible Flight strip |
| `src/ui/PwaInstall.ts` | `beforeinstallprompt` + hub **Add to Home Screen** |
| `src/ui/DebugLog.ts` | Panel only; scenes own the toggle |
| `MOBILE_AUDIT.md` | Phase 14 A gap inventory |
| `MOBILE_QA_CHECKLIST.md` | Device QA sheet for touch / landscape / PWA |
| `scripts/simAscent.ts` | Physics/recovery regression |

---

## 8. Recommended next work

1. Hyperbolic rails / patched-conic map.  
2. Leg deploy animation / tip-over.  
3. Subassembly file export polish.  
4. Phase 14 D — mobile frame-budget profile.  
5. Commit/push Phase 15 when ready (`grok-era` + optionally `origin`).

---

# Grok’s additions (inventory)

### Phases 8–11 + post-11 (commit `dd481a7` era)

- LT-2 struts, graph, recovery sim, rails outside atm, stick-to-surface landing.
- Planning docs under `phase planning/`.

### Phase 13

- `RotateOps.ts`, `Collision.ts`, `Subassembly.ts`, `test:rotate`.
- Rotate UI re-enabled; rotationDeg no longer wiped on graph sync.

### SYM reliability

- `Symmetry.ts`: node-aware twin placement; geometric twin removed on pickup/delete.
- `scripts/testSymmetry.ts`.

### Surface attach + clamps

- `vehicle/SurfaceAttach.ts` + builder snap; `surfaceAttach` on legs/battery/solar/clamp.
- Graph: one surface edge per free surface-part to best host if no node mate.
- Clamps: adjustable `heightCells` + `clampUmbilicalCells`; cheaty infinite pin;
  context menu + umbilical art in `RocketRenderer`.

### Leg outward-sign fix

- `stackCoreCenterXCells()` in `LandingLegs.ts` — average core stack only.

### Phase 14 mobile (v0.2.0 A–B, v0.2.1 C+E + phone QA)

- Gestures, long-press settings, PWA files, ENGINEER drag. See `MOBILE_AUDIT.md`.

### Phase 15 visual overhaul (**finished** 2026-09-01, uncommitted)

- Tokens: black, square, `--hairline`. Hub: VAB/Launch/Tracking/Resume/Saves/Settings; no gradient; no Mission Control.
- VAB: `◄ KSC`; FIT off the bar; SYM SVG; divider after Rot; LOG `☰` in-bar.
- Flight HUD from `Pictures/mock up.png`: Ap/Pe left, Alt/Vel right, **Flight ▾** extras.
- Dock: STAGE word, SAS caption, clock on warp; FOLLOW/CENTER lower-left **map only**.
- Custom throttle (not native range — Android ignored box height). Fat hit zone: slider → right edge, same Y as the bar. Number/thumb follow the drag.
- PWA: pass-through SW (caching Vite HTML caused a white screen); hub **Add to Home Screen**. Chrome tab cannot hide URL/nav bars; USB `adb reverse` required for `127.0.0.1`.
- Hasan: **satisfied with the UI for now.** Plan: `phase planning/phase-15-visual-overhaul.md`.

### Scripts

```
sim, test:graph, test:builder, test:rotate, test:gestures, scripts/testSymmetry.ts
```

---

# Sol / Codex additions (Phase 12 — `1ce409c`)

Select tool, group move/dup/delete, BUILD CHECKS, detached-tree graph hardening,
`test:builder`, early mobile VAB polish. Folded into §3 above.

---

## 9. One-line briefing

> Orbit sim **v0.2.1** + **Phase 15 finished** (SFS chrome, mockup HUD, custom
> throttle). Uncommitted. Next: hyperbolic rails / patched conics. Gates: `build`,
> `sim`, `test:graph`, `test:builder`, `test:rotate`, `testSymmetry`, `test:gestures`.
> Master doc: this file.
