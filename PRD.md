# Mappy — Product Requirements Document

## Overview

Mappy is a browser-based tool that gives cartographers, data journalists, designers, and data analysts easy, flexible access to the geographic linework they need to make beautiful maps — without requiring GIS expertise.

The core insight is that getting good basemap linework is deceptively hard: sources are fragmented, formats are arcane, and customization requires specialized tools most target users don't have. Mappy abstracts all of that.

---

## Target Users

- Data visualization practitioners
- Cartographers
- Data journalists
- Designers
- Data analysts

**Common thread:** wants to make a well-crafted map, not a GIS expert. May have struggled in the past with finding the right data, dealing with projections, or wrestling with GIS file formats.

---

## Problem Statement

1. **Discovery** — Linework sources are fragmented (Natural Earth, OSM, TIGER, GADM, and others). Each has different coverage, scale, detail levels, and quirks. Finding the right data for a specific use case is non-trivial.

2. **Customization** — Once you have linework, projecting it correctly, clipping to an area of interest, and editing specific shapes requires GIS expertise and tools like QGIS or command-line GDAL/Mapshaper.

3. **Stylistic control** — Algorithmic simplification (e.g. Douglas-Peucker) is blunt. It loses detail where you want it and keeps it where you don't. More importantly, it doesn't allow aesthetic shaping — users often want maps with a curved, hand-drawn, or sharp feeling. This is an underserved problem.

4. **Labeling** — Place names come in inconsistent formats across sources. Matching custom name lists to shapes is tedious. Placement is hard to get right and hard to customize.

---

## Principles

- **File-over-app** — Whatever a user does in Mappy, they can take with them. No lock-in. Outputs are standard, interoperable formats.
- **No backend** — All compute runs in the browser. No servers, no accounts, no data leaving the user's machine.
- **No auth (for now)** — Users come, get what they need, and leave. No login required.
- **Interoperability first** — Mappy is a helpful tool in a larger workflow, not a platform to replace it.

---

## Technical Architecture

### Repo Structure
Single monorepo with two top-level directories:
```
mappy/
├── app/        # SvelteKit application
└── pipeline/   # Python data pipeline + GitHub Actions
```

### Frontend Stack
| Technology | Role |
|---|---|
| **SvelteKit** (adapter-static) | App framework, routing, static build for Cloudflare Pages |
| **Svelte 5** (runes) | UI components and reactivity |
| **TypeScript** | Type safety across all app code |
| **Vite** | Build tooling (bundled with SvelteKit) |
| **Plain CSS** | Scoped component styles, no utility framework |

### GIS / Rendering Libraries
| Library | Role |
|---|---|
| **GDAL WASM** | Authoritative coordinate transformation, reprojection, format import/export. Industry standard — guarantees correctness for all projections including obscure ones. |
| **D3-geo** | Display only — projects WGS84 coordinates to screen coordinates for interactive SVG rendering. Fast and SVG-native. |
| **Mapshaper** (browser build) | Simplification, topology operations, format conversion |
| **Turf.js** | Geometric operations — clipping, dissolve, union, etc. |
| **topojson-client/server** | TopoJSON encoding/decoding |

**Projection strategy:** Data is stored internally in WGS84. D3-geo handles live display (WGS84 → screen). GDAL handles authoritative reprojection on export and for any projection D3 doesn't support. If a user selects an obscure projection, GDAL transforms the coordinates first and D3 renders the result as straight paths.

Heavy GIS operations run in **Web Workers** to keep the UI thread responsive.

### Persistence
- **Project file** — canonical save format is a downloadable `.json` (or `.mappy`) file capturing all state: loaded layers, styling choices, projection, label config, etc. Users own this file on their own disk. Primary persistence mechanism; aligns with file-over-app philosophy.
- **IndexedDB** — autosave/recovery buffer only. Not the canonical save, just a safety net against accidental tab closure.
- No server-side storage, no user accounts.

### Data Pipeline

The app's bundled datasets are not fetched from source APIs at runtime. Instead, a separate automated pipeline fetches, processes, and hosts the data on Mappy's own CDN. The app fetches from the CDN.

**Why not runtime API fetching:**
- Source APIs (OSM Overpass, etc.) are slow and have rate limits
- CORS restrictions vary by source
- APIs change or go down — fragile dependency for a core feature
- Latency is unacceptable for an interactive tool

