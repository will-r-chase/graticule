# Mappy — Session Notes

A running scratchpad of decisions, learnings, and current state. Update this at the end of each session.

---

## Current State

The app is fully functional for the core cartography workflow:

- **Catalog panel** — datasets grouped by source, collapsible sections, search, type + region filters, uploaded datasets section
- **Layers panel** — add/remove/rename (dbl-click)/reorder (drag) layers, toggle visibility, per-layer style panel
- **Style panel** — fill/stroke color pickers (hex + alpha), toggles, stroke width, dash pattern, point size and shape (7 d3-shape symbols)
- **Map canvas** — Canvas 2D rendering, pan + zoom (mouse/trackpad/buttons), fit-to-extent, projection selector (full d3-geo + d3-geo-projection list)
- **Background control** — color + alpha picker for the map background
- **Custom data upload** — GeoJSON, TopoJSON, Shapefile (.zip), KML, KMZ, GPX, CSV (with lat/lon column picker), coordinate swap, geometry split
- **Export** — PNG and SVG, with clip-to-extent option and scale control
- **Save / Open projects** — serializes layers (styles, visibility, order), projection, background, uploaded GeoJSON to a `.json` file
- **Undo / Redo** — 50-entry snapshot history, `Cmd+Z` / `Cmd+Shift+Z`, toolbar buttons

---

## Architecture Decisions

### Canvas 2D, not SVG
SVG repaints the entire scene on any change. For complex geodata (Countries 10m etc.) this was unusably slow. We switched to Canvas 2D using `d3.geoPath(projection, ctx)`.

### Path2D caching
`d3.geoPath(projection)(data)` produces an SVG path string. We wrap that in a `Path2D` object and cache it per layer ID. Subsequent repaints just call `ctx.stroke(path2d)` — no reprojection.

Cache lives in a plain `Map<string, Path2D>` in `MapCanvas.svelte`, keyed by layer ID. A reactive `cacheVersion: number` counter signals the paint effect when new paths are ready.

Cache is invalidated and fully rebuilt when the projection changes (expected — all coordinates change).

### Layer data lives outside `$state`

**Critical.** GeoJSON must NOT be stored inside Svelte's `$state`.

Svelte 5's reactivity wraps `$state` values in deep reactive proxies. Any time an effect reads a reactive object, Svelte calls `deep_read()` internally — which recursively traverses every property of that object to establish tracking. For a Countries 10m GeoJSON with hundreds of thousands of coordinate pairs, `deep_read()` took ~1.7 seconds and blocked the main thread on every reactive update (including simple visibility toggles).

**The fix:**
- `layer.data` removed from the `Layer` type
- GeoJSON stored in `layerData: Map<string, unknown>` — a plain JS Map, exported from `layers.svelte.ts`, invisible to Svelte
- `layer.hasData: boolean` in `$state` is the reactive signal that data is ready
- The cache effect reads `layer.hasData` (cheap boolean) and then calls `layerData.get(id)` (plain Map, no tracking)

**General rule:** `$state` is for UI state — booleans, strings, short arrays of simple objects. Large data structures always live outside it.

### Two-effect pattern in MapCanvas

**Cache effect** — tracks `layer.hasData` and `projection`. Reads GeoJSON from the plain `layerData` Map. Computes Path2D for new layers only (`pathCache.has(id)` guard). Bumps `cacheVersion` when done.

**Paint effect** — tracks `layer.visible`, `layer.style.*`, and `cacheVersion`. Never reads `layer.hasData` or the GeoJSON. Just stamps cached `Path2D` objects onto the canvas with current styles.

This split means:
- Visibility toggle → only paint effect runs (fast bitmap ops)
- Style change → only paint effect runs (fast)
- New data loads → cache effect runs (path computation, expected cost), then paint
- Projection change → cache clears, cache effect recomputes all, then paint

---

## Key Files

