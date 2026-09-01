# Phase 14 — Mobile Port Plan

**Status:** Phase A–C complete (gesture-priority module, landscape, PWA
stretch). Shipped in **v0.2.1**. **On-device QA 2026-08-29** (25069PTEBG):
gestures accepted; flight chrome **pinned** (better, not signed off). Phase D
(performance profile) still open. Do not iterate HUD/navball/throttle without
a Hasan mockup.
**Audience:** Grok (executor), Hasan (owner), Claude (planner/reviewer)
**Depends on:** Phase 13 tip (surface attach + clamp overhaul + SYM fixes), per Handoff.md

---

## 0. Ground truth — what this project already has

> **Phase A updated (2026-07-25):** §0 below was originally written from docs
> alone. It is now corrected against a code-path audit. Full row-by-row
> inventory: repo root `MOBILE_AUDIT.md`. That audit was **not** a live phone
> or Chrome DevTools session — re-check “works” rows on hardware before
> treating Phase A as finger-signed-off.

This is **not** a from-scratch touch-control build. Per README.md's controls
table, Phase 12 "mobile VAB polish," and Phase A source inspection, the
following already exist as on-screen UI (not just keyboard bindings):

| Action | On-screen UI (confirmed in code) |
|---|---|
| Throttle | Slider (touch-draggable) |
| Rotate (A/D) | ⟲ ⟳ hold buttons (`createHoldButton`) |
| Stage | STAGE button |
| Legs | LEGS button |
| SAS | SAS button (cycles modes) |
| Map | MAP button (+ FOLLOW / CENTER in map mode) |
| Map pan / pinch | `MapCameraController` pointer + two-finger zoom |
| Time warp | ◄◄ ►► arrows |
| Pause | ⏸ button (menu has quicksave/load; F5/F9 are shortcuts only) |
| Arm parachutes | 🪂 button |
| Log panel | LOG button (`DebugLog`; `L` is a shortcut outside flight) |
| VAB multi-select | Select tool (alternative to Shift+drag) |
| VAB dup/delete | DUP/DEL selection toolbar |
| VAB mirror | SYM button |
| VAB undo/redo | **↶ / ↷ toolbar buttons** (Ctrl+Z/Y are shortcuts only) |
| VAB rotate | Rotate tool + ↺ / ↻ + Rot step control |
| VAB subassembly | SUB+ / SUB… / selection SUB buttons (see gaps for `prompt` UX) |
| VAB camera | Empty-canvas pan + pinch zoom; FIT button |
| Viewport / page zoom | `index.html` viewport meta (`user-scalable=no`, `viewport-fit=cover`); canvas `touch-action: none`; button `touch-action: manipulation`; partial `safe-area-inset-*` |

**Do not rebuild any of the above.** Phase B+ should wire missing affordances
only, and re-verify “works” rows on a real device or DevTools emulation.

### Confirmed gaps (Phase A code-path audit)

1. **Right-click context menus — no working touch path (confirmed).** Chute
   type/diameter/material/deploy altitude, engine thrust limiter/ignition
   stage, clamp tower height/umbilical, procedural dims on **placed** parts,
   nose shapes. Open only via canvas `contextmenu`. `PartContextMenu` comments
   mention “long-press” but **no long-press timer exists**. Place-tool
   `pointerdown` on a part immediately picks it up and starts a drag; if a
   browser later fires `contextmenu`, `if (this.drag) return` blocks the menu.
2. **Undo/Redo** — **not a gap for presence.** ↶/↷ already call the history
   stack. (Removed from the “missing button” list; keyboard shortcuts remain
   keyboard-only, which is fine.)
3. **Phase 13 after mobile polish — mixed.** Rotate v2 and surface-attach snap
   ride existing touch tools/drag. SUB+/SUB…/SUB buttons exist but library
   save/place uses **`window.prompt`** (partial / poor mobile UX). **Clamp
   overhaul settings** still live only in the context menu → same gap as (1).
4. **Debug overlay (`F3`)** — keyboard only, low priority. **LOG** has a
   button; `L` in flight is LEGS (button covers). No accidental touch
   collision for F3.
