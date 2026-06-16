---
title: How Graticule Works
description: A technical deep dive into Graticule's architecture — data ingestion, the processing pipeline, worker architecture, chunking strategy, and canvas rendering.
---

Graticule is a fully client-side map linework tool. There is no backend, no server-side rendering, no data upload endpoint. Every file parse, topology operation, and render happens in the browser. This post walks through how that actually works — the data model, the processing pipeline, the worker architecture, and the rendering loop — as you'd explain it to a developer joining the project.

---

## Overall architecture

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 456" style="width:100%;display:block;margin:1.5rem 0" role="img" aria-label="Graticule application architecture diagram">
  <defs>
    <marker id="a-grey" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#8a8880"/>
    </marker>
    <marker id="a-grey-rev" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M8,0 L0,4 L8,8 Z" fill="#8a8880"/>
    </marker>
    <marker id="a-green" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#90a000"/>
    </marker>
    <marker id="a-green-dk" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#647000"/>
    </marker>
  </defs>

  <!-- ROW 1 · UI COMPONENTS  y 0–108 -->
  <rect x="0" y="0" width="760" height="108" rx="10" fill="#eeede8"/>
  <text x="16" y="15" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#8a8880" letter-spacing="0.8">UI COMPONENTS</text>

  <rect x="16" y="20" width="186" height="78" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="109" y="44" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">CatalogPanel</text>
  <text x="109" y="60" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Browse &amp; search catalog</text>
  <text x="109" y="75" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">File upload modal</text>

  <rect x="214" y="20" width="332" height="78" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="380" y="44" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">MapCanvas</text>
  <text x="380" y="60" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">HTML Canvas 2D · pathCache builder + paint $effects</text>
  <text x="380" y="75" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Pan / zoom / rotate · globe sphere, halo, shadow</text>

  <rect x="558" y="20" width="186" height="78" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="651" y="44" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">LayersPanel</text>
  <text x="651" y="60" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Layer stack · style editor</text>
  <text x="651" y="75" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Processing controls</text>

  <line x1="380" y1="99" x2="380" y2="118" stroke="#8a8880" stroke-width="1.5" marker-end="url(#a-grey)" marker-start="url(#a-grey-rev)"/>
  <line x1="651" y1="99" x2="651" y2="118" stroke="#8a8880" stroke-width="1.5" marker-end="url(#a-grey)" marker-start="url(#a-grey-rev)"/>

  <!-- ROW 2 · REACTIVE STATE  y 116–204 -->
  <rect x="0" y="116" width="760" height="88" rx="10" fill="#eeede8"/>
  <text x="16" y="131" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#8a8880" letter-spacing="0.8">REACTIVE STATE  ($state)</text>

  <rect x="16" y="137" width="178" height="59" rx="6" fill="#f4f4f0" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="105" y="158" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">layers[]</text>
  <text x="105" y="173" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Layer objects</text>
  <text x="105" y="187" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">style · processing · hasTopology</text>

  <rect x="206" y="137" width="130" height="59" rx="6" fill="#f4f4f0" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="271" y="158" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">projection</text>
  <text x="271" y="173" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">id · rotate</text>
  <text x="271" y="187" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">interactionMode</text>

  <rect x="348" y="137" width="142" height="59" rx="6" fill="#f4f4f0" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="419" y="158" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">canvasStyles</text>
  <text x="419" y="173" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">background · graticule</text>
  <text x="419" y="187" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">ocean · halo · shadow</text>

  <rect x="502" y="137" width="118" height="59" rx="6" fill="#f4f4f0" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="561" y="158" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">history</text>
  <text x="561" y="173" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">50-entry snapshots</text>
  <text x="561" y="187" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">undo / redo stack</text>

  <rect x="632" y="137" width="112" height="59" rx="6" fill="#f4f4f0" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="688" y="158" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">pathCache</text>
  <text x="688" y="173" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Map&lt;id,</text>
  <text x="688" y="187" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">CachedChunk[]&gt;</text>

  <line x1="105" y1="196" x2="105" y2="232" stroke="#8a8880" stroke-width="1.5" marker-end="url(#a-grey)"/>
  <text x="112" y="218" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#8a8880">fetch / upload</text>

  <!-- ROW 3 · TOPOLOGY PIPELINE  y 212–328 -->
  <rect x="0" y="212" width="760" height="116" rx="10" fill="#eeede8"/>
  <text x="16" y="227" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#8a8880" letter-spacing="0.8">TOPOLOGY PIPELINE  (plain JS Maps, outside $state)</text>

  <rect x="16" y="233" width="212" height="86" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="122" y="256" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">rawTopologyData</text>
  <text x="122" y="272" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">As fetched from CDN</text>
  <text x="122" y="287" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">or converted from upload</text>
  <text x="122" y="307" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#90a000">Map&lt;layerId, Topology&gt;</text>

  <line x1="228" y1="276" x2="258" y2="276" stroke="#90a000" stroke-width="2" marker-end="url(#a-green)"/>
  <text x="243" y="269" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="8" fill="#647000">Stage 1</text>

  <rect x="260" y="233" width="214" height="86" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="367" y="256" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">simplifiedTopologyData</text>
  <text x="367" y="272" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Post-Mapshaper</text>
  <text x="367" y="287" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">pre-Chaikin</text>
  <text x="367" y="307" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#90a000">Map&lt;layerId, Topology&gt;</text>

  <line x1="474" y1="276" x2="504" y2="276" stroke="#90a000" stroke-width="2" marker-end="url(#a-green)"/>
  <text x="489" y="269" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="8" fill="#647000">Stage 2</text>

  <rect x="506" y="233" width="238" height="86" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="625" y="256" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">workingTopologyData</text>
  <text x="625" y="272" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Post-Chaikin</text>
  <text x="625" y="287" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Renderer + exporter read this</text>
  <text x="625" y="307" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#90a000">Map&lt;layerId, Topology&gt;</text>

  <line x1="367" y1="356" x2="367" y2="321" stroke="#647000" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#a-green-dk)"/>
  <line x1="625" y1="356" x2="625" y2="321" stroke="#647000" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#a-green-dk)"/>

  <!-- ROW 4 · WORKERS  y 336–456 -->
  <rect x="0" y="336" width="760" height="120" rx="10" fill="#e9f1c8"/>
  <text x="16" y="351" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#647000" letter-spacing="0.8">WEB WORKERS</text>

  <rect x="16" y="357" width="360" height="88" rx="6" fill="white" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="196" y="380" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">simplify.worker.js</text>
  <text x="196" y="396" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Pre-built Mapshaper bundle · served as static file</text>
  <text x="196" y="412" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Topology-aware simplification (shared borders stay aligned)</text>
  <text x="196" y="428" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Douglas-Peucker · Visvalingam · Weighted Visvalingam</text>

  <rect x="388" y="357" width="356" height="88" rx="6" fill="white" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="566" y="380" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="12" font-weight="600" fill="#38362e">geo.worker.ts</text>
  <text x="566" y="396" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Built by Vite · stores topology per layer (avoids re-transfer)</text>
  <text x="566" y="412" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Chaikin smoothing · BFS + Hilbert path chunking</text>
  <text x="566" y="428" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">Bezier arc computation (screen-space)</text>
