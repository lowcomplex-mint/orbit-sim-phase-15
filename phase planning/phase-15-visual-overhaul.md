# Phase 15 — Visual overhaul (SFS chrome)

**Status:** **Finished.** Hasan satisfied with the UI 2026-09-01 (25069PTEBG). Defaults used: Default stays on VAB bar; Resume shown disabled; dock is icons only (STAGE kept as a word).  
**Audience:** Grok (executor), Hasan (owner)  
**Depends on:** v0.2.1 Phase 14 C + 2026-08-29 phone QA (gestures accepted; chrome pinned)  
**Device truth:** `25069PTEBG`, 1280×2772 @ 3.25 → **~394×853 CSS**, notch **~47px**. All layout numbers below are for that viewport unless noted.

This is a **look-and-feel + chrome layout** phase. No gameplay, no physics, no map (Hasan is satisfied with the map).

---

## 0. Why this exists

Phase 14 made the game touch-operable and then guessed at a “compact HUD.” On-device that still felt like a vibe-coded overlay: rounded blue pills, a wrapped/clipped telemetry strip, LOG sitting on the VAB bar, a throttle floating in empty air, buttons whose labels fall off the control. Hasan’s 2026-08-29 pin is lifted **only** because this phase starts from a written spec, not more guessing.

Reference: **Spaceflight Simulator 1 mobile** — flat black panels, square corners, thin grey hairlines, icon buttons, vertical throttle parked next to the navball, telemetry as a dense strip not a card stack.

---

## 1. Visual language (do this first — one CSS token pass)

Replace the current “translucent navy + 10px radius + #3f74d6 accent” with a small token set. Every overlay (Space Center, VAB, flight, pause, context menu, log, engineer) consumes these. No leftover blue/rounded chrome.

```css
:root {
  --bg: #000000;
  --panel: #000000;
  --panel-2: #111111;
  --hairline: #2a2a2a;
  --text: #eeeeee;
  --muted: #888888;
  --danger: #c44;
  --radius: 0px;          /* sharp. no “soft UI”. */
  --accent: #ffffff;      /* active = white hairline or inverted, not blue */
}
```

Rules:

- `border-radius: 0` on `.btn`, panels, chips, sliders, navball **frame** (the ball itself stays a circle).
- Buttons: black fill, 1px `--hairline`, `--text`, no drop shadow. Active / `.btn.active` = white border or inverted (black on white). No `.btn.primary` blue.
- Body / `#app` / Space Center background: solid `#000`. Kill `.center-screen`’s `radial-gradient`.
- Type: keep system-ui. No new webfont.
- Safe-area: **paint chrome to the physical edge**; pad *content* with `env(safe-area-inset-*)`. The notch must not look like an empty gap above the UI — it is filled with the same black bar.

---

## 2. Hasan’s list → spec

Numbering matches the 2026-08-29 notes (no item 9).

