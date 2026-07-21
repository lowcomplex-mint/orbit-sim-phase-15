# Handoff — Orbit Simulator

**Canonical location (for Hasan / Claude Fable):**  
`/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md`  

**Audience:** Claude Fable (manager / next agent) and anyone syncing the external GitHub repo back into the Grok worktree.  
**Author:** Grok (Composer agent)  
**Date:** 2026-07-20  
**Code worktree:** `/home/hasan/.grok/worktrees/hasan-orbit-simulator/orbit-simulator`  
**Branch:** `main` (tracks `origin/main`; large amount of **uncommitted** work)

---

## How this handoff is meant to be used

1. **You (Claude Fable)** review this doc, do a pass on the product, and push updates to the **canonical GitHub repo** (other account).
2. **Hasan** asks Grok to **sync that remote into this system** so this worktree matches the up-to-date product.
3. Grok continues from the synced state — not from stale local-only assumptions.

Until that sync happens, treat this worktree as the **source of truth for Grok’s uncommitted session work**, not necessarily what’s on GitHub.

---

## Repo / workspace reality check

| Item | State |
|------|--------|
| Last committed tip | `5b6f3a3` — “Stabilize project for GitHub handoff” |
| Working tree | **Dirty** — many modified tracked files + many untracked paths (see below) |
| `documents/` | **Untracked** — all Grok addition docs live here |
| Dev server | **Stopped** (was `http://localhost:5173/`; closed on request) |
| Validation (this worktree, last run) | `npm run build` clean; `npm run sim` PASS; `npm run test:graph` PASS |

### Untracked paths Grok introduced or left local

```
documents/
phase planning/
next-phase-prompt-legs-and-root-rewrite.md
scripts/testPartGraph.ts
src/builder/PlacementGrid.ts
src/builder/RotateControls.ts
src/builder/SnapControls.ts
src/builder/TransformTool.ts
src/physics/GroundContact.ts
src/vehicle/LandingLegs.ts
src/vehicle/PartGraph.ts
src/vehicle/PartTree.ts
```

Plus extensive modifications under `src/`, `scripts/simAscent.ts`, `package.json`, `CURRENT_STATUS.md`, `README.md`, etc.

**Action for manager:** decide what to commit/push to the external GitHub account; then Grok will pull/sync that remote when Hasan asks.

---

## Product snapshot (what the game is)

Browser 2D orbit / rocket sandbox (Pixi.js + Vite + TypeScript). Scenes: Space Center → VAB → Flight → Tracking Station. Physics is headless-testable via `npm run sim`.

**Phases landed in this worktree (conceptually):**

MVP → persistent world → radial attachment → sandbox systems → recovery loop →  
**Phase 7** fractional VAB grid → **Phase 8** deployable LT-2-style landing struts →  
**Phase 9** tree/Move/Root (Rotate scaffolding, now disabled) →  
**Phase 10** recovery sim suite → **Phase 11** attachment graph overhaul →  
**post-11** rails-on-suborbital + surface stick-to-body landing fix.

Authoritative phase order: `phase planning/phase-10-11-plan.md`  
Pivot rules for rotate (future): `phase planning/phase-11-pivot-rules.md`

---

## What works well (regression-backed)

### `npm run sim`

- Fixed-timestep gravity, two-body orbit math, stock rocket ascent → orbit.
- Graph staging, radial boosters, parallel staging debris, engine plates.
- Attitude (CoM torque, SAS modes); reentry heating; saves; career foundations; vehicle analysis.
- **Landing legs (P8):** stowed/deployed/broken; crash tolerances; soft/hard/excessive gates.
- **Recovery loop (P10):** parachutes (deploy + fail outside envelope), launch clamps, electricity (drain/wheels/solar), full clamp→ascent→chute→leg mission.
- **Rails warp:** physics warp ladder + analytic Kepler rails; **suborbital vacuum coasts allowed**; auto-drop on atmosphere entry and SOI change.
- **Surface rest (recent):** soft land / idle landed vessels **stick** to body surface velocity (no ice-skating).

### `npm run test:graph`

- Explicit edges (stack/radial), derived tree, disconnect detection, reroot, subtree move, mirror parent helpers.

