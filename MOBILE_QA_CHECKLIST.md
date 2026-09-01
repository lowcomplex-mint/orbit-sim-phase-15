# Mobile QA checklist

Phase 14 C has no headless touch driver. Check these on Chrome DevTools
device emulation, then on a real phone (USB `adb reverse tcp:5173 tcp:5173`
or LAN).

**Device used 2026-08-29:** `25069PTEBG`, Android 16, 1280×2772 @ density 520
(CSS ~394×853, notch ~47px). Hasan walked the sim over `adb reverse`.

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
| VAB: chrome organization | | partial — usable, still cluttered | |
| VAB: LOG vs top toolbar | | fixed after pass (own `--log-gutter` slot) | |
| Flight: throttle / rotate / stage / SAS / warp / map / legs | | controls work; **placement pinned** | |
| Flight: vessel-view pinch zoom | | ok (gestures pass) | |
| Flight: map pan + pinch | | ok (gestures pass) | |
| Flight: ENGINEER header tap collapses; drag moves; stays on-screen | | not separately called out | |
| Flight: HUD / throttle / navball | | **pinned** — better after SFS-ish pass, still not signed off | |
| Flight: navball heading chevron | | was always-up; now tracks nose | |
| Pause / quicksave from pause menu | | not separately called out | |
| No page pinch-zoom / pull-to-refresh | | ok | |
| Notch / home-indicator: LOG and bottom bar clear the safe area | | LOG slot reserved; not fully signed off | |
| Production: Add to Home Screen (PWA) launches standalone | | not tested (dev server) | |

Hasan 2026-08-29: **gestures mostly good; VAB OK-ish; flight chrome pinned.**
Resume HUD work only with a Paint mockup.

`npm run test:gestures` covers PointerTracker math only.