</svg>

The three-panel layout interacts with Svelte 5 `$state` reactive stores. Topology data lives separately in plain JS Maps that are invisible to Svelte's reactivity system. Two web workers handle the computationally heavy work off the main thread.

---

## The data model

The central type is `Layer`:

```typescript
interface Layer {
  id: string;
  datasetId: string;
  name: string;
  visible: boolean;
  loading: boolean;
  error: string | null;
  hasTopology: boolean;        // reactive signal: workingTopologyData is ready
  style: LayerStyle;           // fill, stroke, point shape/size
  processing: LayerProcessing; // simplification + smoothing + bezier settings
  geometryTypes: string[];
  bezierCacheKey: number;      // bumped on bezier changes to invalidate render cache only
}
```

### The three topology Maps

Geography data lives in three plain JavaScript `Map`s kept **outside** `$state`:

```
rawTopologyData        ← fetched from CDN or converted from upload
       ↓  (Mapshaper simplification via simplify.worker.js)
simplifiedTopologyData ← post-simplification, pre-smoothing
       ↓  (Chaikin smoothing via geo.worker.ts)
workingTopologyData    ← what the renderer and exporter read
```

All three are `Map<string, Topology>` keyed by layer `id`. They're plain JS because Svelte 5's `deep_read()` would traverse every coordinate on every reactive update. A world countries dataset at 10m resolution has roughly 500,000 coordinate pairs. Wrapping that in a reactive proxy causes multi-second freezes on any UI interaction.