```
app/src/
  lib/
    stores/
      layers.svelte.ts          — layers $state + layerData plain Map; addLayer(onStart, onComplete)
      catalog.svelte.ts         — catalog store (baseUrl + datasets)
      uploadedDatasets.svelte.ts — uploaded datasets catalog (separate from map layers)
      history.svelte.ts         — undo/redo stack, pushSnapshot/undo/redo/clearHistory
      projection.svelte.ts      — current projection id
      background.svelte.ts      — background hex + alpha
      mapState.svelte.ts        — shared canvas ref + pan/zoom state (used by export)
    components/
      map/
        MapCanvas.svelte        — canvas rendering, Path2D cache, two-effect pattern, pan/zoom
        BackgroundControl.svelte
      catalog/
        CatalogPanel.svelte
        DatasetItem.svelte
        UploadModal.svelte
      layers/
        LayersPanel.svelte      — dnd context, pickerOpen flag
        LayerItem.svelte        — style accordion, {#key historyVersion()} remount
        LayerStylePanel.svelte  — fill/stroke/dash/point controls; direct updateLayerStyle before pushSnapshot
      top-chrome/
        TopChrome.svelte        — New/Open/Save/Export + Undo/Redo buttons
      ui/
        ColorPicker.svelte
        ShapeSelect.svelte      — onchange passes selected id
        Combobox.svelte
    utils/
      export.ts    — buildSVGString, PNG export; d3-shape symbols for points
      project.ts   — prepareProject / loadProject (applyDefaults=false on load)
      fileUpload.ts
    types.ts    — Layer, Dataset, LayerStyle, Catalog interfaces
    config.ts   — PROJECTIONS, TYPE_FILTERS, SOURCE_CONFIG, POINT_SHAPES
  routes/
    +page.ts       — loads catalog.json from R2
    +page.svelte   — three-column layout, drag-and-drop file import, Cmd+Z/Shift+Z handler
```

---

## Known Issues / TODO

- **Initial load blocks main thread** — path computation (`d3.geoPath`) for large datasets runs synchronously. Fine for now; Web Workers are the eventual fix.
- **Projection change recomputes all paths** — correct and expected behaviour.
- **Rethink catalog panel layout** — search icon turns title into search box, filters open from button
- **Custom data upload** — how users upload their own shapefiles/GeoJSON
- **Collapsible source sections** in catalog
- **Fix Project Linework metadata** — admin level + region not correctly set; some 404s
- **Refine projection list** — curate/group by use case; allow custom projection params; auto-suggest based on geometry bbox
- **Style controls in layers panel** — fill/stroke color pickers, opacity, stroke width
- **Map interactions** — pan and zoom not yet implemented
- **Export** — SVG, GeoJSON, Shapefile
- **Save/load project** — serialize/deserialize store state
- **Multi-session support** — deferred

---

## Undo / Redo

### Architecture

Snapshot-based history using an "after" model: a snapshot is pushed **after** an action completes with its resulting state. The history stack is a plain array of `Snapshot` objects; a `pointer` integer tracks the current position.

```
stack: [S0, S1, S2, S3]
              ↑
           pointer=1   →  canUndo (pointer > 0)
                          canRedo (pointer < stack.length - 1)
```

**What a snapshot contains:**
- `layers[]` — a deep clone of the reactive layers array (id, name, visible, style, geometryTypes, hasData, loading, error)
- `projectionId` — the current projection string
- `bgHex` / `bgAlpha` — the background colour

**What is NOT in a snapshot:**
- `layerData` (the plain `Map<string, GeoJSON>`) — raw geodata is retained across undo/redo. `removeLayer` no longer calls `layerData.delete(id)`; only `clearLayers` does. When a layer is restored from a snapshot with `hasData: true`, the path cache effect detects the missing cache entry and recomputes from the still-present `layerData`.
- `pathCache` — always rebuilt on demand; never snapshotted.

**`pushSnapshot` guards:**
1. Clears the redo tail if `pointer < stack.length - 1` (new action abandons the future)
2. Deduplicates via `JSON.stringify` — skips if current state matches `stack[pointer]`
3. Caps the stack at 50 entries

**`restore(snapshot)`** splices `layers` in place (keeps the reactive reference intact), then sets `projection.id`, `background.hex`, and `background.alpha`.

**`canUndo` / `canRedo`** are exported as functions (not `$derived`) because Svelte 5 doesn't allow exporting derived state from `.svelte.ts` modules. They read the reactive `pointer` and `stack` so they're still reactive when called inside a component's reactive context.

---

### Async `addLayer` — avoiding a circular import

`layers.svelte.ts` must not import `history.svelte.ts` (circular dependency). Instead, `addLayer` accepts two optional callbacks:

```ts
addLayer(dataset, onStart?, onComplete?)
```

- `onStart` fires synchronously before any layer is pushed to the array → captures the **pre-add** state, giving style changes their own snapshot
- `onComplete` fires after the fetch and `setLayerData` → captures the **post-add** state

Callers pass `pushSnapshot` as both:
```ts
onclick={() => addLayer(dataset, pushSnapshot, pushSnapshot)}
```

