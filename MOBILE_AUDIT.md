# Phase A — Mobile touch audit

**Date:** 2026-07-25 (audit); layout/palette follow-ups through 2026-07-30  
**Shipped in:** **v0.2.0**  
**Scope:** Phase A inventory. Phase B + partial layout C closed many rows (see §6).  
**Code tip:** Phase 13 + surface attach + clamps + SYM + Phase 14 mobile UI.  
**Docs read:** master Handoff.md, ARCHITECTURE.md, README.md, CURRENT_STATUS.md, phase-14 plan.

---

## Method

| Field | Value |
|-------|--------|
| **Device used** | **None (code-path audit).** No real phone and no Chrome DevTools device-emulation session in this pass. |
| **How status was decided** | Walked every README controls-table row and Handoff §3 VAB feature against pointer/keyboard/DOM listeners in source. |
| **Confidence** | **High** for “no touch path” and “has on-screen control” (deterministic wiring). **Medium** for “works” on DOM buttons (inferred from `click` / `pointer` + existing mobile CSS; not finger-tested). |
| **Dev server** | Vite metadata suggested `http://localhost:5173/`; this environment could not HTTP-confirm a live session. |

Interactive DevTools or a LAN phone pass should re-check rows marked `works` before treating Phase A as hardware-signed-off. **Do not start Phase B until Hasan/Claude review this list** (per the phase plan).

### Status legend

| Status | Meaning |
|--------|---------|
| **works** | Touch/pointer path exists and should function with normal mobile browsers (code-level). |
| **broken** | Path exists but is unusable or self-defeating under touch (e.g. long-press aspirational but pickup steals the gesture). |
| **no touch path** | Keyboard, right-click, or wheel only; no on-screen / pointer equivalent. |
| **partial** | Reachable on touch but poor UX or incomplete coverage. |

### Layering (ARCHITECTURE.md)

| Layer | Role |
|-------|------|
| `ui/` | DOM overlays (HUD, buttons helpers, pause, log, debug). |
| `builder/` / `flight/` / `center/` | Scene logic + scene-local DOM. |
| `render/` | Pixi only; no DOM. |
| `app/` | Scene routing, global keys, save orchestration. |
| `index.html` / `style.css` | Viewport, touch-action, safe-area, layout. |

---

## 1. Flight / global — README controls table

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| Throttle slider (drag) | works | `input type=range`, `touch-action: none` | `src/flight/FlightScene.ts`, `src/style.css` |
| W/S · Z/X throttle keys | no touch path | Slider covers the action | `src/flight/FlightControls.ts` |
| ⟲ ⟳ on-screen rotate | works | `createHoldButton` + `touchRotate` | `src/ui/Buttons.ts`, `src/flight/FlightScene.ts`, `src/flight/FlightControls.ts` |
| A/D rotate keys | no touch path | Buttons cover | `src/flight/FlightControls.ts` |
| STAGE button | works | | `src/flight/FlightScene.ts` |
| Space (stage) | no touch path | Button covers | `src/flight/FlightControls.ts` |
| SAS button (cycle modes) | works | | `src/flight/FlightScene.ts` |
| G (SAS) | no touch path | Button covers | `src/flight/FlightControls.ts` |
| MAP button | works | | `src/flight/FlightScene.ts` |
| M (map) | no touch path | Button covers | `src/flight/FlightControls.ts` |
| Map pan (drag) | works | pointer listeners when map enabled | `src/flight/MapCameraController.ts` |
| Map pinch zoom | works | two-finger distance | `src/flight/MapCameraController.ts` |
| Map wheel zoom | no touch path | Pinch covers map | `src/flight/FlightScene.ts` (`onWheel`) |
| Flight vessel-view zoom | no touch path | Wheel only; camera follows vessel; no pinch in non-map flight | `src/flight/FlightScene.ts` |
| FOLLOW / CENTER (map) | works | Shown only in map mode | `src/flight/FlightScene.ts`, `src/flight/MapCameraController.ts` |
| ◄◄ ►► time warp | works | | `src/flight/FlightScene.ts` |
| , / . warp keys | no touch path | Buttons cover | `src/flight/FlightControls.ts` |
| 🪂 arm parachutes | works | | `src/flight/FlightScene.ts` |
| LEGS button | works | | `src/flight/FlightScene.ts` |
| L (flight = legs) | no touch path | Button covers | `src/flight/FlightControls.ts` |
| L (non-flight = LOG) | no touch path | LOG button covers | `src/app/GameApp.ts`, `src/ui/DebugLog.ts` |
| ⏸ pause button | works | | `src/flight/FlightScene.ts` |
| Esc pause | no touch path | Button covers | `src/flight/FlightControls.ts` |
| Pause menu: Resume / QS / QL / reverts / KSC / Tracking | works | DOM buttons | `src/ui/PauseMenu.ts` |
| F5 quicksave / F9 quickload | no touch path | Pause menu has Quicksave/Quickload | `src/app/GameApp.ts` |
| F3 debug overlay | no touch path | Dev-only | `src/app/GameApp.ts`, `src/ui/DebugOverlay.ts` |
| LOG button | works | Global UI | `src/ui/DebugLog.ts` |
| R reset / revert to launch | no touch path | Pause “Revert to Launch” covers | `src/flight/FlightControls.ts`, `src/ui/PauseMenu.ts` |