5. **Page-level viewport behavior** — **largely already present** (meta +
   `touch-action` + safe-area). Remaining Phase C work is layout density,
   notch QA, and any residual browser chrome (e.g. pull-to-refresh) not
   covered by current CSS. In-canvas pinch already exists in VAB + map;
   **flight vessel-view zoom is still wheel-only** (no pinch).
6. **PWA manifest / installability** — still absent; strong offline/PWA
   candidate, nothing built yet (stretch Phase E).
7. **No centralized gesture disambiguation** — pan vs part-drag vs marquee
   vs pinch vs (future) long-press still split across `BuilderScene` and
   `MapCameraController`. Place pickup has no long-press window; pinch mid
   part-drag is ignored while `this.drag` is set.

### Explicit non-goals for this phase

- No new gameplay features.
- No native app wrapper (Capacitor/Cordova/etc.) unless Hasan asks for one
  later — ship as a responsive, installable web app first.
- No App Store / Play Store submission work.
- No touch-simulated additions to the headless test suites — `sim`,
  `test:graph`, `test:builder`, `test:rotate`, `testSymmetry` stay
  pointer-agnostic logic tests. Touch UX is verified manually (see §3).

---

## 1. Objectives, ranked

1. **Playable end-to-end on a phone with zero keyboard/mouse** — VAB build →
   launch → orbit → land, fully touch-operable, portrait or landscape.
2. **Every desktop-only affordance (context menus, undo/redo) has a touch
   equivalent.**
3. **Responsive layout** across common phone viewport sizes, safe-area-aware
   (notches/home-indicator), no accidental page-zoom/pull-to-refresh.
4. **Acceptable performance** on a mid-range Android device.
5. *(Stretch)* Installable PWA.

---

## 2. Phase breakdown

### Phase A — Audit (no code changes)

- Build and load the current dev server on at least one real phone (Android
  Chrome primary; iOS Safari if available) over LAN, per README's existing
  instructions.
- Walk every item in README's controls table and every VAB feature in
  Handoff.md §3 on that device. Mark: works / broken / no touch path exists.
- Specifically test the Phase 13 features (Rotate v2, Subassembly
  save/place, Surface attach snapping, clamp context menu) under touch.
- Try to trigger the 5 gesture types listed in §0.7 in sequence and note any
  collisions (e.g., does starting a drag on a placed part ever get
  interpreted as a camera pan, or vice versa?).
- **Deliverable:** `MOBILE_AUDIT.md` — a gap list, one row per broken/missing
  item, each tagged with the file(s) likely responsible (per
  ARCHITECTURE.md's layering: `ui/` = DOM overlays, `builder/` /
  `flight/` = scene logic, `render/` = Pixi views only).
- **Gate:** none (this is investigation) — but **stop and hand the gap list
  back before starting Phase B.** The rest of this plan may need reordering
  once real gaps are known.

### Phase B — Context menus & missing controls

- Give every part-settings action currently reachable only via right-click a
  touch path: long-press to open, or a persistent "⋯" button on the selected
  part, opening the same settings as a bottom sheet/modal (DOM, in `ui/`,
  per the existing rule that nothing below `render/` touches the DOM).
- Add Undo/Redo buttons to the VAB toolbar (wire to existing undo/redo stack
  — `BuilderScene.designChanged()` already drives it, per ARCHITECTURE.md,
  so this should be UI-only, no new state logic).
- Confirm Rotate v2, Subassembly UI, and Surface-attach snapping are
  reachable and usable via touch; patch whatever Phase A flagged.
- **Gate:** `test:builder`, `test:rotate`, `npx tsx scripts/testSymmetry.ts`
  (these must still pass — this phase should be additive UI, not logic
  changes) + manual re-check of the specific items fixed.

### Phase C — Gesture & layout conflicts

**Done in v0.2.1.**

- Explicit gesture priority lives in `src/ui/CanvasGestures.ts` (module
  docstring). VAB, map, and flight vessel-view all use `PointerTracker`.
  Two-finger pinch preempts pan / marquee / long-press / group-move; a live
  part-placement ghost is kept and the camera zooms under it.
- Phone layout applies at `max-width: 720px` **or** `max-height: 500px` so
  landscape phones (often >720px wide) get the compact chrome. Extra
  short-landscape rules shrink HUD chips, tray, and navball.