The reactive signal that tells the renderer "data is ready" is `layer.hasTopology: boolean` — a small scalar on the `Layer` object, which *is* reactive. The renderer reads `workingTopologyData.get(layer.id)` directly only when `hasTopology` is true.

---

## Data ingestion

### Catalog datasets

The built-in catalog is a static JSON index served alongside the app. On page load, `+page.ts` fetches the manifest and passes it to `initCatalog()`. Each dataset entry has a `filePath` pointing to a TopoJSON file on the CDN.

When a user clicks a dataset, `addLayer()` pushes a new `Layer` to `layers[]` with `loading: true, hasTopology: false`, fetches the TopoJSON, stores it in `rawTopologyData`, and runs the processing pipeline. When complete, `layer.hasTopology = true` signals the canvas to start building paths.

### File uploads

`fileUpload.ts` supports six formats: GeoJSON, TopoJSON, Shapefile (zip), KML, KMZ, GPX, and CSV. All formats are parsed to a GeoJSON `FeatureCollection`. TopoJSON is the exception — it passes through directly without a round-trip.

For everything else, the upload modal converts GeoJSON to TopoJSON using Mapshaper's in-browser API:

```javascript
const output = await mapshaper.applyCommands(
  '-i input.geojson -o output.topojson format=topojson',
  { 'input.geojson': JSON.stringify(featureCollection) }
);
const topology = JSON.parse(output['output.topojson']);
```

Mapshaper is loaded as a global (`window.mapshaper`) from the same pre-built static bundle that powers the simplification worker.

---

## The processing pipeline

