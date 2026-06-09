# Active Layer Design Proposals

Two competing approaches for introducing a "selected/active layer" concept alongside the existing feature selection system. Implement each in a separate branch and compare.

---

## Shared requirements (both proposals)

These apply regardless of which proposal is chosen:

- **Layers panel click selects a layer.** Single-clicking a layer name/row in the layers panel sets it as the active layer.
- **Shift-click for multi-select in the layers panel.** Allows selecting more than one layer for bulk operations (hide/show all, etc.).
- **Selected layer row gets a light green tint** in the layers panel — the same green used for the style accordion open state.
- **Keyboard shortcuts for layer operations** only fire when a layer is active:
  - `T` — open features table for the active layer
  - `H` — toggle visibility of the active layer
  - `[` / `]` — move active layer up / down in the stack
  - `Cmd+D` — duplicate active layer
  - `Cmd+Backspace` — delete active layer
- **Escape hierarchy** (same in both proposals):
  1. If features are selected → clear feature selection, keep layer active
  2. If only a layer is active (no features selected) → deactivate layer
  3. Escape does NOT change the current tool mode (pan vs. select)

---

## Proposal A — Spatial separation

Layer operations live in the layers panel. The canvas is exclusively for feature interaction.

### Layer activation

- Click a layer row in the layers panel → that layer becomes active (row gets green tint)
- Click the canvas in select mode → selects features as today, does NOT set the active layer
- Active layer persists until explicitly cleared (Escape or clicking the row again to deselect)

### Layer action bar

A slim toolbar appears at the bottom of the layers panel section when a layer is active. It shows layer-level operations:

- **Clip** — clip active layer by another layer (picker dialog for second input)
- **Difference** — subtract another layer from the active layer
- _(future)_ Union, buffer, etc.

Common per-layer actions (hide/show, duplicate, delete) remain in the existing `...` context menu on each layer row — they don't move to the action bar.

### Feature selection

Unchanged from current behavior. SelectionBar floats at the bottom-center of the canvas, shows feature operations (Delete, Copy/Merge, Clear). No changes needed.

### Pros
- Clean separation of concerns — two zones, two intents, no ambiguity
- Canvas interaction model is unchanged; existing users won't be surprised
- No new visual states needed on the canvas

### Cons
- To do a layer op on a layer you can see on the map, you have to look away from the map to the panel
- Active layer state has no representation on the canvas — you have to look at the panel to know which layer is active
- Doesn't support the intuition that "the layer is on the canvas too"

---

## Proposal B — Figma-style hierarchical selection

Layer selection and feature selection are unified on the canvas as two levels of a hierarchy, mirroring Figma's frame → object model.

### Interaction model (in select mode only)

| Gesture | Result |
|---|---|
| Single click on canvas | Select the topmost layer at that point |
| Double click on canvas | Enter the layer and select the feature at that point |
| `Cmd+click` | Directly select a feature (skip the layer step) |
| `Cmd+drag` | Marquee directly to features (skip the layer step) |
| Click layer row in panel | Select that layer (same as single-click on canvas) |
| Shift+click layer row | Add layer to selection |
| Escape (features selected) | Clear feature selection, stay in layer |
| Escape (layer selected, no features) | Deactivate layer |

Once inside a layer (after double-click), subsequent single clicks select features within that layer without needing to double-click again. Escape exits back to the layer level.

Overlapping layers: single click selects the topmost rendered layer. To select a layer underneath, use the layers panel.

### Visual states on canvas

**Polygon layers:**
- Layer active: subtle tint over all features using the accent color at ~12–15% opacity
- Feature selected: full accent-color highlight (same as today)
- Both: faint tint on all features + strong highlight on selected ones — hierarchy reads naturally

**Line layers:**
- Layer active: faint halo (glow) behind all lines using the accent color at low opacity — mirrors the tint effect for polygons without adding a fill
- Feature selected: full accent-color stroke (same as today)

**Point layers:**
- Layer active: slight color shift toward accent on all points
- Feature selected: full accent-color highlight (same as today)

### Split action bar

The existing SelectionBar is extended into two sections:

```
[ Clip | Difference ]  |  [ Copy/Merge | Delete | Clear ]  ×
  ← layer actions  →       ← feature actions →
```

- Layer section is visible whenever a layer is active
- Feature section is visible whenever features are selected
- Either or both can be visible simultaneously
- Bar appears when at least one section has state; disappears when neither does

### Pros
- Canvas is the primary workspace for everything — no need to look at the panel
- Single interaction model (select mode) covers both levels
- Feels fluid when moving between layer and feature work
- Split bar makes both action types always discoverable

### Cons
- Double-click gate adds friction for feature selection (mitigated by `Cmd+click`)
- Visual layer-selected state on canvas needs careful implementation to not clutter the map
- More complex interaction model to learn and implement
- Figma users will feel at home; GIS tool users may find it unexpected

---

## Open questions (for both proposals)

- Should multi-selected layers in the panel share a layer action bar? (e.g. Clip layer A by layer B when both are selected)
- For Proposal B: does the "inside a layer" state persist across tool switches (pan → select → pan)? Or does switching tools reset to the layer level?
- Clip/Difference take two layer inputs — the second layer is always picked via a dialog/picker, not by clicking on the canvas in either proposal.
