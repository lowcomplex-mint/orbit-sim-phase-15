# Current Status

**Version:** 0.2.0  
Snapshot for handoff. Validated: `npm run build`, `npm run sim`,
`npm run test:graph`, `npm run test:builder`, `npm run test:rotate`, and
`npx tsx scripts/testSymmetry.ts` all pass.

Phases landed: MVP → persistent world → radial attachment → sandbox systems →
recovery loop → **Phase 7 fractional VAB grid** → **Phase 8 deployable legs** →
**Phase 9 tree/Move/Root scaffolding** → **Phase 10 recovery sim suite** →
**Phase 11 node/attachment graph** → **Phase 12 VAB warnings + group ops** →
**Phase 13 Rotate v2 + subassemblies** → **surface attach + clamp overhaul + SYM fixes**
→ **leg outward-sign core-column fix** → **Phase 14 A–B mobile port (partial C layout)**.

Master handoff: `/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md`
(repo mirror: `documents/Grok additions/Handoff.md`).

---

## ✅ Works and is regression-tested

### `npm run sim`

- Flight core, staging, attitude, heating, saves, career, analysis.
- Time warp: physics + rails for bound vacuum arcs (incl. suborbital); atm/SOI drop.
- Landing/recovery: legs, stick-to-surface rest (no pad skate), chutes, electricity,
  full recovery mission.
- **Launch clamps:** KSP-cheaty infinite hold until stage release; debris clamp left
  on pad. Sim covers pin / stage-2 release / liftoff.

### `npm run test:graph`

- Attachment graph edges (node + surface), trees, reroot, move, mirror helpers,
  disconnect + detached forest.

### `npm run test:builder`

- Select marquee, group move/dup/delete, live BUILD CHECKS advisories.

### `npm run test:rotate` (Phase 13)

- Stack/radial pivot resolution; 90° stack quantization; joint preserved after spin.
- Center-based rigid rotate; rotationDeg survives graph sync.
- Subassembly extract / place.

### `scripts/testSymmetry.ts`

- SYM origin math, radial leg twin attaches with two radial edges, centerline identity.

## ✅ Works in VAB (browser)

- **Surface attach (KSP-style):** legs, batteries, solar, clamps snap flush to host
  hull sides without requiring a node pair (`surfaceAttach` + hull flush graph edges).
- **Landing strut art:** left/right outward sign uses **core stack center** (tanks/
  engines/pods), not the bottom-most part — so pad clamps no longer flip both legs
  the same way in VAB or flight.
- **Launch clamps:** surface attach; right-click / long-press / **Edit** for tower
  height (2–12) and umbilical (1–8); infinite pad hold until staged.
- **SYM:** re-snaps twin via mirrored nodes (left↔right); picking up / deleting a
  part also removes its geometric twin; ghost preview matches drop logic.
- **Rotate v2:** Q/E, ↺/↻; stack → 90°; radial → Rot step.
- **Subassemblies:** SUB+ / SUB… / selection SUB (localStorage; DOM modals, not
  `window.prompt`).
- Select, Move, Root, Place, Snap, CoM, staging, BUILD CHECKS.

## ✅ Phase 14 mobile (0.2.0)

| Piece | Status |
|-------|--------|
| **A — Audit** | `MOBILE_AUDIT.md` (code-path + phone follow-up) |
| **B — Touch controls** | Long-press + selection **Edit** for part settings; mobile bottom-sheet context menu; subassembly DOM modals; flight vessel-view pinch zoom |
| **Layout (partial C)** | Scrollable VAB toolbars; compact ENGINEER/STAGING chips (capped expand); bottom part tray; palette **scroll vs drag** disambiguation |
| **Plan** | `phase planning/phase-14-mobile-port-plan.md` |

Still open for later Phase 14: full gesture-priority module, denser landscape QA, PWA (stretch).

## 🟡 Partial / stubbed

- Resources (electricity only); maneuver nodes data-only.
- Map: single-body conic.
- Legs: no deploy animation / suspension / tip-over.
- Subassemblies: localStorage only (no file export).
- Rotate collision excludes mount parent (node-coincidence style).
- Surface attach: lateral (L/R) flanks only; not full free-form on top/bottom.
- Mobile: gesture priority still split across scenes (Phase 14 C).

## ❌ Not started

- Hyperbolic rails; patched-conic map; RCS/docking; fairings; tutorial; audio.
- Tracking Station rename/filter; subassembly file I/O polish; PWA.

## ⚠️ Gates

| Change | Run |
|--------|-----|
| Graph / group / rotate / subassembly / SYM / surface | `test:graph` + `test:builder` + `test:rotate` (+ `testSymmetry`) |
| Staging / rails / landing / clamps | `sim` |
| Saves | optional fields only + `sim` |
| Mobile UI only | manual phone / DevTools + `build` |

## Recommended next

1. Phase 14 C — unified gesture priority + landscape polish.
2. Hyperbolic rails / patched conics.
3. Leg deploy animation.
