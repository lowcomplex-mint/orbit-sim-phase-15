# Phase 11 — Node / attachment overhaul

**Status:** complete (2026-07-12)  
**Pivot spec:** `phase planning/phase-11-pivot-rules.md`  
**Graph tests:** `npm run test:graph`  
**Physics regression:** `npm run sim` (unchanged pass)

## What shipped

### Explicit attachment graph (`src/vehicle/PartGraph.ts`)

- `AttachmentEdge` list on `RocketDesign.edges` — undirected connections with `mountKind` (`stack` | `radial` | `internal` reserved), part ids, and node indices.
- `syncDesignGraph()` — rebuilds edges from live node coincidence, derives `parentId` tree via BFS from `rootPartId`, resets legacy non-zero `rotationDeg`.
- `validateStructure()` — disconnected parts, broken parent refs, cross-check with `partsAttached` (staging-safe).
- Mirror helpers: `findMirroredPart`, `mirroredParentId`, `mirroredXCells`.

### Integration

| File | Change |
|------|--------|
| `RocketDesign.ts` | `edges` field; serialize optional; `ensureTree` → `syncDesignGraph` |
| `RocketAssembler.ts` | structural validation via `validateStructure` |
| `SnapSystem.ts` | returns node indices + `mountKind` on snap (for future edge authoring) |
| `PartTree.ts` | `rerootDesign` re-derives tree from edges |
| `TransformTool.ts` | edge cleanup on subtree delete; **fix:** `designFits` no longer self-overlap false positive |
| `BuilderScene.ts` | SYM mirror sets `parentId` on twin; **Rotate disabled** (toolbar + Rot controls greyed) |

### Rotate

Disabled until Phase 13. Pivot rules are documented per mount kind in the pivot spec.

### Headless tests (`scripts/testPartGraph.ts`)

Stock stack edges, radial legs, disconnect detection, reroot, subtree move, mirror parent resolution, tree derivation.

## Save format

- `edges` optional in v2 saves; rebuilt on load if absent.
- `rotationDeg` non-zero values reset to 0 on sync (none in stock/default fixtures).

## Next phase

**Phase 12** — VAB gameplay-rule validation warnings + box select / group ops.  
**Phase 13** — Rotate v2 + subassemblies (requires stable graph — now in place).