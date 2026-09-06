# Next Phase Ideas & Part-Manipulation Status

> **Historical planning (2026-07-12).** Phases 10–15 have **shipped**. Rotate
> v2, subassemblies, group ops, recovery sim, mobile port, and SFS chrome are
> done. **Do not implement from this file.** Current brief and next work
> (hyperbolic rails / patched conics): **`HANDOFF.md`**.

**Author:** Grok · **Date:** 2026-07-12  
**Context:** Post LT-2 landing struts; Phase 9 scaffolding landed but rotation needs redesign.  
**Related:** `next-phase-prompt-legs-and-root-rewrite.md`, `CURRENT_STATUS.md`, `documents/` / Grok additions handoffs

---

## Part manipulation tools — current standing

Phase 9 is **partially landed**: the data model and UI exist, but several tools are built on assumptions that break down once you care about real attachment semantics (especially after a node overhaul).

### What’s in the codebase

| Layer | Status | Notes |
|-------|--------|-------|
| **Tree data** (`PartTree.ts`, `RocketDesign`) | ✅ Present | `id`, `parentId`, `rootPartId`, `rotationDeg`; adjacency migration on load |
| **Place** | ✅ Solid | Snap sets `parentId`; default mode |
| **Move** (subtree translate) | 🟡 Works for simple cases | Drag subtree with snap step; collision-checked |
| **Rotate** (subtree) | 🔴 Needs overhaul | See below |
| **Root** (reroot) | 🟡 Functional | Reverses parent chain; staging order untouched |
| **Rot step UI** | ✅ Present | ↺/↻, Q/E, 5°–90° presets — but drives the flawed rotate path |
| **Rendering** | 🟡 Partial | VAB draws `rotationDeg` about part center; flight stack too |
| **Snap / hit-test** | 🟡 Partial | Rotation-aware nodes in `SnapSystem`; placement still fragile |
| **Validation** | 🔴 Weak | No sim tests; mirror SYM ignores mirrored `parentId` |

Toolbar: **Place · Move · Rotate · Root** + Snap + Rot controls. All mutations still go through `designChanged()`.

### Why rotation needs an overhaul

The current rotate path treats a part as **bottom-left origin + `rotationDeg`**, but applies rigid rotation to **cell coordinates** as if everything were point masses (`applySubtreeRotation` in `PartTree.ts`: rotates `xCells`/`yCells` and adds `deltaDeg` to each part).

That conflicts with:

1. **Renderer** — rotates graphics about the **part center**, not bottom-left.
2. **Collision checks** — `overlapsAnyPart` uses **axis-aligned** boxes; rotated parts aren’t OBB-tested, so rotate “works” until it silently overlaps or mis-snaps.
3. **Attachment nodes** — `rotateOffset()` rotates nodes about part center, but the part origin didn’t move consistently with a true rigid transform.
4. **Subtree semantics** — unclear whether you’re rotating a **subassembly in world space** vs. re-orienting a **radial part on its mount** (legs, decouplers) — different pivot rules.
5. **Tree vs. geometry** — tree is explicit, but connectivity is still validated via `cellsNear`; rotation can desync tree from physical nodes.

**Practical recommendation:** treat **Rotate as disabled / hidden** until the node overhaul defines: pivot rules, what rotates (part only vs. subtree), allowed angles (90° radial vs. free), and OBB or node-exact collision. **Move + Root + explicit tree** are the pieces worth keeping and hardening first.

### Keep / pause / already good

| Keep / invest in | Pause / redesign | Already in good shape |
|------------------|------------------|------------------------|
| Explicit tree, Move subtree, Root | Rotate tool, free-form `rotationDeg` on stack parts | LT-2 legs, foot contact, liftoff |
| Snap step, `designChanged()` funnel | Mirror-SYM `parentId` | Phase 8 `legState` + sim gates |
| Rotated rendering hook | Tree-from-adjacency as long-term truth | |

---

## Next-phase ideas

Grouped by theme — mix and match when writing a formal phase prompt.

### A. Foundation (unblocks everything else)

#### 1. Attachment node overhaul *(prerequisite for honest rotate)*

- Single source of truth: node graph, not coincidence + inferred tree.
- Node kinds, pairing rules, fractional positions, mount direction.
- Unblocks: real rotate, radial parts, subassemblies, validation warnings.

#### 2. VAB validation layer

- Live warnings: disconnected parts, orphaned subtrees, no control source, no parachute on crewed return, legs not on flanks, etc.
- Cheap win; improves builder feel without new physics.

### B. Recovery loop completion (gameplay closure)

#### 3. Sim coverage: parachutes → land

- Scripted: arm → deploy gates → drag reduction → touchdown.
- Closes the biggest “works in browser, untested” gap.

#### 4. Sim coverage: clamps + electricity

- Pad release on stage; solar/battery/probe drain through ascent + eclipse.
- Makes career/sandbox loops trustworthy.

#### 5. Full recovery mission test

- One `npm run sim` path: suborbital hop or LKO → deorbit → chutes → legs → survive.
- Strong regression anchor after legs + chutes work.

### C. Builder UX (after nodes)

#### 6. Box select + group ops

- Multi-select, move, clone, duplicate, delete subtree.
- Depends less on rotate; pairs well with Move tool.

#### 7. Subassemblies / templates

- Save/load a subtree as a blueprint chunk.
- Needs stable tree + node model.

#### 8. Rotate v2 *(only after node overhaul)*

- Spec pivots: mount joint vs. part center vs. root.
- Likely **quantized angles** (90°/180°) for stack parts; optional fine steps for decorative bits.
- OBB overlap or node-coincidence validation, not AABB.

### D. Flight / world depth

#### 9. Maneuver nodes (minimal)

- Place node, burn preview, prograde hold to node.
- Data model exists; makes map + SAS feel purposeful.

#### 10. Map: patched-conic SOI handoff

- Trajectory preview across Earth ↔ Moon.
- Pairs with existing body-relative rails warp.

#### 11. Leg polish

- Deploy animation (stowed → hinge → extend).
- Per-leg toggle (optional).
- Suspension as simple spring on foot contact (visual + tolerance), not full physics.

### E. Content / career

#### 12. Fairings / adapters

- Procedural nose fairing, interstage.
- Needs node rules for internal vs. external mounts.

#### 13. Tracking Station QoL

- Rename, filter, sort vessels.
- Low risk, high polish.

#### 14. Contracts / milestones expansion

- Land on Mun, recover craft, science from biome hooks (when biomes exist).

---

## Suggested planning order

| Phase | Focus | Why now |
|-------|--------|---------|
| **10** | Node system rewrite + tree validation | Root cause; rotate waits on this |
| **11** | Recovery sim suite (chutes, clamps, power, land) | Legs done; prove the loop headlessly |
| **12** | VAB validation + group ops | Professional builder without rotate |
| **13** | Rotate v2 + subassemblies | Only after nodes are stable |

---

## Invariants (unchanged)

1. SI units in physics; pixels only in camera/render.
2. Physics never imports rendering (`npm run sim` stays headless).
3. All VAB mutations via `BuilderScene.designChanged()`.
4. Run `npm run sim` after `StageSystem` / staging changes.
5. New save fields optional, backward compatible.

---

## Deliverables checklist (when a phase ships)

- `npm run build` clean, `npm run sim` pass (plus any new regression blocks).
- Update `CURRENT_STATUS.md`.
- Grok additions handoff in `~/Documents/Grok additions/` (or repo `documents/` if preferred).
- Call out loudly if an invariant must break.

---

*Pick a track (nodes / recovery sim / builder UX) and flesh out a `next-phase-prompt-….md` from one section above.*