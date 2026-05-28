# Mappy — TODO

---

## 🔴 Top Priorities

- [ ] **Globe / orthographic mode** — `geoOrthographic` is already in the projection list but the interaction is wrong: dragging currently translates tx/ty rather than rotating the projection. A proper globe needs drag-to-rotate updating `projection.rotate([λ, φ])`, which is a fundamentally different interaction model from flat-map pan. Needs its own mode: detect when an orthographic-family projection is active and switch to rotation-based drag. Back-face clipping is handled automatically by d3-geo.

- [x] **Undo / Redo** — snapshot-based history stack (50 entries). Covers layer add/remove, style changes, projection, background, visibility, rename, reorder. `Cmd+Z` / `Cmd+Shift+Z` keyboard shortcuts plus Undo/Redo buttons in the toolbar. See Notes.md for architecture details and gotchas.

- [x] **Custom data upload** — design and implement how users upload their own shapefiles, GeoJSON, etc.
- [x] **Export PNG / SVG** — rasterization and SVG export.
- [x] **Save / Open projects** — persist and reload project state (layers, styles, projection).

---

## Data Improvements

- [ ] **Add more data sources** — GADM (global sub-national, non-commercial), OpenStreetMap via Geofabrik, UN OCHA COD / HDX (humanitarian), Statistics Canada, ABS (Australia), IBGE (Brazil), country-specific authoritative sources for deeper regional coverage. GADM is a pipeline challenge at 2.5GB — needs per-country workflow or separate scheduled job.
- [ ] **Dataset hover thumbnails** — generate a pre-rendered image snapshot for each dataset in the pipeline and upload to R2. Show on hover in the catalog so no data fetch is needed at hover time.
- [ ] **Geodata export formats** — GeoJSON (straightforward, data is already WGS84 internally), TopoJSON (via topojson-server), Shapefile (via GDAL WASM; most-requested among non-web GIS users).
- [ ] **Scale filter** — expose 10m / 50m / 110m as a catalog filter once the UX pattern is clear.

---

## Layer Styling Improvements

- [ ] **Simplification** — global simplification setting affecting all layers, with optional per-layer override. Global is simpler UX; per-layer gives control for mixed-scale datasets.
- [ ] **Local simplification** — apply different simplification levels to different geographic areas within the same layer (e.g. preserve detail on a narrow peninsula while aggressively simplifying a long straight coastline). Requires interaction primitives for defining regions — probably a brush or polygon-draw tool on the canvas. Defer until the interaction model is clearer.
- [ ] **Curve styles** — control the feel of linework beyond simplification: curved/organic, hand-drawn, sharp/geometric. Algorithm design is an open research question.
- [ ] **More line styles** — additional stroke treatments based on or inspired by simplification (e.g. tapered lines, variable weight).
- [ ] **Duplicate a layer** — copy a layer with its current style as a new independent layer.
- [ ] **Labeling concept** — how labels work as a first-class feature: place names from bundled sources, smart default placement (collision-aware, scale-appropriate).
- [ ] **Label matching** — match a custom name list to features in a layer; normalize across sources.
- [ ] **Direct label editing and dragging** — manual override for label placement and formatting directly on the canvas.
- [ ] **Saved color swatches** — reuse recent/favorite colors across layers.
- [ ] **Collapsible sidebars** — collapse data and layers panels to give more canvas space.

---

## Intelligent Features

- [ ] **Detect CRS and reproject on import** — detect non-WGS84 coordinate systems from `.prj` file or coordinate range heuristics, automatically reproject to WGS84. Explore proj4js or WASM-based approach. Currently surfaced as a warning only.
- [ ] **Repair data issues on import** — fix common GIS data quality problems: corrupted GeoJSON, invalid geometry (self-intersections, unclosed rings), duplicate vertices, winding order, coordinate precision, interrupted projection artifacts (horizontal lines at lobe cuts). Explore existing libraries as building blocks.
- [ ] **Auto projection based on geometry** — detect the geographic extent of loaded data and suggest or automatically apply a sensible projection (e.g. Albers for US, Robinson for world). Leave a UI hook in the projection selector.
- [ ] **Allow custom projection parameters** — let users enter center, rotation, parallels, etc. for the current projection.

---

## Improved GIS Operations

- [ ] **Interactive feature selection** — click a shape on the canvas to select it; inspect its properties. Foundation for all other feature-level operations.
- [ ] **Interactive feature editing** — modify vertex positions directly on the canvas.
- [ ] **Split, merge, dissolve** — operate on selected features: split into a new layer, merge with another, dissolve internal boundaries.
- [ ] **Draw custom lines** — freehand or point-by-point line drawing directly on the canvas, creating a new layer.
- [ ] **Clip to named feature** — use a selected feature as a mask to clip all other layers to its boundary.
- [ ] **Bounding box clip** — draw a clip rectangle directly on the canvas.
- [ ] **Attribute table** — tabular view of all features and properties in a layer.

---

## 🌊 Special Feature: Water Lines

Complexity management for water features — rivers, coastlines, lakes. Two interrelated problems:

- **Too much detail** — rivers and coastlines at high resolution create visual clutter. Need tools to simplify or filter below a complexity/size threshold.
- **Island filtering** — remove islands below a size threshold to reduce noise, or flag very small islands as data quality issues for inspection.
- **Water line buffers** — generate buffer zones around water features as a cartographic styling tool (useful for visual depth and shore glow effects).

These likely need to be designed together as a coherent water-handling workflow rather than three independent tools.

---

## Engineering / Infrastructure

- [ ] **Fix Node.js 20 deprecation warning** in GitHub Actions (minor, non-blocking).
- [ ] **IndexedDB autosave** — recovery buffer for accidental tab closure. Not the canonical save, just a safety net. PRD calls for this but it was deferred.
- [ ] **Auto-simplification toast — copy and styling** — revisit the wording and visual design of the toast shown when a large dataset is auto-simplified on load.
- [ ] **Simplification panel styling** — the Process panel (simplify / smooth / bezier) needs visual polish to match the rest of the layer settings UI.
- [ ] **Rendering performance: viewport culling** — skip features whose bounding box falls entirely outside the current viewport before building Path2D. Significant win for large datasets at high zoom.
- [ ] **Rendering performance: duplicate pixel detection** — skip `lineTo` calls where consecutive projected coordinates round to the same half-pixel, matching Mapshaper's `drawPath2` strategy. Reduces Path2D command count dramatically at low zoom on dense datasets.

---

## Future / Platform

- [ ] **Non-linework data layers** — landcover, elevation, points of interest, data visualization overlays.
- [ ] **Auth and user profiles** — only if server-side project saving or sharing becomes necessary.
- [ ] **Mobile layout** — desktop-first; mobile explicitly deferred.
- [ ] **Sharing / permalink** — encode project state in a URL for sharing.
- [ ] **Dark mode**
