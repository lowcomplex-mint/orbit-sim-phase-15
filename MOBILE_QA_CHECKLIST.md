# Mobile QA checklist

Phase 14 C has no headless touch driver. Check these on Chrome DevTools
device emulation, then on a real phone (USB `adb reverse tcp:5173 tcp:5173`
or LAN).

**Device used 2026-08-29 / 2026-09-01:** `25069PTEBG`, Android 16, 1280×2772
@ density 520 (CSS ~394×853, notch ~47px). Hasan walked the sim over
`adb reverse`. Gestures signed off 2026-08-29. **Phase 15 chrome signed off
2026-09-01.** Current brief: `HANDOFF.md`.

| Check | DevTools | Android (25069PTEBG) | iOS |
|-------|----------|----------------------|-----|
| VAB: empty-canvas pan | | ok (gestures pass) | |
| VAB: two-finger pinch zoom | | ok (gestures pass) | |
| VAB: pinch **during** marquee cancels box, zooms | | ok (gestures pass) | |
| VAB: pinch **during** long-press pending does **not** pick up the part | | ok (gestures pass) | |
| VAB: pinch **while placing** a part zooms camera, ghost stays | | ok (gestures pass) | |
| VAB: long-press part → settings sheet | | ok (gestures pass) | |
| VAB: palette scroll vs drag-to-place | | ok (gestures pass) | |
| VAB: landscape — toolbars + bottom tray usable, canvas visible | | not re-checked | |
| VAB: chrome organization | | Phase 15 signed off (`◄ KSC`, no FIT, SYM glyph, divider, LOG `☰` in-bar) | |
| VAB: LOG vs top toolbar | | fixed — in-bar `☰`, no floating `#ui-root` toggle | |
| Flight: throttle / rotate / stage / SAS / warp / map / legs | | custom throttle; hit zone slider→right edge, same Y | |
| Flight: vessel-view pinch zoom | | ok (gestures pass) | |
| Flight: map pan + pinch | | ok (gestures pass) | |
| Flight: FOLLOW/CENTER | | lower-left, **map only** (not on the vessel dock) | |
| Flight: ENGINEER header tap collapses; drag moves; stays on-screen | | ok | |
| Flight: HUD / throttle / navball | | **signed off** 2026-09-01 (Ap/Pe left, Alt/Vel right, Flight ▾) | |
| Flight: navball heading chevron | | tracks nose (do not extra-counter-rotate) | |
| Pause / quicksave from pause menu | | not separately called out | |
| No page pinch-zoom / pull-to-refresh | | ok | |
| Notch / home-indicator: chrome paints through the notch; content padded | | Phase 15 signed off | |
| Production: Add to Home Screen (PWA) launches standalone | | hub button; pass-through SW (`orbit-sim-passthrough-1`) | |

Hasan 2026-08-29: **gestures mostly good.**
Hasan 2026-09-01: **satisfied with the UI for now.** Phase 15 closed.

`npm run test:gestures` covers PointerTracker math only.

Chrome **tab** still shows the URL bar + Android nav. That is browser chrome,
not a CSS bug. Add to Home Screen / `display: standalone` hides the URL bar.
If the phone whitescreens: restore `adb reverse` and/or let `index.html`
wipe a stale caching SW (one-shot `orbit-sw-cleared`).