**Why not a manual static dump:**
- Administrative boundaries barely change (countries: rarely, states: almost never)
- Quarterly automated refresh is more than sufficient
- Manual updates are a maintenance burden to avoid

#### Pipeline Tech
- **Python** — GIS processing ecosystem is unmatched (GeoPandas, Fiona, PyProj, Shapely, topojson)
- Runs entirely on GitHub Actions (Ubuntu runners have Python pre-installed) — no local Python setup required
- Scripts live in `pipeline/` directory of the monorepo

#### Pipeline Directory Structure
```
pipeline/
├── custom/                  # Drop custom shapefiles/GeoJSONs here
│   └── README.md            # Instructions + metadata format
├── sources/
│   ├── natural_earth.py
│   ├── tiger.py
│   ├── osm.py
│   ├── gadm.py
│   ├── eurostat.py
│   └── custom.py            # Processes files from custom/
├── process.py               # Shared normalization functions
├── upload.py                # R2 upload logic
├── catalog.py               # Builds catalog.json from processed datasets
├── run.py                   # Main entry point (runs all sources)
└── requirements.txt
```

#### Pipeline Steps
1. **Fetch** — each source module pulls from its canonical location (Natural Earth GitHub releases, Census TIGER FTP, Geofabrik OSM admin extracts, GADM download API, Eurostat GISCO API)
2. **Process** — reproject to WGS84, convert to TopoJSON, simplify at multiple resolution levels (coarse/medium/fine), normalize and clean feature properties
3. **Catalog** — generate `catalog.json`: a master index of every available dataset with metadata (name, source, scale, region coverage, admin level, file URLs, etc.). The app fetches this on load to populate the discovery UI.
4. **Publish** — upload all output files + catalog.json to Cloudflare R2 under a versioned path
5. **Schedule** — GitHub Actions cron runs quarterly; can also be triggered manually via `workflow_dispatch`

#### Output Structure on R2
```
mappy-geodata/
├── catalog.json
├── natural-earth/
│   ├── admin-0-countries/
│   │   ├── ne_10m.topojson
│   │   ├── ne_50m.topojson
│   │   └── ne_110m.topojson
│   └── admin-1-states-provinces/
│       ├── ne_10m.topojson
│       └── ne_50m.topojson
├── tiger/
│   ├── states.topojson
│   └── counties.topojson
├── osm/
│   └── admin-boundaries.topojson
├── gadm/
│   └── [iso-country-code]/
│       ├── level-0.topojson
│       ├── level-1.topojson
│       └── level-2.topojson
├── eurostat/
│   ├── nuts-1.topojson
│   ├── nuts-2.topojson
│   └── nuts-3.topojson
└── custom/
    └── [dataset-name].topojson
```

#### Adding Custom Files
Custom shapefiles or GeoJSONs go in `pipeline/custom/`. Each dataset needs a companion `[name].meta.json` file describing it (name, description, scale, tags, region, etc.) so it appears correctly in the app's catalog. The pipeline processes custom files exactly like programmatic sources and uploads them to R2 under `custom/`. To add a new custom dataset: drop the file + metadata into `pipeline/custom/`, commit, push, and either wait for the next scheduled run or manually trigger the pipeline in GitHub Actions.

#### Hosting Stack (all free tier)
| Service | Role | Free Tier |
|---|---|---|
| **Cloudflare R2** | Processed data storage + serving | 10GB storage, no egress fees |
| **Cloudflare Pages** | App hosting (Svelte static build) | Unlimited requests, 500 builds/month |
| **GitHub Actions** | Pipeline automation | Free for public repos |

R2 is preferred over S3 specifically because it has **no egress fees** — since every user session fetches data files, per-GB download costs would accumulate even at hobby traffic levels.

#### Estimated Data Sizes (processed TopoJSON)
- Natural Earth admin boundaries (all scales): ~10–20MB
- US Census TIGER (states + counties): ~5–15MB
- OSM admin boundaries extract: ~10–20MB
- GADM (all countries, levels 0–2): ~30–50MB
- Eurostat NUTS (levels 1–3): ~5–10MB
- Custom/hand-drawn sources: negligible
- **Total: ~70–120MB** — well within R2 free tier (10GB)

#### One-Time Manual Setup (what you need to do)

