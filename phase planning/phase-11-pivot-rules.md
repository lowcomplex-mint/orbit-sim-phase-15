# Phase 11 — Pivot rules & attachment semantics (Step 0)

**Status:** locked before implementation (2026-07-12)  
**Scope:** defines how Move / Root / (future) Rotate v2 interpret geometry. Rotate stays **disabled** in the VAB until Phase 13.

---

## Node roles (three kinds; `internal` reserved)

| Role | Node kinds on part | Pairing rule | Examples |
|------|-------------------|--------------|----------|
| **stack** | `top`, `bottom` | Paired nodes must coincide exactly on the grid | capsule↔tank, tank↔decoupler, decoupler↔engine |
| **radial** | `left`, `right` | Mount point on host hull + outward normal; child brings the mating node | legs, battery, solar, clamp, radial decoupler |
| **internal** | *(reserved)* | Not used in Phase 11 | future fairings / interstages |

Classify by node kind: `top`/`bottom` → stack; `left`/`right` → radial.

---

## Source of truth

1. **`AttachmentEdge` list** — which part connects to which, via which node indices, and mount role. Stored on `RocketDesign.edges` (optional in saves; rebuilt from geometry on load if absent).
2. **`rootPartId`** — which part is the staging/physics root (command pod heuristic on new designs).
3. **`parentId` tree** — **derived** from edges + root via BFS. Never authoritative on its own.

Connectivity for flight (`partsAttached` / staging) remains node-coincidence on instantiated geometry; edges must agree with that invariant.

---

## Pivot rules (per tool)

### Move (subtree translate)

- **Pivot:** none — rigid translation of all parts in the selected subtree.
- **Preserves:** edge list, node indices, `rotationDeg`, relative offsets between subtree members.
- **Validates:** grid bounds + no AABB overlap with parts outside the subtree (unchanged from Phase 9).

### Root (reroot)

- **Pivot:** none — reverses the parent chain along the unique tree path from old root to new root.
- **Preserves:** edge list and all placements; only `rootPartId` + derived `parentId` values change.
- **Staging:** activation stages untouched (still keyed by part identity).

### Rotate v2 *(Phase 13 — spec only)*

| Mount role | Pivot | Axis | Allowed angles |
|------------|-------|------|----------------|
| **stack** | Shared stack node (parent↔child joint) | Perpendicular to stack axis (2D: point) | Quantized 90°/180° for stack parts |
| **radial** | Mount point on host hull | Outward normal through mount (2D: spin in plane) | 90° steps typical; fine steps for decorative bits |
| **internal** | TBD | TBD | TBD |

Subtree rotate (whole assembly in world space) uses the **stack joint** between the selected part and its parent; if the selected part is root, pivot = part center (discouraged for stack parts).

**Phase 11:** reset any non-zero `rotationDeg` on load (none in stock fixtures); free rotate UI disabled.

---

## Mirror symmetry (SYM)

When placing part **C** attached to parent **P**, the mirrored twin **C′** attaches to **P′** where **P′** is the existing part at the mirrored X with the same `defId` and `yCells`. If **P** lies on the center column (mirror X equals P’s X), **C′** uses the same `parentId` as **C**. Edges are mirrored the same way (child/parent ids swapped to mirrored ids).

---

## Validation (structural — Phase 11)

- Every part reachable from `rootPartId` through edges (equivalently: `partsAttached` BFS).
- Every non-root part has exactly one parent in the derived tree.
- No `parentId` references a missing part.
- Edges must match live node coincidence (rebuild detects drift).

Gameplay-rule warnings (chute on crewed return, etc.) remain Phase 12.

---

## Collision / placement

- Unrotated parts: axis-aligned bounds (`overlapsAnyPart`).
- Rotated parts (future): node-coincidence + OBB, not AABB alone.
- Phase 11 disables rotate and clears legacy `rotationDeg` → AABB remains sufficient.