---

## 2. VAB — README controls + Handoff §3 features

### 2a. Placement, camera, tools

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| Drag from palette to place | works | `pointerdown` on part card | `src/builder/PartPalette.ts`, `src/builder/BuilderScene.ts` |
| Procedural W/H on **palette** (before place) | works | W±/H± steppers stop propagation so they don’t start drag | `src/builder/PartPalette.ts` |
| Drag empty canvas → pan | works | `panPointers` on left-button / touch | `src/builder/BuilderScene.ts` |
| Pinch zoom (empty / multi-touch pan set) | works | Same approach as map camera (TODO unify in plan) | `src/builder/BuilderScene.ts` |
| Wheel zoom | no touch path | Pinch covers VAB | `src/builder/BuilderScene.ts` |
| Undo button ↶ | works | Already on toolbar | `src/builder/BuilderScene.ts` |
| Redo button ↷ | works | Already on toolbar | `src/builder/BuilderScene.ts` |
| Ctrl+Z / Ctrl+Y | no touch path | Buttons cover | `src/builder/BuilderScene.ts` |
| Select tool | works | Explicit touch-friendly tool | `src/builder/BuilderScene.ts` |
| Marquee box-select (Select + drag empty) | works | `boxSelection` + pointer capture | `src/builder/BuilderScene.ts`, `src/builder/SelectionBox.ts` |
| Shift+drag marquee / Shift+click toggle | no touch path | Select tool covers | `src/builder/BuilderScene.ts` |
| Move tool + drag single subtree | works | `transformDrag` | `src/builder/BuilderScene.ts`, graph helpers |
| Move tool + drag multi-selection group | works | `groupDrag` + `GroupOps` | `src/builder/BuilderScene.ts`, `src/builder/GroupOps.ts` |
| Rotate tool (tap to select part) | works | | `src/builder/BuilderScene.ts` |
| ↺ / ↻ rotate buttons | works | Joint pivot via `RotateOps` | `src/builder/BuilderScene.ts`, `src/builder/RotateOps.ts` |
| Rot step UI (− / + / select) | works | | `src/builder/RotateControls.ts` |
| Q / E rotate keys | no touch path | Buttons cover | `src/builder/BuilderScene.ts` |
| Root tool (tap part) | works | | `src/builder/BuilderScene.ts` |
| SYM toggle | works | | `src/builder/BuilderScene.ts`, `src/builder/Symmetry.ts` |
| DUP (selection toolbar) | works | Shown when selection non-empty | `src/builder/BuilderScene.ts` |
| DEL (selection toolbar) | works | | `src/builder/BuilderScene.ts` |
| Ctrl+D / Delete keys | no touch path | DUP/DEL cover | `src/builder/BuilderScene.ts` |
| Snap step UI | works | | `src/builder/SnapControls.ts` |
| FIT / Clear / Default / Save / Load / LAUNCH | works | | `src/builder/BuilderScene.ts` |
| ◄ KSC | works | | `src/builder/BuilderScene.ts` |