**1. Cloudflare R2**
- Create a free Cloudflare account at cloudflare.com
- Go to R2 → Create bucket, name it `mappy-geodata`
- In bucket settings, enable **Public Access** (so the app can fetch files without auth)
- Go to R2 → Manage R2 API Tokens → Create token with **Object Read & Write** permissions
- Note down: Account ID, Access Key ID, Secret Access Key, Bucket Name

**2. GitHub Actions Secrets**
- In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret
- Add four secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- The pipeline workflow reads these at runtime — you never hard-code credentials

**3. Cloudflare Pages (app hosting)**
- In Cloudflare dashboard: Pages → Create project → Connect to GitHub repo
- Set build command: `cd app && npm run build`
- Set output directory: `app/.svelte-kit/output` (or `app/build` depending on adapter config)
- Cloudflare auto-deploys on every push to `main`

**4. Adding your custom files**
- Drop your shapefiles or GeoJSONs into `pipeline/custom/`
- Create a `[filename].meta.json` alongside each one (format TBD when we build the pipeline)
- Commit and push — then manually trigger the pipeline in GitHub Actions (Actions tab → select workflow → Run workflow)

---

## Data Sources

### Phase 1 Sources

| Source | Coverage | License | Fetch Method |
|---|---|---|---|
| **Natural Earth** | World/country/region, multiple scales | Public domain | GitHub releases (versioned) |
| **OpenStreetMap** | Global, detailed admin boundaries | ODbL (attribution required) | Geofabrik extracts |
| **US Census TIGER** | US states, counties, sub-county | Public domain | Census FTP |
| **GADM** | Sub-national admin boundaries globally (400k+ areas, all countries, multiple levels) | Free, non-commercial only | GADM download API |
| **Eurostat NUTS** | EU administrative/statistical regions (NUTS 1/2/3 hierarchy) | CC BY 4.0 (attribution required) | Eurostat GISCO API |
| **Custom** | Hand-drawn and curated linework (Mappy team) | Owned | Manually added to repo |

**Licensing note:** GADM's non-commercial clause means if Mappy ever monetizes, this source must be revisited or replaced with an alternative (e.g. OSM-derived admin boundaries).

### Future Sources (TODO)
- **UN OCHA COD / HDX** — humanitarian boundary data; better coverage for parts of Africa and Middle East underserved by other sources
- **Statistics Canada** — authoritative Canadian sub-national boundaries
- **ABS (Australian Bureau of Statistics)** — authoritative Australian boundaries
- **IBGE (Brazil)** — authoritative Brazilian boundaries
- Country-specific authoritative sources for deeper regional coverage

### Scale Focus
- Primary: administrative boundaries — countries, states/provinces, regions
- Future: neighborhoods, cities, more granular detail

### Source Discovery UI
Inspired by font browsing sites (e.g. Google Fonts): users can filter by objective properties (scale, region, data source) but also by aesthetic/feel ("clean", "detailed", "hand-drawn"). Thumbnail previews are central to the experience. Experienced users can search directly; casual users browse filtered previews. **To be designed in detail when this feature is tackled.**

---

## MVP Architecture

### User Flow

Two entry points, same editor:

**Entry point A — Catalog:**
1. App loads → catalog panel open by default, map canvas visible behind it
2. Browse, filter, search datasets with thumbnail previews
3. Select a dataset → loads into editor, catalog panel dismisses, live preview appears
4. Adjust projection, simplification, clip, canvas size (all live preview)
5. Export or save project

**Entry point B — Upload:**
1. Click upload → drop any file (any format, any projection)
2. App normalizes to WGS84 internally, loads into editor
3. Same modify/export flow as above

Settings (projection, simplification, clip, canvas size) persist if the user reopens the catalog to swap datasets.

### UI Layout

Single-page app. No navigation routes needed for MVP.

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar: [Mappy] [Open Catalog] [Upload] [Save] [Load] │
├───────────────────────────┬─────────────────────────────┤
│                           │                             │
│       Map Canvas          │       Tools Panel           │
│    (SVG, live preview)    │                             │
│                           │  ├ Projection               │
│                           │  ├ Simplification           │
│                           │  ├ Clip / AOI               │
│                           │  ├ Canvas Size              │
│                           │  └ Export                   │
│                           │                             │
└───────────────────────────┴─────────────────────────────┘