`runLayerPipeline(id, applyDefaults)` runs two async stages sequentially. Both stages run in web workers and communicate via a pending-request registry keyed by `requestId`.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 272" style="width:100%;display:block;margin:1.5rem 0" role="img" aria-label="Processing pipeline and smart stage invalidation diagram">
  <defs>
    <marker id="p-green" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#90a000"/>
    </marker>
    <marker id="p-grey" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#8a8880"/>
    </marker>
  </defs>

  <text x="12" y="14" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#8a8880" letter-spacing="0.8">SMART STAGE INVALIDATION — updateLayerProcessing()</text>

  <rect x="12"  y="20" width="208" height="32" rx="6" fill="#38362e"/>
  <text x="116" y="40" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="white">Simplification key changed</text>

  <rect x="246" y="20" width="208" height="32" rx="6" fill="#38362e"/>
  <text x="350" y="40" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="white">Chaikin key changed</text>

  <rect x="480" y="20" width="208" height="32" rx="6" fill="#38362e"/>
  <text x="584" y="40" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="white">Bezier key changed</text>

  <!-- col 1 -->
  <line x1="116" y1="52" x2="116" y2="66" stroke="#90a000" stroke-width="1.5" marker-end="url(#p-green)"/>
  <rect x="12" y="68" width="208" height="48" rx="6" fill="#e9f1c8" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="116" y="89" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">Stage 1: Mapshaper</text>
  <text x="116" y="105" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">simplify.worker.js</text>

  <line x1="116" y1="116" x2="116" y2="130" stroke="#90a000" stroke-width="1.5" marker-end="url(#p-green)"/>
  <rect x="12" y="132" width="208" height="48" rx="6" fill="#e9f1c8" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="116" y="153" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">Stage 2: Chaikin</text>
  <text x="116" y="169" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">geo.worker.ts</text>

  <line x1="116" y1="180" x2="116" y2="194" stroke="#90a000" stroke-width="1.5" marker-end="url(#p-green)"/>
  <rect x="12" y="196" width="208" height="40" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="116" y="213" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">workingTopologyData</text>
  <text x="116" y="228" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">ready · hasTopology = true</text>

  <!-- col 2 (skip Stage 1) -->
  <line x1="350" y1="52" x2="350" y2="130" stroke="#d4d2cb" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#p-grey)"/>
  <rect x="268" y="76" width="164" height="22" rx="4" fill="#fbfbf9" stroke="#d4d2cb" stroke-width="1"/>
  <text x="350" y="91" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9.5" fill="#8a8880">Stage 1 skipped</text>

  <rect x="246" y="132" width="208" height="48" rx="6" fill="#e9f1c8" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="350" y="153" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">Stage 2: Chaikin</text>
  <text x="350" y="169" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">geo.worker.ts</text>

  <line x1="350" y1="180" x2="350" y2="194" stroke="#90a000" stroke-width="1.5" marker-end="url(#p-green)"/>
  <rect x="246" y="196" width="208" height="40" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="350" y="213" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">workingTopologyData</text>
  <text x="350" y="228" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">ready · hasTopology = true</text>

  <!-- col 3 (no topology work) -->
  <line x1="584" y1="52" x2="584" y2="130" stroke="#d4d2cb" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#p-grey)"/>
  <rect x="502" y="76" width="164" height="22" rx="4" fill="#fbfbf9" stroke="#d4d2cb" stroke-width="1"/>
  <text x="584" y="91" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9.5" fill="#8a8880">no topology work</text>

  <rect x="480" y="132" width="208" height="48" rx="6" fill="#f4f4f0" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="584" y="153" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">bezierCacheKey++</text>
  <text x="584" y="169" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">on the layer object</text>

  <line x1="584" y1="180" x2="584" y2="194" stroke="#8a8880" stroke-width="1.5" marker-end="url(#p-grey)"/>
  <rect x="480" y="196" width="208" height="40" rx="6" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="584" y="213" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="11" font-weight="600" fill="#38362e">path cache rebuild</text>
  <text x="584" y="228" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" fill="#6b6963">new bezier params only</text>

  <line x1="233" y1="20" x2="233" y2="244" stroke="#d4d2cb" stroke-width="1" stroke-dasharray="3,3"/>
  <line x1="467" y1="20" x2="467" y2="244" stroke="#d4d2cb" stroke-width="1" stroke-dasharray="3,3"/>
</svg>

### Stage 1 — Simplification

Reads `rawTopologyData`, writes `simplifiedTopologyData`.

If `applyDefaults` is true and the layer has more than 500,000 coordinate points, Graticule auto-enables simplification at 90% tolerance and shows a toast notification. This keeps large datasets from freezing the renderer on first load.

### Stage 2 — Chaikin smoothing

Reads `simplifiedTopologyData`, writes `workingTopologyData`.

Chaikin is applied in **topology space** — on the shared arc coordinates directly, not on GeoJSON features. This means shared borders between adjacent countries are smoothed exactly once, and the result is consistent on both sides with no gaps. The open-line variant pins the first and last point of each arc (junction nodes where multiple borders meet) so borders don't drift apart after smoothing.

If Chaikin is disabled, `workingTopologyData` is a reference alias to `simplifiedTopologyData` — no data is duplicated.

After Stage 2, geometry types are detected from the topology structure, `layer.geometryTypes` is set, and `layer.hasTopology = true` fires, triggering the canvas cache builder.

---

## Chunking strategy

Before projecting geometry to screen coordinates, the geo worker splits each layer's features into render chunks. Each chunk becomes a separate `Path2D` with its own axis-aligned bounding box, enabling per-chunk viewport culling during paint.

