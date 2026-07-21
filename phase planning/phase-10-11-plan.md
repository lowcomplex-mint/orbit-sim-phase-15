# Next Phase Plan — Reviewed & Revised

**Reviewing:** `next-phase-ideas.md` (Grok, 2026-07-12)
**Verdict:** the diagnosis is right, the sequencing needs one swap, and the node overhaul needs to be scoped tighter before anyone starts it.

**Renumbering note:** below, **Phase 10 = recovery sim suite** (was Grok's Phase 11), **Phase 11 = node/attachment overhaul** (was Grok's Phase 10). Reasoning below. Phase 12/13 unchanged.

---

## Kept as-is

- Tool status table (Place/Move/Rotate/Root/etc.) — no repo access to verify independently, no reason to doubt it, not reproduced here to avoid two copies drifting apart. See `next-phase-ideas.md`.
- Idea list themes B–E (items 3–14) — content and grouping are sound, untouched below.
- The call to disable/hide Rotate until the overhaul lands. A greyed-out button with a TODO beats a tool that silently mis-collides.
- Invariants and deliverables checklist — unchanged, repeated at the bottom for completeness.

## What changes

### 1. Recovery sim suite moves ahead of the node overhaul

Clamps release-on-stage and decouplers are staging-graph-dependent — the very first handoff doc says as much ("graph-based staging: stack + radial decouplers... launch clamps"). That's the same graph the node overhaul is about to rewrite. Going into that refactor with zero automated coverage for the systems most likely to break is backwards. Electricity and the full-mission test (items 4–5) aren't staging-critical the same way but bundle naturally with clamps, same grouping as originally scoped.

### 2. Split "node overhaul" into two attachment mechanics, not one

| | Stack | Radial / surface |
|---|---|---|
| Mate | paired node ↔ node, exact coincidence | point + outward normal on a hull, no paired node |
| Examples | capsule↔tank, tank↔decoupler, decoupler↔engine | legs, battery, solar, radial decoupler |
| What "rotate" means | pivot around the shared node | spin around the mount's own normal axis |

Forcing both through one generic node-pairing model is how you end up back where Rotate already is: technically defined, semantically ambiguous the moment someone asks "rotate around what, for this part?" Treat these as two node *kinds* from the start, each with its own pairing rule.

Worth leaving a seam for a third kind (`internal`) now, even unused — item 12 (fairings/interstages) will need internal-vs-external mount rules eventually, and it's cheaper to leave the extension point than reopen this layer twice.

### 3. Split the validation layer (item 2) across two phases

- **Structural checks** (disconnected parts, orphaned subtree) are a direct query against the new graph — fold these into Phase 11's own acceptance test, not a separate later feature. If the graph is right, this check is nearly free; if it's wrong, this is how you find out.
- **Gameplay-rule warnings** (no chute on crewed return, legs not on flanks, no control source) stay in Phase 12 with group ops, where the doc already had them.

### 4. Give the node overhaul its own regression coverage

Every other phase here asks for more sim coverage. The riskiest phase on the roadmap — the one rewriting the thing everything else sits on — currently asks for none. It needs headless tests independent of the browser: construct known graphs, exercise move/reroot, assert connectivity and world-position invariants hold. Doesn't have to be `npm run sim` specifically if that's physics-only by convention, but it needs to be something that runs without a browser and fails loudly.

### 5. Two footnoted bugs get promoted to real tasks

- **Mirror-symmetry / `parentId` desync** — currently one bullet in a table cell. That's a correctness bug: build one side, the mirrored twin's tree silently disagrees with it. Define what reroot/move means for a mirrored pair and fix it as part of Phase 11, not a someday item.
- **Save migration for existing `rotationDeg`** — Phase 9 already wired rotation into rendering and partial collision, so any save (including test fixtures) with non-zero rotation was authored under semantics about to be redefined. Audit whether any exist, then decide: reset-with-warning, or reinterpret under the new pivot rule. This is technically an old field changing meaning rather than a new field, which is a slightly different case than invariant 5 was written for — worth calling out explicitly rather than assuming the invariant already covers it.

### 6. Step 0 of Phase 11 is a design decision, not code

The pivot rule is correctly flagged as unresolved ("mount joint vs. part center vs. root"). That ambiguity is what broke Rotate the first time — don't let it survive into the rewrite. Pin the pivot rule down on paper, per node kind from section 2, before writing `PartTree.ts` v2. This is also exactly the transform/rotate/reroot spec mentioned earlier in this thread — sending that over resolves this directly instead of leaving it as an implementation-time guess again.

---

## Revised planning order

| Phase | Focus | Why this slot |
|---|---|---|
| **10** | Recovery sim suite — chutes, clamps, electricity, full mission | Independent of the attachment model; builds the regression net before the risky refactor |
| **11** | Node/attachment overhaul: stack vs. radial node kinds, explicit edge list as source of truth, structural validation, mirror-sync fix, rotation save-migration, own regression tests | Root cause; Rotate stays disabled until this lands |
| **12** | VAB gameplay-rule validation warnings + box select / group ops | Builder polish, doesn't need rotate |
| **13** | Rotate v2 + subassemblies | Only viable once 11 is stable |

## Phase 10 kickoff — concrete tasks

- Parachute sim: arm → staged deploy gates (drogue at altitude/speed threshold, main lower) → drag reduction → touchdown. Assert failure if deployed outside the safe envelope.
- Clamp sim: pad-held through stage N, released on stage N+1; assert the part is fully free of the pad attachment afterward, not just flagged released.
- Electricity sim: solar/battery/drain through ascent and through an eclipse (Moon-relative rails warp already exists, reuse it). Include a genuine net-negative case — drain past zero, confirm reaction wheels actually go offline, not just that the number goes negative.
- Full mission: one scripted path, suborbital hop or LKO → deorbit → chutes → legs → survive. Capstone regression anchor for everything shipped since Phase 7.

## Phase 11 kickoff — concrete tasks

- Write down the pivot rule per node kind before touching code (Step 0 above).
- New source of truth: explicit edge list (which specific node on part A pairs with which specific node on part B). `parentId`/tree becomes derived from this, not the reverse.
- Two node kinds: `stack` (paired, exact-coincidence) and `radial`/`surface` (point + outward normal, no paired node). Leave the seam for a future `internal` kind.
- Collision: replace AABB with either true OBB or graph-based node-coincidence validation for anything with non-zero rotation. Both were already named as options — node-coincidence is probably the lighter lift given the graph is about to become authoritative anyway, but that's an implementation call.
- Fix mirror-symmetry `parentId` propagation.
- Audit and migrate any existing non-zero `rotationDeg` data under the new pivot definition.
- Headless regression tests for the graph itself, independent of manual browser QA.

---

## Unchanged from the original

Themes C/D/E (items 6–14) carry over as written in `next-phase-ideas.md` — no changes proposed there yet.

**Invariants**
1. SI units in physics; pixels only in camera/render.
2. Physics never imports rendering (`npm run sim` stays headless).
3. All VAB mutations via `BuilderScene.designChanged()`.
4. Run `npm run sim` after `StageSystem` / staging changes.
5. New save fields optional, backward compatible.

**Deliverables checklist (per phase)**
- `npm run build` clean, `npm run sim` pass, plus any new regression blocks from that phase.
- Update `CURRENT_STATUS.md`.
- Grok additions handoff doc in `documents/`.
- Call out loudly if an invariant must break.