Multi-sublayer datasets use a counter so `onComplete` only fires once all sublayers have loaded — the whole batch is one history entry.

---

### Style panel — timing and remount

**Timing problem:** `$effect`s in Svelte 5 are asynchronous (scheduled as microtasks). `LayerStylePanel` uses `$effect`s to sync local state → store. Calling `pushSnapshot()` synchronously in a toggle's onclick captures the *pre-effect* store state — so the snapshot is wrong and dedup silently drops it.

**Fix:** call `updateLayerStyle` directly in every handler that changes discrete values (toggles, blur on number inputs, shape dropdown) *before* calling `pushSnapshot()`. The `$effect`s still run afterwards as a no-op, preserving live-preview behaviour during continuous input (e.g. typing a number).

**Remount problem:** when `restore()` splices new layer objects into the array, `LayerStylePanel`'s local state (initialized from props at mount time) doesn't update — so the panel shows stale values even though the map canvas repaints correctly.

**Fix:** `LayerStylePanel` is wrapped in `{#key historyVersion()}` inside `LayerItem`. `historyVersion` is a counter in the history store that increments on every `undo`/`redo` call. This forces a clean remount, re-initializing local state from the freshly restored `layer.style`.

A cleanup `$effect` (`$effect(() => () => styleCtx.setPickerOpen(false))`) resets the drag-and-drop lock when the panel is destroyed by the remount.

---

### `pushSnapshot` inside `undo` — and why it needs a manual check

To support "undo while the colour picker is open" (mid-drag, no picker-close snapshot yet), `undo()` needs to flush any uncommitted state first. Naively calling `pushSnapshot()` inside `undo()` has a fatal flaw:

`pushSnapshot` clears the redo tail **before** the dedup check. So on every sequential undo — even with nothing to flush — it wipes future snapshots, destroying the redo history.

**Fix:** manually `capture()` the current state first and only call `pushSnapshot()` if it actually differs from `stack[pointer]`:

```ts
const current = capture();
if (JSON.stringify(current) !== JSON.stringify(stack[pointer])) {
    pushSnapshot(); // only when there are genuine uncommitted changes
}
pointer--;
restore(stack[pointer]);
```

---

### Other gotchas

**No initial snapshot → first action not undoable.** With the "after" model, the first action pushes `stack[0]` and `pointer = 0`. `canUndo = pointer > 0` is false — there's nothing to go back to. Fix: call `pushSnapshot()` on app init (in `+page.svelte`) and after `confirmNew` / `loadProject` in `TopChrome`, establishing an empty baseline at `stack[0]`.

**`removeLayer` was deleting from `layerData`.** Even though `removeLayer` was updated to keep data for undo, the `layerData.delete(id)` line was still in the file (the summary from the previous session was wrong about this). When a layer was removed and then restored via undo, `layerData` was empty and the path cache couldn't be rebuilt. Fix: remove the `layerData.delete(id)` call from `removeLayer`; only `clearLayers` should delete from it.

**Style changes grouped with layer adds.** If a colour picker is open while the user clicks a dataset to add it, `addLayer`'s `onComplete` captures both changes in one snapshot. Undo removes the layer *and* reverts the style. Fix: the `onStart` callback captures the pre-add state (including the in-progress colour change) as a separate entry, so each action undoes independently.

**Picker-open flag stuck, breaking drag-and-drop.** `LayersPanel` sets `pickerOpen = true` via context when a colour picker opens, and disables `svelte-dnd-action` while it's true. When the stroke toggle was turned off while the picker was open, the toggle's onclick set `activePicker = null` but forgot to call `styleCtx.setPickerOpen(false)`. The drag-and-drop cursor appeared but items never moved. Fix: always pair `activePicker = null` with `styleCtx.setPickerOpen(false)`.

---

## Session: Topology-First Pipeline + Processing Panel

### What Was Built

**Topology-first rendering pipeline**

The previous architecture stored GeoJSON in a `layerData` plain Map and called `feature()` (TopoJSON → GeoJSON) once at load time, caching the result. This was refactored to keep topology as the source of truth throughout:

