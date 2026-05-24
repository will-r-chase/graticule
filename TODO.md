# Mappy — TODO

Items deferred from MVP scope. Not prioritized within sections.

---

## UX / Features

- [ ] **Refine list of projections** — curate the projection list, potentially grouping or sorting by use case rather than showing all at once.
- [ ] **Allow custom projections** — let users enter custom projection parameters (center, rotation, parallels etc.).
- [ ] **Auto projection based on geometry** — detect the geographic extent of loaded data and suggest or automatically apply a sensible projection.

- [ ] **Graticules** — reference grid lines (lat/lon or custom interval) overlaid on the map canvas
- [ ] **Canvas background color** — let users set the background (ocean) fill color; potentially a gradient
- [ ] **Suggested projections** — recommend a sensible projection based on the loaded data's geographic extent (e.g. Albers for US data, Robinson for world maps). Leave a UI hook in the projection selector.
- [ ] **Saved color swatches** — reuse recent/favorite colors across layers
- [ ] **Clip to named feature** — click a feature in the loaded dataset to clip all other layers to its boundary
- [ ] **Bounding box draw tool** — draw a clip rectangle directly on the canvas
- [ ] **Feature click / inspect** — click a shape to see its properties
- [ ] **Attribute table** — tabular view of all features and properties in a layer
- [ ] **Labeling** — place names from bundled sources, custom name list upload, collision-aware placement, manual override
- [ ] **Aesthetic linework styling** — control the feel of linework beyond simplification (curved/organic, hand-drawn, sharp/geometric)

---

## Data / Catalog

- [ ] **Rethink data panel layout** — explore alternative UX: search icon converts the title into a search box, filters open from a button that reveals a panel rather than always being visible.
- [ ] **Custom data upload** — design and implement how users upload their own shapefiles, GeoJSON, etc. into the app. Consider format support, projection detection, and how it integrates with the layers panel.
- [ ] **Collapsible source sections in catalog** — make each data source section (Natural Earth, TIGER, etc.) collapsible, with preview text showing the dataset count when collapsed (e.g. "23 datasets").
- [ ] **Fix Project Linework metadata** — admin level and geographic region are not correctly set for Project Linework datasets in the pipeline. Needs investigation and a pipeline re-run.
- [ ] **Scale filter** — expose 10m / 50m / 110m as a filter in the catalog once the UX pattern for it is clear. For now, users implicitly get the best available scale.
- [ ] **GADM** — global sub-national boundaries (400k+ areas). Too large (2.5GB compressed) for the current CI pipeline. Options: per-country download workflow, separate scheduled job, or on-demand fetch. Licensing note: GADM is non-commercial only.
- [ ] **OpenStreetMap admin boundaries** — via Geofabrik extracts. Good global coverage, ODbL license (attribution required).
- [ ] **UN OCHA COD / HDX** — humanitarian boundary data; better coverage for Africa and Middle East.
- [ ] **Statistics Canada** — authoritative Canadian sub-national boundaries.
- [ ] **ABS (Australian Bureau of Statistics)** — authoritative Australian boundaries.
- [ ] **IBGE (Brazil)** — authoritative Brazilian boundaries.
- [ ] **Country-specific authoritative sources** — for deeper regional coverage beyond Natural Earth.

---

## Export

- [ ] **PNG / JPG export** — rasterize SVG at canvas dimensions. Requires care around font rendering and SVG filters.
- [ ] **Inline styles for SVG** — convert presentation attributes to `style=""` attributes for better Illustrator compatibility.

---

## Engineering / Infrastructure

- [ ] **Fix Node.js 20 deprecation warning** in GitHub Actions (minor, non-blocking).
- [ ] **Interrupted projection artifacts** — horizontal lines appear where polygons cross the interruption cuts. Fix likely lives in the pipeline: use GDAL (e.g. `ogr2ogr` with clip polygons) to pre-split geometries along each projection's lobe boundaries so the data is interruption-aware before it reaches the client.
- [ ] **GADM pipeline approach** — per-country downloads or separate workflow to avoid 2.5GB single-file problem.
- [ ] **Thumbnail generation** — generate SVG preview thumbnails for each dataset in the pipeline and upload to R2. Used for catalog card previews in the app.

---

## Future / Platform

- [ ] **Non-linework data layers** — landcover, elevation, points of interest, data visualization overlays
- [ ] **Complex GIS operations panel** — expose GDAL/Turf operations beyond the core linework workflow
- [ ] **Auth and user profiles** — only if server-side project saving or sharing becomes necessary
- [ ] **Mobile layout** — app is desktop-first; mobile is explicitly deferred
- [ ] **Sharing / permalink** — encode project state in a URL for sharing
- [ ] **Dark mode**