### 2b. Phase 13 + post-12 features (Handoff §3)

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| Rotate v2 (stack 90° / radial Rot step / mount joint) | works | Logic is pointer-agnostic; UI is Rotate tool + ↺/↻ | `src/builder/RotateOps.ts`, `src/builder/BuilderScene.ts` |
| Surface attach snap (legs, battery, solar, clamps) | works | Same drag/snap path as node attach | `src/builder/SurfaceAttach.ts`, `src/vehicle/SurfaceAttach.ts`, `src/builder/SnapSystem.ts` |
| SYM twin re-snap + twin removed on pickup/delete | works | On place drag and remove paths | `src/builder/Symmetry.ts`, `src/builder/BuilderScene.ts` |
| SUB+ save selection as subassembly | partial | Button works; name via `window.prompt` (awkward on mobile, may be blocked in some webviews) | `src/builder/BuilderScene.ts`, `src/builder/Subassembly.ts` |
| SUB… place from library | partial | Button works; pick/delete via `window.prompt` numbered list | `src/builder/BuilderScene.ts`, `src/builder/Subassembly.ts` |
| Selection SUB | partial | Same as SUB+ | `src/builder/BuilderScene.ts` |
| Clamp overhaul (tower height 2–12, umbilical 1–8, release stage) | no touch path | Settings only in context menu | `src/builder/PartContextMenu.ts`, `src/builder/BuilderScene.ts` |
| Select / group / BUILD CHECKS (Phase 12) | works | Select + engineer panel advisories | `src/builder/BuilderScene.ts`, `src/builder/DesignWarnings.ts`, `src/builder/EditorEngineeringPanel.ts` |

### 2c. Right-click context menus (priority audit item)

`PartContextMenu` file comment claims “Right-click (or long-press)”. **Long-press is not implemented.** Menu opens only from canvas `contextmenu` (`BuilderScene.onContextMenu`). Place-tool `pointerdown` on a part (button 0 / touch) **immediately removes the part and starts a drag**; if a browser later fires `contextmenu`, `if (this.drag) return` blocks the menu.

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| Open context menu (general) | broken / no touch path | Desktop right-click works; touch has no long-press or ⋯ affordance; browser long-press fights Place pickup | `src/builder/BuilderScene.ts`, `src/builder/PartContextMenu.ts` |
| Chute type / diameter / material / deploy altitude | no touch path | Only inside context menu | `src/builder/PartContextMenu.ts` |
| Engine thrust limiter | no touch path | | `src/builder/PartContextMenu.ts` |
| Engine / clamp ignition stage | no touch path | Staging panel is preview-only; stage assignment is context | `src/builder/PartContextMenu.ts`, `src/builder/StagingPanel.ts` |
| Clamp tower height | no touch path | | `src/builder/PartContextMenu.ts` |
| Clamp umbilical length | no touch path | | `src/builder/PartContextMenu.ts` |
| Procedural dims on **placed** part | no touch path | Palette steppers only apply to the next drag from palette | `src/builder/PartContextMenu.ts`, `src/builder/PartPalette.ts` |
| Nose shape variants | no touch path | | `src/builder/PartContextMenu.ts` |
| Context “Remove part” | no touch path | Selection DEL covers multi/subtree remove after Select/Move | `src/builder/PartContextMenu.ts`, `src/builder/BuilderScene.ts` |

### 2d. Other VAB UI

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| STAGING panel expand/collapse | works | Defaults collapsed on `max-width: 720px` | `src/builder/StagingPanel.ts`, `src/style.css` |
| STAGING stage highlight (tap) | works | `click` toggles; `pointerenter` for hover | `src/builder/StagingPanel.ts` |
| Engineer / BUILD CHECKS panel | works | DOM | `src/builder/EditorEngineeringPanel.ts`, `src/builder/DesignWarnings.ts` |
| Hint bar (tool help text) | partial | Hidden under `max-width: 720px` | `src/style.css`, `src/builder/BuilderScene.ts` |
| Toolbar density on phone | partial | Horizontal scroll toolbars; many buttons; overcrowding risk | `src/style.css` (`.toolbar-top` etc.) |

---

## 3. Space Center / Tracking Station

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| KSC menu buttons (VAB, launch, tracking, saves, settings) | works | DOM `click` | `src/center/SpaceCenterScene.ts` |
| Tracking Station list / fly / delete | works | DOM | `src/center/TrackingStationScene.ts` |
| Confirm dialogs | works | | `src/ui/ConfirmDialog.ts` |

---

## 4. Platform / page chrome