- `layerData` / `hasData` removed from the codebase entirely
- Two plain Maps in `layers.svelte.ts`: `rawTopologyData` (original fetched topology, never mutated) and `workingTopologyData` (output of the processing pipeline — simplifed / Chaikin'd)
- `layer.hasTopology: boolean` replaces `layer.hasData` as the reactive signal
- `runLayerPipeline(id, applyDefaults)` reads from `rawTopologyData`, runs simplification → Chaikin, writes to `workingTopologyData`, sets geometry types directly from topology objects (no `feature()` call needed), then sets `hasTopology = true`
- In MapCanvas's pathCache effect, `feature()` is called inline (temporarily) to convert `workingTopologyData` → GeoJSON for `d3.geoPath`. The result is never stored — it's used to build a `Path2D` and then GC'd

**Processing pipeline**

`runLayerPipeline` runs two steps in sequence:
1. **Simplification** — Mapshaper `applyCommands` (async, topology-aware); `simpAlgorithm`, `simpTolerance`, `simpWeight`, `simpKeepShapes`
2. **Chaikin smoothing** — `applyChaikinToTopology` (sync); `chaikinIterations`

`updateLayerProcessing(id, patch, onComplete?)` applies a patch to `layer.processing`, sets `hasTopology = false` (signals pathCache to drop the stale entry), sets `loading = true`, then calls `runLayerPipeline(id, false).then(() => onComplete?.())`. The `onComplete` pattern ensures `pushSnapshot()` only fires after the pipeline resolves — critical because Mapshaper is async, and calling `pushSnapshot` synchronously would capture the transient `hasTopology=false` loading state as a ghost undo entry.

**Bezier rendering**

`buildBezierArcs` + `buildTopoPath` from `utils/bezier.ts` were wired into the pathCache effect in MapCanvas. Bezier lives in the pathCache (not in `runLayerPipeline`) because it operates in screen space — it needs the projection to project arc coordinates before computing control points. When `layer.processing.bezierEnabled` is true, the pathCache branches to `buildBezierArcs(topo, projection, ...)` → `buildTopoPath(topo, bezierArcs)` instead of the `feature()` → `d3.geoPath` path. `buildTopoPath` was extended to handle `LineString` and `MultiLineString` in addition to polygons (with a `close` parameter on `arcRingToPath` to suppress the `Z` for lines).

**Layer processing panel UI**

`LayerProcessingPanel.svelte` added with controls for all three processing stages. The layer accordion in `LayerItem` now has a **Style / Simplification** tab bar. Tab state is local to `LayerItem` (`let activeTab = $state<'style' | 'simplification'>('style')`).

Simplification tab controls:
- Simplify toggle → Algorithm select (Weighted / Visvalingam / Douglas-Peucker) → Tolerance slider (0–100%) → Weight slider (0–1, weighted only) → Keep shapes toggle
- Smooth toggle → Iterations (1–4)
- Bezier toggle → Curve type select → Tension slider → Alpha (Catmull-Rom only) / Continuity + Bias (KB only)

---

### Known Bugs (deferred to separate sessions)

**US Counties (TIGER file) doesn't render correctly**

Adding the US Counties dataset causes other layers to visually disappear when Counties is at the bottom of the layer list (i.e., drawn last / on top). The root cause is the white polygon fill: Counties is a polygon layer so it gets `fill: '#ffffff'` by default, and when drawn on top it covers underlying layers. The county borders themselves are sub-pixel and invisible at world scale (the projection is fitted to the full sphere).

`fitToExtent` doesn't zoom to the counties correctly. The dataset includes Alaska's Aleutian Islands, which are stored at ~172°E positive longitude. On a world Mercator projection, this puts them on the far right of the canvas while the continental US is on the left — the bounding box spans most of the canvas width, so the computed scale is barely above 1 and the center lands over the Pacific. Investigation was inconclusive; will be diagnosed separately.

**Undo doesn't visually revert simplification changes**

Toggling simplification on/off and changing the algorithm correctly undo. But changing Tolerance, Weight, or Keep shapes doesn't properly revert — there's a phantom extra undo step where the layer disappears from the canvas before reappearing. This happens even after the pipeline has visibly completed. The cause was not identified; multiple theories (race condition, ghost snapshot timing, pathCache not invalidated after restore) were investigated but none confirmed. Will be diagnosed separately. The `history.svelte.ts` file is unchanged from before this session.

---

## Svelte 5 Patterns We Use

- `$state` / `$derived` / `$derived.by` / `$effect` (no stores, no writable)
- Stores are `.svelte.ts` files exporting `$state` objects + mutation functions
- Never reassign exported `$state` — mutate properties instead
- `svelte-dnd-action` for drag-to-reorder (pass `dropTargetStyle: {}` to suppress green indicator)
- `phosphor-svelte` for icons — add `ssr: { noExternal: ['phosphor-svelte'] }` to vite.config.ts