- `overscroll-behavior: none` on `html, body`; existing viewport meta +
  canvas `touch-action: none` + safe-area insets kept.
- Flight ENGINEER panel: drag header to reposition, tap to collapse.
- **Gate:** `npm run test:gestures` (tracker math) + `build`; live device QA
  is the `MOBILE_QA_CHECKLIST.md` sheet (no headless touch driver).

### Phase D — Performance

- Profile Pixi render + physics loop on a mid-tier Android device (frame
  time breakdown: render vs. physics vs. GC).
- Check texture atlas sizes, effect layers (thermal glow, parachute canopy,
  exhaust) aren't costing disproportionate GPU time on mobile.
- Confirm PixiJS v8's WebGL fallback works correctly where WebGPU isn't
  available (older iOS Safari in particular).
- **Deliverable:** a short frame-budget note appended to `CURRENT_STATUS.md`.
- **Gate:** `npm run sim` must be unaffected (it's headless/physics-only, no
  rendering) — this phase should not touch physics/, only render/.

### Phase E — PWA / installability (stretch)

**Done in v0.2.1 (basic installability).**

- `public/manifest.json`, 192/512 icons, apple-touch-icon, `theme-color`,
  standalone display.
- Production-only service worker (`public/sw.js`) caches same-origin GETs.
- **Gate:** none automated; Lighthouse PWA check still a manual follow-up.

### Phase F — Regression & docs

- Update README's controls table to mark which actions have on-screen
  touch equivalents (most already do — just make it explicit).
- Update `CURRENT_STATUS.md` and the master `Handoff.md` with the new phase.
- Full gate re-run: `build`, `sim`, `test:graph`, `test:builder`,
  `test:rotate`, `testSymmetry` + a manual mobile QA pass.

---

## 3. Manual QA checklist (no headless equivalent exists for touch)

Recommend Grok create and maintain `MOBILE_QA_CHECKLIST.md` — one row per
control/feature, columns for each test device, checked off phase by phase.
This is necessary because none of the existing test scripts simulate touch
input; touch UX can only be verified manually on real hardware or Chrome
DevTools device emulation (device emulation is a reasonable stand-in for
Phases B/C, but final sign-off should be on a real phone).

---

## 4. Risks / watch items

| Risk | Why it matters |
|---|---|
| Gesture collisions (pan vs. drag-part vs. marquee vs. pinch vs. long-press) | Highest-risk UX area — five gestures sharing one canvas |
| Context-menu-heavy parts (clamps, chutes, engines) | Per §0, these have zero documented touch path today |
| WebGPU/WebGL fallback on older iOS Safari | Pixi v8 defaults matter here; untested per docs |
| New DOM overlay layers (bottom sheets, virtual buttons) | Must stay in `ui/`, per ARCHITECTURE.md's "nothing below render/ imports DOM" rule |
| Phase 13 features are the newest and least mobile-tested code in the repo | Confirm before assuming they're touch-ready |

---

## 5. Anticipated file map (confirm/correct during Phase A)

| Area | Path |
|---|---|
| DOM overlays, new bottom sheets, undo/redo buttons | `src/ui/` |
| Gesture/input handling | wherever current pointer/touch listeners live — audit in Phase A |
| VAB touch interactions | `src/builder/` |
| Flight-scene touch controls | `src/flight/` |
| Camera pan/zoom/pinch | `src/render/CameraController.ts` |
| Viewport meta / PWA manifest | `index.html`, new `public/manifest.json` |

---

## 6. Recommended order of operations for Grok

1. **Phase A only, first.** Produce `MOBILE_AUDIT.md`. Do not write
   implementation code yet — the gap list may reorder Phases B–F.
2. Hand the audit back to Hasan/Claude for a quick review pass before
   starting Phase B.
3. Proceed phase by phase, respecting each phase's gate before moving on.
4. Keep this plan doc updated in place (mirroring how `Handoff.md` tracks
   phase history) rather than creating a parallel status doc.

---

## One-line briefing

> Phase A–C + PWA stretch shipped in v0.2.1. Phone QA: gestures OK, flight
> chrome pinned. Remaining Phase 14 work is D (frame budget). Chrome layout
> waits on a Hasan mockup. See `MOBILE_AUDIT.md` and `MOBILE_QA_CHECKLIST.md`.