The vertex budget per chunk is **50,000**. This keeps individual `ctx.fill()` and `ctx.stroke()` calls fast while producing tight enough bounding boxes to cull effectively.

### Polygon layers — BFS over the adjacency graph

For polygon layers, the worker builds an adjacency graph from the TopoJSON arc structure. Two features sharing an arc index are adjacent. Chunks are then built using BFS seeded in Hilbert curve order:

```
Sort features by Hilbert key (centroid → 1D space-filling index)
While unassigned features remain:
  Pick lowest Hilbert key as seed
  BFS-expand through adjacency graph until vertex budget is reached
  Emit chunk
```

Hilbert-seeded BFS produces geographically compact chunks — neighboring countries or states end up together. Compact chunks have tighter bounding boxes, which makes viewport culling more effective than arbitrary ID-order batching.

### Line and uploaded layers — Hilbert sort

When there's no topology adjacency (uploaded GeoJSON rivers, roads, point sets), the worker falls back to a Hilbert curve sort followed by greedy vertex-budget batching. Spatially nearby features still cluster together even without explicit adjacency data.

### Chunk group caching

Chunk groups depend on topology structure, not projection or globe rotation. They're cached in the worker's internal `chunkGroupsCache` by layer ID. On a rotation-only rebuild — the common case during globe drag — the worker skips the BFS/Hilbert step entirely and re-projects the existing groups to the new screen coordinates.

---

## Canvas rendering

`MapCanvas.svelte` contains two separate `$effect`s that keep concerns cleanly separated.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 154" style="width:100%;display:block;margin:1.5rem 0" role="img" aria-label="Path cache builder and paint loop diagram">
  <defs>
    <marker id="r-green" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#647000"/>
    </marker>
    <marker id="r-grey" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#8a8880"/>
    </marker>
  </defs>

  <!-- CACHE BUILDER EFFECT -->
  <rect x="0" y="0" width="700" height="62" rx="8" fill="#e9f1c8"/>
  <text x="12" y="14" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#647000" letter-spacing="0.8">CACHE BUILDER $effect  (runs when cacheSignal changes)</text>

  <rect x="12" y="20" width="154" height="34" rx="5" fill="white" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="89" y="34" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">topology changed?</text>
  <text x="89" y="47" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">workerStoreTopology()</text>

  <line x1="166" y1="37" x2="184" y2="37" stroke="#647000" stroke-width="1.5" marker-end="url(#r-green)"/>

  <rect x="186" y="20" width="152" height="34" rx="5" fill="white" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="262" y="34" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">workerBuildPaths()</text>
  <text x="262" y="47" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">dispatched to geo.worker</text>

  <line x1="338" y1="37" x2="356" y2="37" stroke="#647000" stroke-width="1.5" marker-end="url(#r-green)"/>

  <rect x="358" y="20" width="166" height="34" rx="5" fill="white" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="441" y="34" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">chunks: PathCommand[]</text>
  <text x="441" y="47" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">+ bbox per chunk</text>

  <line x1="524" y1="37" x2="542" y2="37" stroke="#647000" stroke-width="1.5" marker-end="url(#r-green)"/>

  <rect x="544" y="20" width="144" height="34" rx="5" fill="white" stroke="#b8cc68" stroke-width="1.5"/>
  <text x="616" y="34" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">pathCache updated</text>
  <text x="616" y="47" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">cacheVersion++</text>

  <line x1="616" y1="62" x2="616" y2="90" stroke="#8a8880" stroke-width="1.5" marker-end="url(#r-grey)"/>

  <!-- PAINT EFFECT -->
  <rect x="0" y="92" width="700" height="62" rx="8" fill="#eeede8"/>
  <text x="12" y="106" font-family="'MDUI',system-ui,sans-serif" font-size="9" font-weight="500" fill="#8a8880" letter-spacing="0.8">PAINT $effect  (runs when cacheVersion bumps)</text>

  <rect x="12" y="112" width="148" height="34" rx="5" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="86" y="126" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">iterate layers</text>
  <text x="86" y="139" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">bottom → top order</text>

  <line x1="160" y1="129" x2="178" y2="129" stroke="#8a8880" stroke-width="1.5" marker-end="url(#r-grey)"/>

  <rect x="180" y="112" width="158" height="34" rx="5" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="259" y="126" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">viewport cull by bbox</text>
  <text x="259" y="139" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">skip off-screen chunks</text>

  <line x1="338" y1="129" x2="356" y2="129" stroke="#8a8880" stroke-width="1.5" marker-end="url(#r-grey)"/>

  <rect x="358" y="112" width="176" height="34" rx="5" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="446" y="126" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">ctx.fill / ctx.stroke</text>
  <text x="446" y="139" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">stamp Path2D onto canvas</text>

  <line x1="534" y1="129" x2="552" y2="129" stroke="#8a8880" stroke-width="1.5" marker-end="url(#r-grey)"/>

  <rect x="554" y="112" width="134" height="34" rx="5" fill="white" stroke="#d4d2cb" stroke-width="1.5"/>
  <text x="621" y="126" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="10" font-weight="600" fill="#38362e">canvas repainted</text>
  <text x="621" y="139" text-anchor="middle" font-family="'MDUI',system-ui,sans-serif" font-size="9" fill="#6b6963">no geometry work done</text>
