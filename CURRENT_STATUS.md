# Current Status

**Version:** 0.2.1  
**Repo:** https://github.com/lowcomplex-mint/orbit-sim-phase-15  
**Code tip:** `0ff4ee0` (Phase 14 C + Phase 15 chrome). Docs snapshot 2026-09-06.  
**Agent brief:** `HANDOFF.md` (read that first; do not reconstruct status from the tree).

Validated: `npm run build`, `npm run sim`, `npm run test:graph`,
`npm run test:builder`, `npm run test:rotate`, `npm run test:gestures`,
and `npx tsx scripts/testSymmetry.ts` all pass.

Phases landed: MVP → persistent world → radial attachment → sandbox systems →
recovery loop → **Phase 7 fractional VAB grid** → **Phase 8 deployable legs** →
**Phase 9 tree/Move/Root scaffolding** → **Phase 10 recovery sim suite** →
**Phase 11 node/attachment graph** → **Phase 12 VAB warnings + group ops** →
**Phase 13 Rotate v2 + subassemblies** → **surface attach + clamp overhaul + SYM fixes**
→ **leg outward-sign core-column fix** → **Phase 14 A–C mobile port** →
**Phase 15 SFS chrome (finished and signed off 2026-09-01, committed in `0ff4ee0`)**.

Master handoff: `HANDOFF.md` (mirrors: `documents/Grok additions/Handoff.md`,
`/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md`).

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
- Phone bar: `◄ KSC`; no FIT button; SYM mirror glyph; LOG `☰` in-bar; Default kept.

## ✅ Phase 14 mobile (0.2.1)

Gestures, long-press settings, PWA files. See `MOBILE_AUDIT.md` (historical
audit) and `MOBILE_QA_CHECKLIST.md` (living sheet). Hasan signed gestures off
2026-08-29 on `25069PTEBG`.

## ✅ Phase 15 visual overhaul (finished 2026-09-01, in `0ff4ee0`)

Hasan signed off the UI on-device (`25069PTEBG`). **Chrome is frozen.**

| Piece | Status |
|-------|--------|
| Tokens | Black, square, hairline — `src/style.css` |
| Hub | Simplified list; no gradient; **Add to Home Screen** |
| VAB | `◄ KSC`; no FIT button; SYM glyph; divider; LOG `☰` in-bar |
| Flight HUD | Ap/Pe top-left; Alt/Vel top-right; **Flight ▾** extras |
| Dock | STAGE word; SAS caption; clock on warp |
| Throttle | Custom vertical slider above the dock; hit zone slider→right edge (same Y) |
| Map | FOLLOW/CENTER lower-left, map-only |
| PWA | Pass-through SW; hub install. Chrome **tab** still shows URL/nav bars |
| Plan | `phase planning/phase-15-visual-overhaul.md` (shipped — do not re-execute) |

## 🟡 Partial / stubbed

- Resources (electricity only); maneuver nodes data-only.
- Map: single-body conic (hyperbola *drawing* exists; no patched continuation).
- Legs: no deploy animation / suspension / tip-over.
- Subassemblies: localStorage only (no file export).
- Rotate collision excludes mount parent (node-coincidence style).
- Surface attach: lateral (L/R) flanks only; not full free-form on top/bottom.
- Mobile: Phase D frame-budget profile not yet run on hardware.
- Chrome-tab “empty rows” = browser chrome (URL bar + Android nav), not missing CSS.
- SOI: dominant body used for collision/atm/telemetry/rails capture; world frame
  is still Earth-origin. Moon is not a true primary yet.

## ❌ Not started

- **Hyperbolic / near-parabolic rails** (Phase 16a).
- **Patched-conic map** / `CelestialFrame` (Phase 16b–c).
- RCS/docking; fairings; tutorial; audio.
- Tracking Station rename/filter; subassembly file I/O polish; native APK.

## ⚠️ Gates

| Change | Run |
|--------|-----|
| Graph / group / rotate / subassembly / SYM / surface | `test:graph` + `test:builder` + `test:rotate` (+ `testSymmetry`) |
| Staging / rails / landing / clamps | `sim` |
| Saves | optional fields only + `sim` |
| Gesture tracker math | `test:gestures` |
| Mobile UI | `MOBILE_QA_CHECKLIST.md` + `build` |

## Recommended next

1. **Phase 16 — hyperbolic rails / patched-conic map** (see `HANDOFF.md` §7).
2. Leg deploy animation / tip-over.
3. Subassembly file export polish.
4. Phase 14 D — mobile frame-budget profile.

Do **not** restyle Phase 15 chrome. Push `grok-era`
(`lowcomplex-mint/orbit-sim-phase-15`), not `origin`.