| # | Complaint | Spec |
|---|-----------|------|
| 1 | Main menu: simplify, kill gradient | Flat black. Title + muted funds line. Buttons: VAB, Launch, Tracking, Resume (disabled if none), Saves, Settings. **Drop Mission Control** from the hub (it’s a disabled TODO and looks like filler). Full-width square rows, not oversized rounded “big” pills. |
| 2 | LOG overlaps VAB top row | The floating `#ui-root` LOG button is the bug. `--log-gutter` was a guess and lost. **Remove the global floating toggle.** Put a square `LOG` / `☰` control *inside* VAB row 1 (last item) and the flight HUD (last item). Same `DebugLog.toggle()`. |
| 3 | Empty space ~one row, VAB top and bottom | Top: that “row” is the 47px notch plus bar padding. Paint the toolbar from `top: 0`, pad *items* with `--safe-top`. Collapse `--vab-bar-h` to the button height (40px) with **0 extra vertical padding**. Bottom: palette `bottom: 0`; `padding-bottom: var(--safe-bottom)`; height tight to the cards (~96–110px), not `16dvh` of empty tray. |
| 4 | Divider after rotation angle | After `RotateControls` in the snap cluster, insert a 1px × 24px `--hairline` vertical rule (`.toolbar-rule`) before the file cluster (Clear/Default/Save/Load/LAUNCH). Same treatment between tool cluster and edit cluster if it still reads as one soup. |
| 5 | Flight numbers cut off | `.chip .value { overflow: hidden; text-overflow: ellipsis }` on a squeezed flex row. **No ellipsis.** One-line HUD: `12.4km` style values, `font-variant-numeric: tabular-nums`, shrink font before clipping. HUD height = `max(content, 28px) + safe-top` — never a 34px box that crops 12px type. |
| 6 | Empty space top and bottom of flight HUD | Same as VAB: HUD background from `y=0` through the notch; content baseline in the padded band; no 6px “floating” margin under the strip. |
| 7 | Bottom bar randomly cut off | Dock `padding-right` for the throttle rail is eating the last buttons, and `min-width: 44px` + long labels overflow. Icon dock, `overflow-x: auto` as fallback, and reserve `--throttle-w` without clipping the last control. |
| 8 | STAGE / LEGS / MAP labels off-center / overflowing | Icon-first, square 44×44 hit targets. Suggested glyphs: STAGE `▮` or `▣`, MAP `⦿`, LEGS `Π`, SAS stays `◎`, parachute stays `🪂`, pause `⏸`, warp `◄◄` `►►`, rotate `⟲` `⟳`. `title` keeps the word. If a word is kept, it must *fit* (`font-size: 11px`, `padding: 0`, flex center). |
| 10 | Navball angle overlapping markers | Pitch readout **centered** in the ball (`.nav-readout { inset: 0; display:grid; place-items:center }`). Markers stay on the rim. |
| 11 | Throttle too high | `.flight-side { justify-content: flex-end }`. Throttle **height ≈ navball size** (`--navball-size`, ~64–72px on this phone), not `min(240px, 36vh)`. Sit it on the same baseline as the navball, just above the dock. |
| 12 | Top bar ugly / out of place | HUD is a black strip with a 1px bottom hairline. No chip cards, no translucent navy, no rounded pill. Label 9px muted, value 12px white, `space-between` across the full width (LOG is in-bar, not a sibling overlay). |
| 13 | Map is fine | **Non-goal.** Do not restyle map camera chrome except tokens that fall out of §1 (FOLLOW/CENTER buttons pick up square black like everything else). |

### Extra from the same note (style, not numbered)

| Item | Spec |
|------|------|
| SYM ✗ / ✓ | Icon-only toggle. SFS-like **mirror glyph**: a 1px vertical axis with two small opposing ticks (inline SVG, 18×18). Off = muted hairline; on = `.active` white. `aria-label="Symmetry"`. No `SYM`, no checkmark. |
| FIT | `fitView()` still runs **on VAB enter**. The toolbar button is redundant with pinch/pan. **Remove FIT from the toolbar.** Do not add a new gesture this phase. |

---

## 3. Space Center (item 1)

Current: `ORBIT SPACE CENTER` + career line + 8 fat rounded buttons including a disabled Mission Control, on a blue radial gradient (`SpaceCenterScene.ts`, `.center-screen`).

Target:

```
ORBIT SIM
funds · science · rep          (one muted line)

[ VAB ]
[ Launch ]
[ Tracking ]
[ Resume ]     disabled + muted when no session
[ Saves ]
[ Settings ]
```

- No gradient, no “ORBIT SPACE CENTER” sci-fi letter-spacing parade — short title is enough.
- Settings / Saves stay as existing modals, restyled by tokens.
- Tracking Station list rows: square, black, hairline — same tokens, no extra invention.

---

## 4. VAB chrome

### Rows (phone, 394px)

**Row 1** (flush under/through notch):  
`◄` (KSC) · `↶` `↷` · Snap · Rot · **|** · Clear · Save · Load · **LAUNCH** · **LOG**

**Row 2:**  
Place · Select · Move · Rotate · Root · **|** · `↺` `↻` · [SYM svg] · SUB+ · SUB…

Drop FIT. Drop Default from the phone bar (still reachable via a confirm in Clear, or keep Default in the overflow — **prefer: keep Default**, it’s used; if the row overflows, it scrolls, clusters stay grouped).

### LOG

`DebugLog` currently injects `.log-toggle-btn` onto `#ui-root` (`src/ui/DebugLog.ts`). Phase 15:

- Stop auto-appending a floating button **or** `hidden` it when a scene is up.
- `BuilderScene` / `FlightScene` get a square control that calls the same toggle.
- Log **panel** itself: square, black, hairline; keep behavior.