### Live / UX (build + boot; less automated)

- VAB: Place, Move, Root; Snap step; SYM mirror with parentId fix; CoM; staging preview; context menus.
- Flight HUD, map, warp controls, chutes/legs buttons, Space Center / Tracking Station / pause.

---

## What we’re working on / just finished

| Item | Status |
|------|--------|
| Phase 10 recovery sim suite | **Done** (sim green) |
| Phase 11 node/attachment graph | **Done** (graph tests green; Rotate still disabled by design) |
| Rails outside atmosphere (incl. suborbital) | **Done** (sim gates) |
| Fake landing / surface skate fix | **Done** (stick-to-surface; sim gates) |
| Phase 12 (warnings + box select) | **Not started** — recommended next product phase |
| Phase 13 (Rotate v2 + subassemblies) | **Not started** — blocked on deliberate design + Phase 11 graph (graph exists) |
| Full multi-body leg suspension / tip-over | **Not started** — only rest-contact + crash gates |

**Active agent focus at handoff time:** documentation / handoff for Claude Fable; **not** mid-implementation of Phase 12.

---

## What’s not working well / partial

| Area | Issue |
|------|--------|
| **Rotate tool** | Disabled (greyed) until Phase 13. Pivot rules written; no Rotate v2 implementation. |
| **Landing legs physics** | Rest stick + impact speed gates only. No spring-damper, no tip-over, no per-leg toggle, no deploy animation. |
| **Hyperbolic / escape rails** | Still denied (“hyperbolic rails TODO”). Bound suborbital OK. |
| **Mirror SYM tree** | ParentId on twin improved; full mirror-edge fidelity still shallow vs full graph edge cloning. |
| **Map / SOI** | Single-body conic map; rails drop on SOI cross but no patched-conic trajectory preview. |
| **Resources** | Electricity only; other resources stubbed. |
| **Maneuver nodes** | Data model only. |
| **Collision in VAB** | AABB for placement; rotated-part OBB deferred with Rotate. |
| **Debris on rails** | Non-propagatable debris may still be destroyed on rails engage (TODO per vessel). |

---

## What’s broken / known bugs (fix or watch)

| Severity | Item | Notes |
|----------|------|--------|
| **Fixed (this session)** | Landed vessel “skating” on surface | Only cancelled inward velocity; tangential speed remained → pad appeared to drift. Now `stickToSurface` / rest path. |
| **Fixed (this session)** | Rails denied for suborbital vacuum | Required full stable orbit; long Moon-return coasts unplayable. Now any bound elliptic outside atmosphere. |
| **Fixed (P11)** | Move tool self-overlap false positive | `designFits` treated each part as overlapping itself. |
| **Fixed (P10)** | Clamp designs failing `validateDesign` | Clamp `yCells: -2` didn’t mate tank flank; use `yCells: 0` for 2-tall tanks. |
| **Watch** | Recovery mission legs often “broken” on soft chute land | Tolerance physics may still be harsh; mission asserts survive, not unbroken legs. |
| **Watch** | Uncommitted local vs remote drift | Manager’s GitHub may lag this worktree until push + Grok sync. |
| **By design** | Rotate UI disabled | Not a bug; Phase 13. |

---

## Waiting for feedback / decisions

1. **External GitHub sync plan** — Hasan will have Claude Fable update the other account’s repo; then Grok should pull/sync into this worktree. Confirm remote URL and branch when ready.
2. **Commit strategy** — Large dirty tree: one big “Phases 8–11 + rails + landing stick” commit vs stacked commits? Prefer manager’s preference.
3. **Phase 12 vs 13 priority** — Plan says 12 (warnings + box select) before 13 (Rotate v2). Confirm if landing suspension should jump the queue.
4. **How “real” landing should get** — Stick-to-surface may be enough for now; or prioritize multi-point contact + tip-over next.
5. **Escape-trajectory rails** — Implement hyperbolic Kepler now, or leave until patched conics?

---

## Commands Claude Fable / next agent should run