</svg>

### The cache builder effect

Watches `cacheSignal` — a string fingerprint of all `layer.id:layer.hasTopology:layer.bezierCacheKey` values, sorted so layer reordering doesn't trigger it. When the fingerprint changes, the effect:

1. Detects if the projection changed (type or rotation). If so, marks all cached paths as **stale** — old paths stay visible during rebuild instead of flashing invisible.
2. Sends new or changed topologies to the geo worker via `workerStoreTopology()` — fire-and-forget. The worker stores the topology internally and reuses it for every subsequent `BUILD_PATHS` request without re-transfer.
3. Dispatches `workerBuildPaths()` for each layer needing a fresh path. Responses write to `pathCache` and bump `cacheVersion`.

Layers already in `inFlightBuilds` are skipped — no duplicate in-flight requests. A `pathBuildEpoch` counter detects projection-type changes mid-flight: if the epoch has advanced when a worker response arrives, the result is discarded. For globe drag, a `ROTATE_BUILD_THRESHOLD` of 2° gates path rebuilds so the first tiny pointer movement doesn't dispatch a full rebuild.

### The paint effect

Watches `cacheVersion`. No geometry computation happens here — just stamping pre-built `Path2D` objects onto the canvas with current styles. The loop clears the canvas, draws the globe sphere disk, atmospheric halo, drop shadow, and graticule grid if enabled, then iterates layers bottom-to-top, culling each chunk against the current viewport bounds before calling `ctx.fill()` / `ctx.stroke()`.

Point features are not chunked — they're drawn by projecting each feature's coordinates individually and stamping a `d3-shape` symbol path.

---

## Bezier curves

When bezier is enabled, the geo worker takes a completely different path. Instead of converting topology to GeoJSON and chunking features, it:

1. Decodes every arc from TopoJSON delta-encoding to absolute geographic coordinates.
2. Projects each arc point to screen space using the current projection.
3. Computes cubic Bézier control points for each segment using the chosen algorithm (Catmull-Rom, Kochanek-Bartels, or B-spline).
4. Returns the entire layer as a **single chunk** with a sentinel bounding box of `[-Infinity, -Infinity, Infinity, Infinity]` — never viewport-culled.

Because bezier arcs are computed in **screen space** after projection, the visual curves change as you zoom or change projection. Bezier is purely a display treatment. GeoJSON, Shapefile, and TopoJSON exports contain the original simplified/smoothed vertices — only SVG and PNG output show the bezier interpolation.