### Empty space

| Gap | Cause in current CSS | Fix |
|-----|----------------------|-----|
| ~47px above VAB bars | `top: var(--safe-top)` on a bar that doesn’t paint the notch | `top: 0`; `padding-top: var(--safe-top)` on the first bar only |
| Slack inside `--vab-bar-h: 44px` | padding 2px + 40px buttons | height = button; padding 0 |
| Tall empty palette | `--palette-h: clamp(128px, 16dvh, 176px)` | height from card content; ~100px + safe-bottom |

---

## 5. Flight chrome

```
[████ HUD strip through notch ████ LOG]
          world
[ENGINEER]              [navball][thr]
[ ⟲ ⟳ ▣ ◎ ◄◄ ►► ⦿ 🪂 Π ⏸ ]   dock
```

- HUD: ALT VEL APO PER FUEL only on phone (aux already hidden). Values never ellipsis.
- Navball: `--navball-size: 72px` (readable, not a dinner plate). Pitch **center**. Heading chevron already tracks the nose (keep).
- Throttle: vertical, **same height as navball**, right edge, baseline-aligned with navball, 8px above dock. Readout is the number *on* the slider or a 11px label under it — not a third of the screen tall.
- Dock: icon square buttons, one row, left-aligned, may scroll; never clipped by the throttle rail (`padding-right: calc(var(--throttle-w) + 8px)` **and** `min-width` of the row includes that).
- ENGINEER: keep drag-to-move / tap-to-collapse; restyle to tokens (square, black). Default position under HUD, left.

---

## 6. Non-goals

- Map camera / FOLLOW / CENTER behavior (cosmetic token inheritance only).
- New gameplay, physics, PWA, performance profile.
- Replacing pinch/pan/long-press (Phase 14 C stays).
- FIT-as-gesture, Mission Control, contracts.

---

## 7. File map

| Area | Path |
|------|------|
| Tokens, buttons, HUD, dock, VAB bars, Space Center bg | `src/style.css` |
| Space Center structure | `src/center/SpaceCenterScene.ts` |
| VAB toolbar clusters, drop FIT, SYM svg, divider, in-bar LOG | `src/builder/BuilderScene.ts` |
| SYM button glyph helper | `src/ui/Buttons.ts` (or a 10-line `SymmetryIcon.ts` in `ui/`) |
| Floating LOG removal / scene-owned toggle | `src/ui/DebugLog.ts`, `src/app/GameApp.ts` if the button is constructed there |
| Flight dock icons, throttle size, HUD | `src/flight/FlightScene.ts`, `src/ui/Hud.ts`, `src/ui/Navball.ts` |
| Pause / dialogs inherit tokens | `src/ui/PauseMenu.ts` (markup only if class names need it) |

Physics, `scripts/simAscent.ts`, graph tests: **untouched**.

---

## 8. Build order (after Hasan says go)

1. **Tokens** — restyle `.btn`, panels, chips, Space Center. Everything should look square/black even if layout is still wrong.  
2. **Space Center** — simplify list, kill gradient.  
3. **LOG ownership** — no floating overlap.  
4. **VAB** — flush bars, divider, drop FIT, SYM icon, tighter palette.  
5. **Flight** — HUD strip, no ellipsis, centered pitch, short throttle, icon dock.  
6. **Phone walk** on 25069PTEBG. Iterate live. Do not “finish” from screenshots.

**Gate:** `npm run build` after each step. Full `sim` / graph / builder / rotate / gestures / symmetry once at the end (expect no diffs). Touch QA is the phone.

---

## 9. Open questions (Hasan)

Answer these if you care; otherwise the spec above is the default.

1. Keep **Default** on the VAB phone bar, or bury it behind Clear? **Default in plan: keep on the bar.**  
2. Resume button on Space Center: hide when no session, or show disabled? **Default: show disabled.**  
3. Dock: icons only, or icons + tiny captions under? **Default: icons only** (STAGE overflow is the bug).

---

## One-line briefing

> Phase 15 **shipped** (uncommitted): SFS-like sharp black chrome, mockup HUD, custom
> throttle with a right-edge hit zone. Hasan signed off 2026-09-01. Next gameplay
> phase: hyperbolic rails / patched conics.