```bash
cd /home/hasan/.grok/worktrees/hasan-orbit-simulator/orbit-simulator
npm run build        # tsc --noEmit && vite build
npm run sim          # physics + recovery + rails + legs
npm run test:graph   # attachment graph (Phase 11)
npm run dev          # http://localhost:5173/ when needed
```

**Do not** change staging / rails / serialization without re-running `sim` (+ `test:graph` if graph-related).

---

## Key files map

| Path | Role |
|------|------|
| `src/vehicle/PartGraph.ts` | Attachment edges, tree derive, structure validate |
| `src/vehicle/PartTree.ts` | Subtree move/reroot helpers |
| `src/vehicle/LandingLegs.ts` | LT-2 strut geometry / pose |
| `src/physics/GroundContact.ts` | Contact points, stick-to-surface, normal constraint |
| `src/physics/RocketPhysics.ts` | Integration, attitude, landing, clamps |
| `src/physics/PhysicsWorld.ts` | Rails engage/advance, atmosphere drop |
| `src/space/KeplerOrbit.ts` | Analytic rails + `canPropagateOnRails` |
| `src/systems/FlightSession.ts` | Warp eligibility, session orchestration |
| `scripts/simAscent.ts` | Master headless regression |
| `scripts/testPartGraph.ts` | Graph regression |
| `phase planning/phase-10-11-plan.md` | Reviewed phase order |
| `phase planning/phase-11-pivot-rules.md` | Stack vs radial pivot rules |
| `CURRENT_STATUS.md` | Short status (may lag this Handoff slightly) |

---

## Recommended next steps (after sync)

1. **Commit + push** this worktree’s intended state to the external GitHub (Claude Fable / Hasan).
2. **Grok syncs** remote → this worktree; re-run build/sim/test:graph.
3. **Phase 12** — VAB gameplay-rule warnings + box select / group ops.
4. **Phase 13** — Rotate v2 per pivot rules; re-enable Rotate UI.
5. Optional: multi-point landing, hyperbolic rails, patched-conic map.

---

# Grok’s additions

Everything below is work done in this worktree by **Grok** across the recent session arc (Phases 8–11, recovery polish, rails, landing stick, docs). Use this as a change inventory for review/commit.

## A. Landing struts (LT-2 style) — Phase 8 product + polish

- **One part = one radial strut** (`legs-1`), not a multi-leg skirt; mirror with SYM for left/right.
- Shared geometry in `src/vehicle/LandingLegs.ts` (hinge, stowed tip, deploy knee/foot, outward sign).
- Flight: LEGS / **L** toggle; stowed vs deployed crash tolerance; hard land marks legs **broken** but attached.
- VAB: stack-aware outward pose so left/right don’t both point the same way.
- Physics contact: hull + foot samples in `GroundContact.ts`; later stick-to-surface fix (section F).
- Docs: README landing struts notes; pointer docs under `documents/Grok additions/`.

## B. Phase 9 scaffolding (partial; Rotate on hold)

- Explicit part tree fields: `id`, `parentId`, `rootPartId`, `rotationDeg`.
- Tools: Place / Move / Root; Rot step UI exists but **Rotate tool disabled** (Phase 11 decision).
- `PartTree.ts`, `TransformTool.ts`, `RotateControls.ts`, `SnapControls.ts`, `PlacementGrid.ts`.
- Rendering + snap aware of rotationDeg where present; free rotate not trusted.

## C. Phase planning docs

- `phase planning/next-phase-ideas.md` — original idea dump.
- `phase planning/phase-10-11-plan.md` — **reviewed** order: Phase 10 recovery sim **before** Phase 11 node overhaul.
- `phase planning/phase-11-pivot-rules.md` — **Step 0** locked: stack vs radial mounts, edge list as truth, pivot rules for Move/Root/Rotate-v2, mirror rules, structural validation scope.

## D. Phase 10 — Recovery sim suite

File: `scripts/simAscent.ts` (blocks: Parachutes, Launch clamps, Electricity, Full recovery mission).