Catalog panel slides in over the left side when opened.
```

### Component Tree

```
App
├── Toolbar
│   ├── CatalogToggleButton
│   ├── UploadButton
│   ├── SaveProjectButton
│   └── LoadProjectButton
├── CatalogPanel (collapsible overlay, left)
│   ├── SearchBar
│   ├── FilterControls (region, admin level, source, scale, feel)
│   └── DatasetGrid
│       └── DatasetCard (thumbnail preview + metadata)
├── MapCanvas (center)
│   └── SvgRenderer (D3-geo, reactive to project store)
└── ToolsPanel (right)
    ├── ProjectionControl
    │   ├── ProjectionSearch
    │   └── ProjectionParameters (center, rotate, etc.)
    ├── SimplificationControl
    │   └── ToleranceSlider
    ├── ClipControl
    │   ├── BBoxDrawer (draw on canvas)
    │   └── FeatureSelector (pick named feature from loaded data)
    ├── CanvasControl
    │   ├── DimensionInputs (width × height)
    │   └── FitToContentButton
    └── ExportControl
        ├── FormatSelector (SVG / PNG / JPG / GeoJSON / TopoJSON / Shapefile)
        └── ExportButton
```

### Data Model

Designed for multi-layer from day one, even though the MVP UI only exposes one layer.

```typescript
interface Project {
  version: string
  layers: Layer[]           // array now; UI adds multi-layer controls later
  projection: ProjectionConfig
  simplification: SimplificationConfig
  clip: ClipConfig | null
  canvas: CanvasConfig
}

interface Layer {
  id: string
  name: string
  source: LayerSource
  data: TopoJSON.Topology   // always stored in WGS84 internally
  visible: boolean
  // styling properties added here in Phase 2
}

interface LayerSource {
  type: 'catalog' | 'upload'
  catalogId?: string        // e.g. "natural-earth/admin-0-countries/ne_50m"
  fileName?: string         // original filename if uploaded
  originalProjection?: string  // CRS of uploaded file before normalization
}

interface ProjectionConfig {
  id: string                // D3 projection name e.g. "naturalEarth1"
  parameters: {
    center?: [number, number]
    rotate?: [number, number, number]
    scale?: number
    // etc.
  }
}

interface SimplificationConfig {
  tolerance: number         // 0–1, passed to Mapshaper
}

interface ClipConfig {
  type: 'bbox' | 'feature'
  bbox?: [number, number, number, number]  // [minLng, minLat, maxLng, maxLat]
  featureId?: string
}