The arc-level projection requires careful handling at globe boundaries. A `clipDistRad` threshold filters back-hemisphere points before projection. An antimeridian detection step (`|lon_i - lon_{i+1}| > 180°`) emits `moveTo` break commands instead of drawing Bézier arcs across the seam. Ghost endpoint reflection prevents tangent blow-out at arc endpoints and near polar distortion zones.

---

## The history system

`history.svelte.ts` implements a 50-entry undo/redo stack using JSON snapshots.

A `Snapshot` captures the `layers` array metadata (id, name, visible, style, processing settings, hasTopology), the current projection ID, and the canvas background color. It does **not** capture topology data — snapshots are small because they store only the *settings* needed to recreate the topology, not the geometry itself.

`restore(snapshot)` splices the `layers` array to match the snapshot (with `hasTopology: false` to force path cache invalidation), then calls `runLayerPipeline(id, false)` for each layer that had data — re-running Mapshaper and Chaikin with the restored processing settings. Undo is therefore asynchronous: the layer shows `loading: true` until the pipeline completes.

---

## Project save and load

`project.ts` serializes the current session to a plain `.json` file.

**Saving** captures each layer's metadata, style, processing settings, and whether it's a catalog layer or upload, plus the projection ID. Uploaded dataset topologies are embedded inline in full.

**Loading** clears the current session, restores the projection, re-populates uploaded datasets from the inline topology data, then:
- For **uploaded layers**: calls `addUploadedLayer()` directly with the stored topology.
- For **catalog layers**: re-fetches the TopoJSON from the CDN using the stored `datasetId`, then runs the pipeline with `applyDefaults: false` so saved styles aren't overwritten.

Uploaded topologies are stored inline, so large uploads make the project file large. A 50 MB warning is shown during save.

---

## Coordinate system and clamping

All data is stored in WGS84 (EPSG:4326). Projections come from `d3-geo` and `d3-geo-projection`. Two interaction modes: **pan** for flat projections (tx/ty offsets + pointer-position zoom) and **rotate** for globe projections (`projectionStore.rotate` updated on drag).

A coordinate clamp is applied before any projection math runs, in both the main thread and the geo worker:

```typescript
s.point(
  Math.max(-180, Math.min(180, lon)),
  Math.max(-90,  Math.min( 90, lat))
);
```

TopoJSON's integer quantization can produce coordinates like `lat = 90 + ε` from floating-point rounding in the scale/translate arithmetic. Mercator returns `NaN` for `|lat| > 90`, which causes Canvas 2D to produce triangular fill artifacts. The clamp is invisible on screen but eliminates the problem entirely.

---

## Key architectural decisions

**Plain Maps for topology, not reactive state.** Svelte 5's reactive proxy traverses every nested value on read. Geographic data is too large to survive this — a single dataset can have millions of coordinate pairs. The reactive signal is `layer.hasTopology`, not the topology itself.

**Topology as the internal format.** All geometry — catalog and uploaded — lives in TopoJSON inside Graticule. TopoJSON's shared-arc representation is what makes topology-aware simplification and Chaikin smoothing possible without gaps at shared borders. Non-TopoJSON uploads go through Mapshaper's `applyCommands` to convert before entering the pipeline.

**Two workers, not one.** Mapshaper is a large, self-contained bundle that must be served as a pre-built static file. Vite can't bundle it normally. The geo worker handles everything else and is built by Vite as a regular module worker. Keeping them separate avoids an enormous main worker bundle.

**Chunk groups cached by topology, not projection.** Geographic adjacency and Hilbert sort order don't change with projection or rotation. Caching group assignments means a globe drag — which triggers many rebuilds per second — only re-runs the projection step, not the chunking step.

**Stale paths stay visible during rebuild.** When the projection changes, existing cached paths are marked stale but kept in the cache. The paint effect continues drawing them until fresh paths arrive. This eliminates the flash of invisible layers on projection changes and globe rotation.

**History snapshots, not topology copies.** Snapshots are small enough to keep 50 entries in memory. Restoring re-runs the pipeline, which means undo for large datasets takes a moment — but the history stack is bounded regardless of dataset size.