| Block | Coverage |
|-------|----------|
| Parachutes | Combo drogue/main, drag increase, nylon fail after open + speed abuse |
| Launch clamps | `igniteStage: 2`, pad pin, debris vessel, liftoff; clamp at `yCells: 0` for attachment |
| Electricity | Sunlit charge, eclipse drain, wheels offline at 0 EC, recharge |
| Capstone | Clamps → stage → suborbital entry teleport → chutes + legs → survive |

Handoff note: `documents/Grok additions/Phase 10 recovery sim suite.md`

## E. Phase 11 — Node / attachment overhaul

| Deliverable | Detail |
|-------------|--------|
| `PartGraph.ts` | `AttachmentEdge`, `mountKind` stack/radial/internal-reserved, build from geometry, derive tree from edges+root, structural validate, mirror helpers |
| `RocketDesign.edges` | Optional save field; rebuilt on `syncDesignGraph` |
| `RocketAssembler` | Uses structural validation |
| Snap | Returns node indices + mountKind |
| SYM | Mirror twin gets `mirroredParentId` |
| Reroot | Re-derives parents from edges |
| Move fix | `designFits` no longer self-overlaps |
| Rotate | Disabled in VAB toolbar + Rot controls |
| Tests | `npm run test:graph` → `scripts/testPartGraph.ts` |
| Docs | `documents/Grok additions/Phase 11 node attachment overhaul.md` |

## F. Rails warp anytime outside atmosphere

**Problem:** Suborbital / Moon-return vacuum coasts required a full stable orbit → real-time days.

**Change:**

- Eligibility: outside dominant atmosphere + bound elliptic + e under max; not thrusting/landed/destroyed.
- `engageRails` captures any propagatable bound conic (not only peri-above-atm).
- Auto-drop: atmosphere entry (`railsAtmosphereBreak`) + SOI break.
- Sim: suborbital engage + atmosphere drop checks.
- Escape/hyperbolic still TODO.

Files: `FlightSession.ts`, `PhysicsWorld.ts`, `KeplerOrbit.ts`, `scripts/simAscent.ts`.

## G. Surface stick-to-body landing (anti-skate)

**Problem:** “Fake landing” — only killed inward radial velocity; craft skated around Earth; pad drifted; debris looked wrong.

**Change:**

- `stickToSurface`, `surfaceVelocityAt`, `applySurfaceNormalConstraint` in `GroundContact.ts`.
- Idle landed / soft land / crash / clamps: match surface velocity, zero spin.
- Throttle on pad: normal constraint only (can still liftoff).
- Sim: lateral soft land has no residual velocity; no skate over 10 s.

## H. Tooling / package scripts

```json
"sim": "tsx scripts/simAscent.ts",
"test:graph": "tsx scripts/testPartGraph.ts"
```

## I. Documentation Grok wrote or refreshed

| Document | Purpose |
|----------|---------|
| **`/home/hasan/Documents/Grok projects/Orbit-sim/Handoff.md`** | **This file** — manager handoff (canonical) |
| Same folder: `LT-2 landing struts.md`, `Phase 8…`, `Phase 9…`, `VAB overhaul.md` | Prior Grok project notes |
| Worktree `documents/Grok additions/` | Duplicate/scratch copies (P10/P11 detail notes) |
| Worktree `CURRENT_STATUS.md` | Short living status (update after Fable pass if needed) |
| Worktree `phase planning/*` | Plans + pivot rules |

## J. Explicitly not done by Grok (yet)

- Phase 12 box select / gameplay validation warnings  
- Phase 13 Rotate v2 + subassemblies  
- Hyperbolic rails  
- Full multi-contact suspension / tip-over  
- Patched-conic map  
- Committing / pushing to the external GitHub account (waiting for Claude Fable + Hasan workflow)

---

## Message to Claude Fable

This worktree is playable and regression-green for the features above, but **most of Grok’s work is uncommitted**. Please:

1. Review behavior (esp. rails suborbital coasts + landed stick-to-surface).  
2. Shape commits and push to the **canonical GitHub** Hasan uses for the “real” product.  
3. Note any rejections or follow-ups in a short reply so Grok can re-sync and continue (Phase 12 unless redirected).

When Hasan says the remote is updated, Grok’s next job is: **fetch/pull that repo into this system and re-verify `build` / `sim` / `test:graph`.**