interface CanvasConfig {
  width: number
  height: number
  padding: number
}
```

The **project `.json` file** is a direct serialization of `Project` (minus the `data` field on each layer — that's re-fetched from the catalog or re-uploaded). This keeps project files small and human-readable.

### State Management

Three Svelte stores:

| Store | Contents | Notes |
|---|---|---|
| `projectStore` | `Project` object — the full editor state | Writable; drives all live preview |
| `catalogStore` | Parsed `catalog.json` from R2 | Fetched once on app load, read-only |
| `uiStore` | Catalog open/closed, active tool panel, loading states | UI-only, not persisted |

### Undo / Redo

**This is a first-class feature, not an afterthought.**

Every user action that changes map state (adding/removing a layer, changing a style, adjusting projection, reordering layers, etc.) must push a snapshot to the undo stack. When designing or implementing any new feature, the first question to ask is: *"what gets pushed to the undo stack here, and can it be cleanly reversed?"*

Implementation: a capped history stack of serialized `{ layers, projection, canvas }` snapshots (not geometry — just parameters). Max depth ~50. Keyboard shortcuts: `Cmd+Z` / `Cmd+Shift+Z`.

**Rule: if a user action changes visible output, it must be undoable.**

---

### Processing Model — Non-Destructive

Transformations are **never applied destructively to stored data.** The layer always holds the original WGS84 geometry. Every change to projection, simplification, or clip updates the store parameters, and the renderer re-derives the display output reactively.

| Operation | Live preview | Export |
|---|---|---|
| Projection | D3-geo (fast, display only) | GDAL WASM (authoritative) |
| Simplification | Mapshaper in Web Worker | Mapshaper in Web Worker |
| Clipping | Turf.js (fast, display) | GDAL WASM (authoritative) |
| Format conversion | — | GDAL WASM |

This means:
- Changing projection never mutates geometry
- Project files stay small (parameters only, not processed output)
- Export always produces authoritative output regardless of display shortcuts

### Projections

Full list of D3-geo projections available, exposed via a searchable list. Sorted by frequency of use for casual browsing. Suggested projections based on the data's geographic extent (e.g. Albers for US, Robinson for world maps) is a future enhancement — leave a hook for it in the UI design.

---

## Features

### Phase 1 — MVP

#### Catalog Browse (entry point A)
- App fetches `catalog.json` from R2 on load
- Browse datasets with thumbnail SVG previews
- Filter by: region, data type (semantic), data source
- Regions: World, Africa, Asia, Europe, North America, South America, Oceania, USA
- Data type filter uses plain-language labels ("Countries", "Roads", "Counties", "Rivers", etc.) — not technical admin-level codes. Goal: non-experts can find what they want without knowing GIS terminology.
- Search by name
- Select a dataset to load it into the editor

#### Upload (entry point B)
- Accept any file format (GeoJSON, Shapefile, KML, TopoJSON, GPX, etc.)
- Detect or prompt for source projection, reproject to WGS84 via GDAL WASM
- Load into editor identically to a catalog selection

#### Projection
- Full searchable list of D3-geo projections
- Live preview (D3-geo, instant)
- Adjustable parameters: center, rotation, scale
- GDAL WASM used for authoritative reprojection on export

#### Simplification
- Tolerance slider (coarse → fine)
- Runs in Web Worker via Mapshaper, non-destructive
- Live preview updates as slider moves

#### Clip / Area of Interest
- **Bounding box:** draw directly on the map canvas
- **Named feature:** click a feature in the loaded dataset to clip to its boundary
- Clear clip button to reset

#### Canvas Size
- Width × height inputs
- Fit to content button (auto-sizes to the data's extent + padding)

#### Export
- **SVG** — primary; uses GDAL-projected coordinates, clean output
- **PNG / JPG** — rasterized from SVG at canvas dimensions
- **GeoJSON** — WGS84 or reprojected via GDAL WASM
- **TopoJSON** — topology-preserving, compact
- **Shapefile** — via GDAL WASM; important for GIS interop and the most-requested format among non-web practitioners

#### Project Save / Load
- Save: serializes `Project` (without geometry data) to a `.json` file, downloaded to disk
- Load: re-hydrates store from `.json`, re-fetches catalog data or prompts to re-upload custom files

---

### Phase 2 — Styling & Labeling

#### Aesthetic Linework Styling
- Go beyond algorithmic simplification to control the *feel* of linework
- Target aesthetics: curved/organic, hand-drawn, sharp/geometric
- Algorithm design is an open research question — TBD

#### Labeling
- Pull place names from bundled sources; support custom name list upload
- Smart default placement (collision-aware, scale-appropriate)
- Easy manual override for placement and formatting
- Format normalization across sources

#### Multi-Layer UI
- Layer panel: add, remove, reorder, toggle visibility
- Per-layer styling controls
- (Data model already supports this from day one)

---

### Future / Platform Considerations
- Non-linework data: landcover, roads, points of interest, data visualization layers
- Complex GIS operations panel (GDAL/Turf ops outside the core linework workflow)
- Auth and user profiles only if server-side project saving or sharing becomes necessary

---

## Layer Styling Defaults

- **Polygon layers** — fill off by default, stroke on. Boundary-focused workflow; fill is noise until intentionally added.
- **Line layers** (roads, rivers, coastlines) — stroke only, fill never applicable.
- **Point layers** — small filled circle, no stroke.

---

## Color Picker

The app's color picker must go beyond the browser native `<input type="color">`, which is inconsistent across platforms and limited in usability.

Custom color picker component:
- **Hex input** — type or paste a hex code directly (`#1a2b3c`)
- **HSL sliders** — Hue (0–360°), Saturation (0–100%), Lightness (0–100%); sliders show gradient tracks
- **Opacity slider** — separate from the color picker, since opacity is a layer-level property independent of hue
- Live swatch preview updating as values change
- No "saved swatches" in MVP

---

## Out of Scope (for now)
- Authentication / user accounts
- Server-side compute or storage
- Raster basemaps (satellite imagery, terrain)
- Data visualization / thematic mapping
- City/neighborhood-level detail
- Mobile-specific UI (desktop-first)
- Graticules (reference grid lines on the map)
- Canvas background color control
- Scale filter in catalog (10m / 50m / 110m exposed as implementation detail, not user-facing filter)