| Item | Status | Notes | Owner file(s) |
|------|--------|-------|----------------|
| Viewport meta (`width=device-width`, `user-scalable=no`, `viewport-fit=cover`) | works | Already present | `index.html` |
| `theme-color` | works | | `index.html` |
| Canvas `touch-action: none` | works | Suppresses browser pan/zoom on canvas | `src/style.css` |
| Buttons `touch-action: manipulation`, min ~48px height | works | Touch-first UI helpers | `src/style.css`, `src/ui/Buttons.ts` |
| `safe-area-inset-*` on HUD / bars / toolbars | works (partial) | Applied in several places; full notch QA still Phase C | `src/style.css` |
| Mobile VAB layout (`max-width: 720px` bottom palette) | works | Phase 12 “mobile VAB polish” | `src/style.css` |
| PWA `manifest.json` / service worker | no touch path / not started | No installability | (none) |
| Centralized gesture disambiguation module | no touch path / not started | Logic split: `BuilderScene` pan/pinch vs `MapCameraController` | `src/builder/BuilderScene.ts`, `src/flight/MapCameraController.ts` |

---

## 5. Gesture stress (code expectation — not live-probed)

| Experiment | Expected outcome under current code | Status |
|------------|-------------------------------------|--------|
| Start drag on **placed** part (Place tool) | Immediate pickup: part removed from design, ghost drag starts | works (by design); **collides with any long-press intent** |
| Start drag on **empty** canvas | Single finger pans; two fingers pinch-zoom | works |
| Pinch-zoom **mid** part-drag | While `this.drag` is set, further `pointerdown` on canvas is ignored; pinch does not engage | partial / broken for multi-gesture |
| Long-press on part for settings | No timer; becomes pickup+drag; `contextmenu` ignored if `this.drag` | broken / no touch path |
| Marquee with Select tool | Empty drag builds box; release commits AABB selection | works |
| Tap part in Select tool | Toggle membership in selection | works |
| Pinch mid marquee / group drag | Separate pointer IDs; second finger not designed into marquee — risk of messy state | untested / risk |

---

## 6. Gap summary

### Closed in Phase B (2026-07-25)

1. **Part context-menu settings** — long-press (touch place tool), selection **Edit**, mobile bottom-sheet `.ctx-menu`; right-click unchanged.
2. **Subassembly save/place** — `showTextPrompt` / `showListPicker` in `src/ui/ModalForms.ts` (no `window.prompt`).
3. **Flight vessel-view zoom** — two-finger pinch on `FlightScene` when not in map mode.

### Still open (Phase C+)

4. **Gesture priority** — still split across scenes; pinch mid part-drag still ignored; document/unify in Phase C.
5. **Toolbar / panel density** on ~360px width — layout partial; Phase C.
6. **PWA** — not started (stretch Phase E).
7. **F3 debug** — no touch path (dev-only, low priority).

### Explicit non-gaps (plan §0 was wrong or overstated)

| Claim in plan (docs-only) | Audit result |
|---------------------------|--------------|
| Undo/Redo has no on-screen button | **False** — ↶ / ↷ already exist |
| Viewport / touch-action / safe-area absent | **False** — present in `index.html` + `style.css` |
| Phase 13 has no touch UI at all | **Overstated** — Rotate + SUB buttons exist; surface attach uses normal drag; **settings** for clamps etc. remain context-only |

---

## 7. Anticipated file map (confirmed)

| Area | Path |
|------|------|
| Context menu UI + future long-press / bottom sheet | `src/builder/PartContextMenu.ts`, open site in `src/builder/BuilderScene.ts`; new chrome in `src/ui/` if modalized |
| Undo/redo | Already wired in `src/builder/BuilderScene.ts` (no new stack needed) |
| Subassembly prompts | `src/builder/BuilderScene.ts` + `src/builder/Subassembly.ts` |
| VAB gestures | `src/builder/BuilderScene.ts` |
| Map gestures | `src/flight/MapCameraController.ts` |
| Flight control bar | `src/flight/FlightScene.ts`, `src/ui/Buttons.ts` |
| Page viewport / touch CSS | `index.html`, `src/style.css` |
| PWA (later) | new `public/manifest.json`, `index.html` link |

---

## One-line briefing

> Most flight and VAB chrome already has touch buttons (including undo/redo); the hard mobile gaps are **context-menu part settings (zero working touch path)**, **subassembly `prompt` UX**, **flight zoom without map**, and **undefined multi-gesture priority** — not a greenfield control set.
