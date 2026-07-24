# Orbit Simulator — Master Handoff

**Audience:** Hasan, Grok, Sol (Codex), and any future agent  
**Updated:** 2026-07-24 (surface attach + clamps + SYM + Phase 13)  
**Authors (session history):** Grok (8–11 + rails/landing stick) → Sol/Codex (Phase 12) → Grok (Phase 13, SYM fixes, surface attach, clamp overhaul)  
**This file is the single source of truth for status and history.**

| Location | Path |
|----------|------|
| **Canonical (Documents)** | `/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md` |
| Repo mirror | `documents/Grok additions/Handoff.md` |
| Short status | Worktree `CURRENT_STATUS.md` |
| Root pointer | Worktree `HANDOFF.md` |

---

## 1. Where the code is right now

| Item | Value |
|------|--------|
| **Grok worktree** | `/home/hasan/.grok/worktrees/hasan-orbit-simulator/orbit-simulator` |
| **Product state** | Phase 13 + surface attach + clamp overhaul + SYM fixes (likely **uncommitted** on top of `1ce409c`) |
| **Last Sol tip** | `1ce409c` — Phase 12 VAB warnings + group ops |
| **Grok era tag** | `dd481a7` — Phases 8–11 + rails + surface stick |

### Remotes

| Remote | URL | Role |
|--------|-----|------|
| **`origin`** | https://github.com/omerbakalovic/orbit-simulator.git | Dad / Sol push target |
| **`grok-era`** | https://github.com/lowcomplex-mint/orbi-sim-grok-era.git | Public Grok-era mirror (may lag) |

```bash
cd /home/hasan/.grok/worktrees/hasan-orbit-simulator/orbit-simulator
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
```

Dev: `npm run dev` → http://localhost:5173/

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
```

**Planning docs:** `phase planning/phase-10-11-plan.md`, `phase-11-pivot-rules.md`, `next-phase-ideas.md`.

---

## 3. What works (by layer)

### Flight / physics (`npm run sim`)

- Fixed-timestep gravity, two-body orbit math, stock ascent → orbit.
- Graph staging, radial boosters, parallel debris, engine plates.
- Attitude (CoM torque, SAS); reentry heating; saves; career; vehicle analysis.
- **Landing legs:** stowed / deployed / broken; foot contact; stick-to-surface rest.
- **Launch clamps (KSP-cheaty):** infinite hold — engines burn, vessel cannot move
  until clamp stage fires; clamp debris stays on pad.
- **Recovery sim:** parachutes, clamps, electricity, full mission path.
- **Rails:** bound elliptic vacuum arcs (incl. suborbital); auto-drop atmosphere + SOI.

### Attachment / graph (`npm run test:graph`)

- Explicit edges (`stack` / `radial`); tree from edges + root; disconnect detection.
- **Surface edges:** flush hull contact for `surfaceAttach` parts when no node mate.
- Detached-component forest (dup/subassembly remain movable until re-snapped).

### VAB (`npm run test:builder` / `test:rotate` / `testSymmetry` + browser)

| Feature | Behavior |
|---------|----------|
| **Surface attach** | Legs, battery, solar, clamps snap flush on tank/pod/engine flanks (not node-only) |
| **SYM** | Re-snaps twin (left↔right nodes); pickup/delete removes geometric twin |
| **Rotate v2** | Mount joint pivot; stack 90°; radial uses Rot step; Q/E ↺/↻ |
| **Subassemblies** | SUB+ / SUB… / selection SUB; localStorage library |
| **Select / group** | Marquee, DUP/DEL, Ctrl+D, rigid multi-subtree move |
| **BUILD CHECKS** | Advisory: no control, crewed return without chute, legs off flank |
| **Clamps (context)** | Tower height 2–12 cells; umbilical length 1–8 cells; release stage |

---

## 4. Partial / not started

| Status | Item |
|--------|------|
| Partial | Electricity only; maneuver nodes data-only |
| Partial | Map: single-body conic |
| Partial | Legs: no deploy animation / suspension / tip-over |
| Partial | Surface attach: lateral L/R flanks (not free-form top/bottom) |
| Partial | Subassembly library: localStorage only |
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
| Watch | Recovery legs often “broken” on chute land | Survive asserted |
| By design | Dup / subassembly starts detached | Snap on for launch-valid craft |

---

## 6. Regression commands

```bash
cd /home/hasan/.grok/worktrees/hasan-orbit-simulator/orbit-simulator
npm run build && npm run sim && npm run test:graph && npm run test:builder && npm run test:rotate
npx tsx scripts/testSymmetry.ts
```

| Touch… | Run… |
|--------|------|
| Graph, group, rotate, subassembly, SYM, surface | graph + builder + rotate + testSymmetry |
| Staging, rails, landing, clamps | `sim` |
| Saves | optional fields + `sim` |

---

## 7. Key file map

| Path | Role |
|------|------|
| `src/vehicle/SurfaceAttach.ts` | Surface attach rules + flush detection |
| `src/builder/SurfaceAttach.ts` | VAB surface snap candidates |
| `src/builder/Symmetry.ts` | SYM twin re-snap + twin find |
| `src/builder/RotateOps.ts` | Rotate v2 pivots |
| `src/builder/Subassembly.ts` | Subassembly extract/place/library |
| `src/builder/GroupOps.ts` / `SelectionBox.ts` / `DesignWarnings.ts` | Phase 12 |
| `src/vehicle/PartGraph.ts` | Edges (node + surface), tree, validation |
| `src/vehicle/LandingLegs.ts` | LT-2 geometry |
| `src/physics/GroundContact.ts` | Foot contact, stick-to-surface |
| `src/physics/RocketPhysics.ts` | Integration, clamps pin, landing |
| `src/config/parts.ts` | Catalog (`surfaceAttach`, clamp defaults) |
| `scripts/simAscent.ts` | Physics/recovery regression |
| `scripts/testPartGraph.ts` / `testBuilder.ts` / `testRotate.ts` / `testSymmetry.ts` | Headless suites |

---

## 8. Recommended next work

1. Commit + push current worktree to omerbakalovic / grok-era.  
2. Subassembly UI polish (named list, file export).  
3. Hyperbolic rails / patched-conic map.  
4. Leg deploy animation / tip-over.

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

- `stackCoreCenterXCells()` in `LandingLegs.ts` — average core stack only (exclude
  legs/clamps/utility/parachute). Used by VAB redraw, flight stack display, and
  ground contact so left/right struts point outward with clamps on the pad.

### Scripts

```
sim, test:graph, test:builder, test:rotate, scripts/testSymmetry.ts
```

---

# Sol / Codex additions (Phase 12 — `1ce409c`)

Select tool, group move/dup/delete, BUILD CHECKS, detached-tree graph hardening,
`test:builder`, mobile VAB polish. See Sol’s original notes in git history of
root `HANDOFF.md` if needed; content is folded into §3 above.

---

## 9. One-line briefing

> Orbit sim is past **Phase 13** with **surface attach**, **cheaty adjustable clamps**, **reliable SYM**, and **correct leg outward signs**. Gates: `build`, `sim`, `test:graph`, `test:builder`, `test:rotate`, `testSymmetry`. Master doc: this file.
