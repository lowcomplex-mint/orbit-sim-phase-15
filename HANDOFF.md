# Handoff — Orbit Simulator

**Author:** Codex

**Date:** 2026-07-21

**Canonical repository:** `https://github.com/lowcomplex-mint/orbi-sim-grok-era.git`

**Branch:** `main`
**Phase 12 base:** `dd481a7` — Grok era Phases 8–11

This is the current handoff. Grok's original, pre-sync inventory is preserved
unchanged at `documents/Grok additions/Handoff.md` for historical detail.

---

## Current product state

The browser-based 2D rocket/orbit sandbox now includes Phases 8–12 on top of
the persistent flight/recovery systems:

- Phase 8 deployable LT-2-style landing struts and foot contact.
- Phase 9 Move/Root/tree scaffolding; Rotate remains deliberately disabled.
- Phase 10 recovery regressions (chutes, clamps, electricity, full mission).
- Phase 11 explicit attachment graph + derived trees.
- Phase 12 live VAB gameplay checks + graph-safe box selection/group ops.
- Post-11 rails on bound suborbital vacuum arcs and surface anti-skate remain
  regression-green.

## Codex additions — Phase 12

### VAB selection and group operations

- Dedicated **Select** tool for mouse/touch; `Shift` temporarily invokes
  selection from any tool.
- Drag in either direction to select every resolved part AABB intersecting the
  marquee; click toggles one part.
- Switch to **Move** and drag a selected part to move the deduplicated union of
  selected subtrees with the active fractional Snap step.
- Floating **DUP / DEL / clear** toolbar; `Ctrl+D`, `Delete`, and `Esc` keyboard
  equivalents (guarded while form controls have focus).
- Atomic overlap/bounds rejection, pure ghost previews, fresh ids/deep custom
  data plus exact source root/parent topology on duplicate, incident-edge/root
  cleanup on delete.
- `Esc`, undo/redo, design replacement, and `pointercancel` cancel active
  marquee/group gestures; a later pointer release cannot commit stale state.
- Every successful operation funnels through `designChanged()` exactly once,
  so undo/redo, staging, warnings, CoM, and analysis update together.

### Attachment-tree hardening

`deriveTreeFromEdges` now orients an internal tree for detached components as
well as the designated root component. Structural validation still rejects a
detached component, but a freshly duplicated subassembly remains movable as a
unit until the player snaps it back onto the rocket. Stale/missing root ids are
also repaired during graph sync.

### Live gameplay checks

Typed advisory warnings appear in the Engineer panel for:

1. no capsule/probe control source;
2. a crew-capable return component without an attached parachute (connections
   across decouplers/clamps do not count as retained recovery hardware);
3. landing struts without a radial hull-flank mount.

These do **not** replace or weaken `validateDesign()` launch blockers.

### Browser polish found during verification

- Persistent selection/root graphics are separate from stage-hover graphics.
- Mobile top controls are one horizontally scrollable strip; tool buttons keep
  their own unobstructed row.
- `.eng-body[hidden]` now actually collapses both Engineer and Staging bodies.
- The selection action bar fits above the palette at 390×844.

## Regression coverage

Required commands, all passing at this handoff:

```bash
npm run build
npm run sim
npm run test:graph
npm run test:builder
```

`test:builder` covers marquee normalization/fractional intersections, subtree
expansion and ancestor deduplication, multi-root/partial-subtree transforms,
fractional move, atomic rollback, unique/deep/topology-preserving duplicate,
detached component trees, graph/root-safe delete, advisory purity, and every
gameplay warning rule.

Browser verification covered desktop and 390×844 mobile VAB flows: select,
group move, duplicate, delete, undo, warning rendering, toolbar layout, and
panel collapse. A targeted browser race check also covered active group drag →
undo/Escape → pointer release and marquee cancellation. No Vite overlay or
page errors were present.

## Key Phase 12 files

| Path | Role |
|------|------|
| `src/builder/SelectionBox.ts` | Pure marquee normalization/intersection |
| `src/builder/GroupOps.ts` | Graph-safe move/duplicate/delete backend |
| `src/builder/DesignWarnings.ts` | Typed advisory VAB rules |
| `src/builder/BuilderScene.ts` | Selection gestures and operation controller |
| `src/builder/EditorEngineeringPanel.ts` | Live BUILD CHECKS presentation |
| `src/vehicle/PartGraph.ts` | Root repair + detached-component forest derivation |
| `scripts/testBuilder.ts` | Headless Phase 12 regression suite |

## Known limitations / watch items

- A duplicated group is intentionally detached and makes the design
  structurally invalid until moved onto a matching attachment node.
- The gameplay checks know craft structure/staging, not mission intent or real
  crew occupancy; they remain warnings, not launch blockers.
- Rotate v2, OBB collision, and reusable subassembly save/load are not included.
- Landing is rest contact + crash gates, not spring suspension/tip-over.
- Hyperbolic rails and patched-conic map continuation remain TODO.

## Recommended next phase

**Phase 13: Rotate v2 + subassemblies.** Start from
`phase planning/phase-11-pivot-rules.md`; write stack/radial pivot acceptance
tests before enabling the Rotate control. Build subassembly serialization on
stable ids, explicit edges, detached-component trees, and the Phase 12 group
backend rather than inventing a parallel representation.

Any change to attachment/tree/group code must run both `test:graph` and
`test:builder`; staging/rails/serialization changes must also run `sim`.
