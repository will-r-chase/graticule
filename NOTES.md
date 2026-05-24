# Mappy — Session Notes

A running scratchpad of decisions, learnings, and current state. Update this at the end of each session.

---

## Current State

The core app is working:
- **Catalog panel** — datasets grouped by source, search, type + region filters
- **Layers panel** — add/remove/rename/reorder (drag) layers, toggle visibility
- **Map canvas** — Canvas 2D rendering with projection selector, layers render correctly

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
      layers.svelte.ts   — layers $state + layerData plain Map
      catalog.svelte.ts  — catalog store (baseUrl + datasets)
    components/
      map/MapCanvas.svelte       — canvas rendering, Path2D cache, two-effect pattern
      catalog/CatalogPanel.svelte
      layers/LayersPanel.svelte
      layers/LayerItem.svelte
    types.ts    — Layer, Dataset, LayerStyle, Catalog interfaces
    config.ts   — PROJECTIONS, TYPE_FILTERS, SOURCE_CONFIG etc.
  routes/
    +page.ts       — loads catalog.json from R2
    +page.svelte   — three-column layout
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

## Svelte 5 Patterns We Use

- `$state` / `$derived` / `$derived.by` / `$effect` (no stores, no writable)
- Stores are `.svelte.ts` files exporting `$state` objects + mutation functions
- Never reassign exported `$state` — mutate properties instead
- `svelte-dnd-action` for drag-to-reorder (pass `dropTargetStyle: {}` to suppress green indicator)
- `phosphor-svelte` for icons — add `ssr: { noExternal: ['phosphor-svelte'] }` to vite.config.ts
