import type { Topology } from 'topojson-specification';
import { geoArea } from 'd3-geo';
import type { Layer, LayerStyle, LayerProcessing, LabelStyle, Dataset } from '$lib/types';
import { catalog } from './catalog.svelte';
import { countTopoPoints } from '$lib/utils/chaikin';
import { computeLabelGeometries, guessLabelAttribute } from '$lib/utils/labels';
import { csvToPointTopology } from '$lib/utils/csv';
import { topologyToAbsolute } from '$lib/utils/topology';
import { workerChaikin } from '$lib/workers/geoWorker';
import { workerSimplify } from '$lib/workers/simplifyWorker';
import { showToast } from './toast.svelte';
import { uploadedDatasets } from './uploadedDatasets.svelte';

const DISPLAY_VERTEX_THRESHOLD = 500_000;
const DISPLAY_SIMP_TOLERANCE = 90;

// Reactive array of layers currently added to the map.
// Components import `layers` to read, and call the functions below to modify.
let layers = $state<Layer[]>([]);

// Topology data — stored outside $state so Svelte never wraps it in a reactive
// proxy. Accessing large topology/GeoJSON through a reactive proxy causes Svelte
// to call deep_read() — traversing every coordinate — on each reactive update.
//
// rawTopologyData:        original topology as fetched/converted. Keyed by layer.geometryId
//                         (NOT layer.id) — immutable, versioned source of truth. A geometry
//                         op mints a new geometryId; existing entries are never overwritten.
// simplifiedTopologyData: post-Mapshaper, pre-Chaikin. Internal pipeline cache, keyed by
//                         layer.id — no consumer outside layers.svelte.ts should read this.
// workingTopologyData:    post-Chaikin (or same reference as simplified if Chaikin
//                         is disabled), keyed by layer.id. What all renderers/exporters use.
// layer.hasTopology signals when workingTopologyData is ready to render.
const rawTopologyData = new Map<string, Topology>();
const simplifiedTopologyData = new Map<string, Topology>();
const workingTopologyData = new Map<string, Topology>();

// Generates a unique ID. Used for layer.id, datasetId, and geometryId — the last is
// correctness-critical (a collision would restore the wrong geometry on undo), so we use
// a proper UUID rather than a short Math.random string.
function generateId(): string {
	return crypto.randomUUID();
}

// Default processing settings — all effects disabled, matching experiment page defaults.
export function defaultProcessing(): LayerProcessing {
	return {
		simpEnabled: false,
		simpAlgorithm: 'weighted',
		simpTolerance: 0,
		simpWeight: 0.7,
		simpKeepShapes: false,
		chaikinEnabled: false,
		chaikinIterations: 2,
		bezierEnabled: false,
		bezierCurveType: 'catmull-rom',
		bezierTension: 0.5,
		bezierAlpha: 0.5,
		bezierContinuity: 0,
		bezierBias: 0,
	};
}

// Default style for a new layer — no fill, dark stroke.
function defaultStyle() {
	return {
		fill: 'none',
		fillOpacity: 1,
		stroke: '#161819',
		strokeOpacity: 1,
		strokeWidth: 0.5,
		strokeDashed: false,
		strokeDash: 2,
		strokeGap: 4,
		pointRadius: 3,
		pointShape: 'symbolCircle',
	};
}

// Default label style. Every layer carries one (geometry layers ignore it) so no
// call site needs undefined-checks; exported for the load path in project.ts.
export function defaultLabelStyle(): LabelStyle {
	return {
		fontFamily: 'Arial',
		fontSize: 14,
		fontWeight: 400,
		italic: false,
		letterSpacing: 0,
		textTransform: 'none',
		color: '#161819',
		colorOpacity: 1,
		haloColor: '#ffffff',
		haloOpacity: 1,
		haloWidth: 0,
		haloBlur: 0,
		anchor: 'center',
		lineHeight: 1.2,
		textAlign: 'center',
	};
}

// ---------------------------------------------------------------------------
// Processing pipeline
// ---------------------------------------------------------------------------

// Which LayerProcessing keys belong to each stage. Used by updateLayerProcessing
// to determine which stage(s) need to re-run when settings change.
const SIMP_KEYS = new Set<keyof LayerProcessing>([
	'simpEnabled', 'simpAlgorithm', 'simpTolerance', 'simpWeight', 'simpKeepShapes',
]);
const CHAIKIN_KEYS = new Set<keyof LayerProcessing>([
	'chaikinEnabled', 'chaikinIterations',
]);
// Bezier keys are everything else — bezier changes only need a path cache rebuild,
// no topology recomputation.

// Stage 1 — Mapshaper simplification.
// Reads rawTopologyData, writes simplifiedTopologyData.
// applyDefaults: on first load, auto-simplifies large datasets.
async function runSimplificationStage(id: string, applyDefaults: boolean): Promise<void> {
	const layer = layers.find((l) => l.id === id);
	if (!layer) return;
	const rawTopo = rawTopologyData.get(layer.geometryId);
	if (!rawTopo) return;

	// Yield to the event loop so Svelte can flush layer.loading = true before
	// JSON.stringify(topo) blocks the thread.
	await Promise.resolve();

	// Auto-simplify large datasets on first load so they render at a usable speed.
	if (applyDefaults && !layer.processing.simpEnabled) {
		const pointCount = countTopoPoints(rawTopo);
		if (pointCount > DISPLAY_VERTEX_THRESHOLD) {
			layer.processing.simpEnabled = true;
			layer.processing.simpTolerance = DISPLAY_SIMP_TOLERANCE;
			showToast('Large dataset automatically simplified for performance. You can adjust this in the layer settings.');
		}
	}

	let topo: Topology = rawTopo;

	if (layer.processing.simpEnabled) {
		topo = await workerSimplify(
			id, rawTopo,
			layer.processing.simpAlgorithm,
			layer.processing.simpTolerance,
			layer.processing.simpWeight,
			layer.processing.simpKeepShapes,
		);
	}

	simplifiedTopologyData.set(id, topo);
}

// Stage 2 — Chaikin smoothing.
// Reads simplifiedTopologyData, writes workingTopologyData.
// Also detects geometry types and applies first-load style defaults.
async function runChaikinStage(id: string, applyDefaults: boolean): Promise<void> {
	const simplified = simplifiedTopologyData.get(id);
	const layer = layers.find((l) => l.id === id);
	if (!simplified || !layer) return;

	await Promise.resolve();

	// Chaikin disabled — workingTopologyData points to the same object as
	// simplifiedTopologyData. No data is duplicated; it's just two references.
	const topo: Topology = layer.processing.chaikinEnabled
		? await workerChaikin(id, simplified, layer.processing.chaikinIterations)
		: simplified;

	workingTopologyData.set(id, topo);

	// Detect geometry types from the topology — no need to materialise GeoJSON.
	type TopoGeomCollection = { geometries?: { type?: string }[] };
	const objectName = Object.keys(topo.objects)[0];
	const geometries = (topo.objects[objectName] as TopoGeomCollection).geometries ?? [];
	const types = new Set(
		geometries.map((g) => g.type).filter((t): t is string => typeof t === 'string')
	);
	layer.geometryTypes = [...types];

	// Apply geometry-aware style defaults for freshly added layers only.
	if (applyDefaults) {
		const isPointOnly = [...types].every((t) => t === 'Point' || t === 'MultiPoint');
		const hasPolygon  = [...types].some((t) => t === 'Polygon' || t === 'MultiPolygon');

		if (isPointOnly) {
			layer.style.fill        = '#161819';
			layer.style.fillOpacity = 1;
			layer.style.stroke      = 'none';
		} else if (hasPolygon) {
			layer.style.fill        = '#ffffff';
			layer.style.fillOpacity = 1;
		}
	}

	layer.hasTopology = true;
}

// Full pipeline: simplification → Chaikin. Used on initial load (fetch/upload).
export async function runLayerPipeline(id: string, applyDefaults = true): Promise<void> {
	await runSimplificationStage(id, applyDefaults);
	await runChaikinStage(id, applyDefaults);
}

// Updates a layer's processing settings, running only the stage(s) that need it.
//   Simp settings changed    → re-run both stages (Mapshaper output is stale)
//   Chaikin settings changed → skip Mapshaper, re-run only Chaikin
//   Bezier settings changed  → no topology work; bump bezierCacheKey so MapCanvas
//                              rebuilds the path cache with the new bezier settings
export function updateLayerProcessing(id: string, patch: Partial<LayerProcessing>, onComplete?: () => void): void {
	const layer = layers.find((l) => l.id === id);
	if (!layer) return;

	const changedKeys = Object.keys(patch) as (keyof LayerProcessing)[];
	const simpChanged    = changedKeys.some((k) => SIMP_KEYS.has(k));
	const chaikinChanged = changedKeys.some((k) => CHAIKIN_KEYS.has(k));

	Object.assign(layer.processing, patch);

	if (simpChanged) {
		// Simp settings changed — re-run both stages.
		layer.hasTopology = false;
		layer.loading = true;
		runSimplificationStage(id, false)
			.then(() => runChaikinStage(id, false))
			.then(() => onComplete?.());
	} else if (chaikinChanged) {
		// Chaikin settings changed — simplifiedTopologyData is still valid, skip Mapshaper.
		layer.hasTopology = false;
		layer.loading = true;
		runChaikinStage(id, false).then(() => onComplete?.());
	} else {
		// Bezier settings changed — topology is unchanged, just signal path cache to rebuild.
		layer.bezierCacheKey++;
		onComplete?.();
	}
}

// Fetches a single TopoJSON file and populates the given layer.
// onComplete fires after data is set — used by addLayer to know when to push
// a history snapshot (once all sub-layers have loaded).
function fetchTopoJSON(id: string, url: string, onComplete?: () => void, applyDefaults = true): void {
	fetch(url)
		.then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json() as Promise<Topology>;
		})
		.then((topology) => {
			const layer = layers.find((l) => l.id === id);
			if (!layer) return;
			rawTopologyData.set(layer.geometryId, topology);
			return runLayerPipeline(id, applyDefaults);
		})
		.then(() => {
			onComplete?.();
		})
		.catch((err) => {
			setLayerError(id, err.message);
		});
}

// onComplete is called once all layers for the dataset have finished loading.
// Pass pushSnapshot here so history is recorded without importing history into this store.
// onStart fires synchronously before any layers are mutated — use it to snapshot
// the current state so a style-change that happened before this add gets its own entry.
// onComplete fires after all data has loaded — use it to snapshot the final state.
export function addLayer(dataset: Dataset, onStart?: () => void, onComplete?: () => void): void {
	onStart?.();
	const copies = layers.filter((l) => l.datasetId === dataset.id).length;

	if (dataset.layers && dataset.layers.length > 0) {
		// Multi-layer dataset (e.g. Project Linework) — add one map layer per sub-layer.
		// Fire onComplete only after every sub-layer has loaded so the whole add is
		// treated as a single history entry.
		let remaining = dataset.layers.length;
		const onSubComplete = () => { if (--remaining === 0) onComplete?.(); };

		for (const subLayer of dataset.layers) {
			const id = generateId();
			const baseName = copies === 0 ? dataset.name : `${dataset.name} (${copies + 1})`;

			layers.unshift({
				id,
				geometryId: generateId(),
				geometryEdited: false,
				datasetId: dataset.id,
				name: `${baseName} — ${subLayer.name}`,
				visible: true,
				loading: true,
				error: null,
				hasTopology: false,
				style: defaultStyle(),
				processing: defaultProcessing(),
				kind: 'geometry',
				labelAttribute: null,
				labelStyle: defaultLabelStyle(),
				derivedFrom: null,
				geometryTypes: [],
				bezierCacheKey: 0,
			});

			fetchTopoJSON(id, `${catalog.baseURL}/${subLayer.filePath}`, onSubComplete);
		}
	} else {
		// Single-layer dataset — existing behaviour.
		const id = generateId();
		const name = copies === 0 ? dataset.name : `${dataset.name} (${copies + 1})`;

		// A CSV catalog entry (currently GeoNames) becomes a label layer: the CSV is
		// converted to an inline-coordinate point topology and the `name` column is
		// drawn as text. TopoJSON entries keep the existing geometry behaviour.
		const isCsv = dataset.filePath.endsWith('.csv');

		layers.unshift({
			id,
			geometryId: generateId(),
			geometryEdited: false,
			datasetId: dataset.id,
			name,
			visible: true,
			loading: true,
			error: null,
			hasTopology: false,
			style: defaultStyle(),
			processing: defaultProcessing(),
			kind: isCsv ? 'label' : 'geometry',
			labelAttribute: isCsv ? 'name' : null,
			labelStyle: defaultLabelStyle(),
			derivedFrom: null,
			geometryTypes: [],
			bezierCacheKey: 0,
		});

		fetch(`${catalog.baseURL}/${dataset.filePath}`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return isCsv ? r.text() : (r.json() as Promise<Topology>);
			})
			.then((data) => {
				const layer = layers.find((l) => l.id === id);
				if (!layer) return;
				const topology = isCsv ? csvToPointTopology(data as string) : (data as Topology);
				rawTopologyData.set(layer.geometryId, topology);
				// applyDefaults=false for labels, mirroring createLabelLayer.
				return runLayerPipeline(id, !isCsv);
			})
			.then(() => {
				onComplete?.();
			})
			.catch((err) => {
				setLayerError(id, err.message);
			});
	}
}

// Creates an empty layer with no datasource — the user picks one afterwards via the Data tab.
// No geometry, no pipeline run; datasetId is '' until a source is set. Returns the new id so
// the caller can select it, open its Data tab, and start renaming.
export function addEmptyLayer(): string {
	const id = generateId();
	// Name "Layer N" where N is one past the highest existing "Layer N" — never duplicates a
	// visible name, even after deletes.
	const usedNumbers = layers
		.map((l) => /^Layer (\d+)$/.exec(l.name))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => parseInt(m[1], 10));
	const n = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;

	layers.unshift({
		id,
		geometryId: generateId(),
		geometryEdited: false,
		datasetId: '',
		name: `Layer ${n}`,
		visible: true,
		loading: false,
		error: null,
		hasTopology: false,
		style: defaultStyle(),
		processing: defaultProcessing(),
		kind: 'geometry',
		labelAttribute: null,
		labelStyle: defaultLabelStyle(),
		derivedFrom: null,
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	return id;
}

export function addUploadedLayer(name: string, topology: Topology, uploadId: string, applyDefaults = true, onComplete?: () => void, style?: LayerStyle): void {
	const id = generateId();
	const geometryId = generateId();
	// Strip any Svelte reactive Proxy wrapper before the topology enters the pipeline.
	// Proxies can't be structured-cloned, which causes postMessage to the geo worker to fail.
	const plainTopology = $state.snapshot(topology) as unknown as Topology;
	layers.unshift({
		id,
		geometryId,
		geometryEdited: false,
		datasetId: uploadId,
		name,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: style ? JSON.parse(JSON.stringify(style)) : defaultStyle(),
		processing: defaultProcessing(),
		kind: 'geometry',
		labelAttribute: null,
		labelStyle: defaultLabelStyle(),
		derivedFrom: null,
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(geometryId, plainTopology);
	runLayerPipeline(id, applyDefaults).then(() => onComplete?.());
}

export function duplicateLayer(id: string): void {
	const index = layers.findIndex((l) => l.id === id);
	if (index === -1) return;
	const source = layers[index];
	const newId = generateId();

	// Deep-copy style and processing so changes to the duplicate don't affect the original.
	// True copy-on-write: the duplicate SHARES the source's geometryId (raw is immutable —
	// editing either layer mints a fresh geometryId via replaceLayerGeometry, so they never
	// alias once one diverges). The live-set GC keeps the shared raw alive as long as either
	// layer (or a snapshot) references it.
	const newLayer: Layer = {
		...source,
		id: newId,
		geometryId: source.geometryId,
		name: `${source.name} copy`,
		// Reset transient state.
		loading: false,
		error: null,
		style: JSON.parse(JSON.stringify(source.style)),
		processing: JSON.parse(JSON.stringify(source.processing)),
		labelStyle: JSON.parse(JSON.stringify(source.labelStyle)),
	};

	// Copy the derived caches (keyed by layer.id) so the duplicate is immediately renderable;
	// raw is shared, not copied. geometryEdited is inherited via the spread above.
	const simplified = simplifiedTopologyData.get(id);
	if (simplified) simplifiedTopologyData.set(newId, simplified);
	const working = workingTopologyData.get(id);
	if (working) workingTopologyData.set(newId, working);

	// Insert immediately above the original.
	layers.splice(index, 0, newLayer);
}

// Creates a label layer from a source layer's on-screen geometry — a one-time
// derivation (docs/labels-plan.md, D2): one anchor point per feature, all properties
// copied, text attribute best-guessed. The new layer is fully independent of the
// source afterwards and persists inline (geometryEdited). Inserted directly above
// the source. Returns the new layer id, or null if there's no usable geometry.
// Like other ops, history snapshots are the caller's job (via onComplete).
export function createLabelLayer(sourceId: string, onComplete?: () => void): string | null {
	const source = layers.find((l) => l.id === sourceId);
	const working = workingTopologyData.get(sourceId);
	if (!source || !working) return null;

	const labelGeoms = computeLabelGeometries(working);
	if (labelGeoms.length === 0) return null;

	// Points carry inline coordinates; lines (curved labels, D9) reference arcs,
	// pushed here as plain coordinate arrays (no transform on this topology).
	const arcs: [number, number][][] = [];
	const labelTopology = {
		type: 'Topology',
		arcs,
		objects: {
			labels: {
				type: 'GeometryCollection',
				geometries: labelGeoms.map((g) =>
					g.geometry.type === 'Point'
						? { type: 'Point', coordinates: g.geometry.coordinates, properties: g.properties }
						: { type: 'LineString', arcs: [arcs.push(g.geometry.coordinates) - 1], properties: g.properties }
				),
			},
		},
	} as unknown as Topology;

	const id = generateId();
	const geometryId = generateId();
	// Provenance label only — the derived geometry lives in rawTopologyData.
	const datasetId = generateId();
	const index = layers.findIndex((l) => l.id === sourceId);

	layers.splice(index, 0, {
		id,
		geometryId,
		geometryEdited: true,
		datasetId,
		name: `${source.name} labels`,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: defaultStyle(),
		processing: defaultProcessing(),
		kind: 'label',
		labelAttribute: guessLabelAttribute(labelGeoms.map((g) => g.properties)),
		labelStyle: defaultLabelStyle(),
		derivedFrom: source.name,
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(geometryId, labelTopology);
	runLayerPipeline(id, false).then(() => onComplete?.());
	return id;
}

export function removeLayer(id: string): void {
	const index = layers.findIndex((l) => l.id === id);
	if (index !== -1) {
		layers.splice(index, 1);
		// workingTopologyData is intentionally kept so undo can restore the layer without re-fetching.
	}
}

export function toggleVisibility(id: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) layer.visible = !layer.visible;
}

export function setLayerError(id: string, error: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) {
		layer.error = error;
		layer.loading = false;
	}
}

export function updateLayerStyle(id: string, patch: Partial<LayerStyle>): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) Object.assign(layer.style, patch);
}

export function updateLayerLabelStyle(id: string, patch: Partial<LabelStyle>): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) Object.assign(layer.labelStyle, patch);
}

export function setLabelAttribute(id: string, attribute: string | null): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) layer.labelAttribute = attribute;
}

// Replaces a layer's geometry while keeping its stable identity (layer.id). Mints a NEW
// geometryId and writes raw under it — it NEVER overwrites an existing entry — so undo can
// re-derive the pre-op geometry from the old geometryId, which stays alive. This is the
// single funnel that every in-place geometry op should route through. Sync only: the raw
// must already be in hand. History is the caller's job (pass onComplete → pushSnapshot).
export function replaceLayerGeometry(
	layerId: string,
	newRaw: Topology,
	opts?: { applyDefaults?: boolean; geometryEdited?: boolean },
	onComplete?: () => void,
): void {
	const layer = layers.find((l) => l.id === layerId);
	if (!layer) return;

	// Strip any Svelte reactive Proxy so the topology can be structured-cloned to the worker.
	const plain = $state.snapshot(newRaw) as unknown as Topology;
	const geometryId = generateId();
	// Immutability invariant: a fresh geometryId must never collide with an existing raw
	// entry. If it does, ids are being reused and undo correctness is broken — fail loud.
	if (rawTopologyData.has(geometryId)) {
		throw new Error(`replaceLayerGeometry: geometryId ${geometryId} already exists — id reuse breaks undo`);
	}
	rawTopologyData.set(geometryId, plain);
	layer.geometryId = geometryId;
	// Default: the new geometry is a derived/edited result (must inline on save). A datasource
	// swap overrides this to false — the geometry matches a real, re-linkable source.
	layer.geometryEdited = opts?.geometryEdited ?? true;
	layer.hasTopology = false;
	layer.loading = true;
	layer.error = null;
	runLayerPipeline(layerId, opts?.applyDefaults ?? false).then(() => onComplete?.());
}

// Repoints an existing layer at a different dataset: swaps its raw topology and re-runs
// the pipeline with applyDefaults=false so the layer's style/processing survive the switch.
// The dataset may be a remote catalog entry (fetched by URL) or an in-memory uploaded one.
// Multi-layer catalog datasets aren't switchable in place (they map to several layers).
export function setLayerDatasource(layerId: string, datasetId: string, onComplete?: () => void): void {
	const layer = layers.find((l) => l.id === layerId);
	if (!layer) return;

	const catalogDataset = catalog.datasets.find((d) => d.id === datasetId);
	const uploaded = uploadedDatasets.find((u) => u.id === datasetId);
	if (!catalogDataset && !uploaded) return;

	// A fresh empty layer (no source yet) gets geometry-aware style defaults applied for its
	// new type, like a normal add. A real switch on an already-sourced layer preserves the
	// user's existing style/processing (the point of the Data-tab feature).
	const applyDefaults = layer.datasetId === '';

	layer.datasetId = datasetId;

	if (uploaded) {
		// Sync raw in hand → funnel mints a new geometryId, old raw stays for undo.
		// geometryEdited:false — geometry matches the re-linkable uploaded dataset.
		replaceLayerGeometry(layerId, uploaded.topology, { applyDefaults, geometryEdited: false }, onComplete);
	} else if (catalogDataset) {
		// Async fetch: mint a fresh geometryId up front so the resolved write lands on a new
		// key (old raw preserved for undo). fetchTopoJSON writes under layer.geometryId.
		layer.geometryId = generateId();
		// Geometry matches the catalog source → re-fetchable, not inlined on save.
		layer.geometryEdited = false;
		layer.hasTopology = false;
		layer.loading = true;
		layer.error = null;
		fetchTopoJSON(layerId, `${catalog.baseURL}/${catalogDataset.filePath}`, onComplete, applyDefaults);
	}
}

// A drawn feature in absolute coords. coords holds the open vertex list: one point for a
// Point, the polyline for a LineString, the open ring for a Polygon (closing edge implicit).
export interface DrawnFeature {
	type: 'Point' | 'LineString' | 'Polygon';
	coords: [number, number][];
}

// Commits drawn features to a layer. With a null target, creates a new empty layer first.
// Points store coordinates directly; lines/polygons each append a new arc and reference it.
// New features null-fill to the existing schema. Routes through replaceLayerGeometry so the
// result is undoable + flash-free. Returns the layer id. History is the caller's job.
export function commitDrawnFeatures(
	targetLayerId: string | null,
	features: readonly DrawnFeature[],
	onComplete?: () => void,
): string {
	const layerId = targetLayerId ?? addEmptyLayer();
	const layer = layers.find((l) => l.id === layerId);
	const wasEmpty = !layer?.hasTopology;

	// Base geometry: the layer's current on-screen topology (absolute-decoded so we can append
	// directly), or a fresh empty GeometryCollection when the layer has no geometry yet.
	const working = workingTopologyData.get(layerId);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let topo: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let geometries: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let arcs: any[];
	if (working) {
		topo = topologyToAbsolute(working);
		const objName = Object.keys(topo.objects)[0];
		geometries = topo.objects[objName].geometries;
		arcs = topo.arcs;
	} else {
		geometries = [];
		arcs = [];
		topo = { type: 'Topology', arcs, objects: { data: { type: 'GeometryCollection', geometries } } };
	}

	// New features null-fill to the union of existing property keys, keeping the table schema stable.
	const keys = new Set<string>();
	for (const g of geometries) for (const k in (g.properties ?? {})) keys.add(k);
	const nullProps = (): Record<string, null> => {
		const o: Record<string, null> = {};
		for (const k of keys) o[k] = null;
		return o;
	};

	// Appends a coordinate ring as a new arc, returning its index.
	const addArc = (ring: readonly [number, number][]): number => {
		arcs.push(ring.map((c) => [c[0], c[1]]));
		return arcs.length - 1;
	};

	for (const f of features) {
		const properties = nullProps();
		if (f.type === 'Point') {
			geometries.push({ type: 'Point', coordinates: [f.coords[0][0], f.coords[0][1]], properties });
		} else if (f.type === 'LineString') {
			geometries.push({ type: 'LineString', arcs: [addArc(f.coords)], properties });
		} else {
			// Close the ring (TopoJSON polygon rings are closed) if it isn't already.
			const ring: [number, number][] = [...f.coords];
			const first = ring[0];
			const last = ring[ring.length - 1];
			if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
			// Orient so the ring describes its interior (the smaller region): if d3's spherical
			// area says it covers more than a hemisphere, it's wound the wrong way — reverse.
			// geoArea is projection-independent, unlike a planar shoelace which mis-signs large
			// polygons and makes d3 fill the complement (a hole + filled surroundings).
			if (geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI) ring.reverse();
			geometries.push({ type: 'Polygon', arcs: [[addArc(ring)]], properties });
		}
	}

	// applyDefaults only when the layer had no geometry — a first draw picks geometry-aware
	// style defaults; appending to an existing layer preserves the user's style.
	replaceLayerGeometry(layerId, topo as Topology, { applyDefaults: wasEmpty, geometryEdited: true }, onComplete);
	return layerId;
}

// Creates an empty freeform text layer — a label layer with no source, holding text
// boxes placed by the text tool. Content lives in the plain `text` property.
function addEmptyTextLayer(): string {
	const id = generateId();
	// Name "Text N" like addEmptyLayer's "Layer N" — never duplicates a visible name.
	const usedNumbers = layers
		.map((l) => /^Text (\d+)$/.exec(l.name))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => parseInt(m[1], 10));
	const n = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;

	layers.unshift({
		id,
		geometryId: generateId(),
		geometryEdited: true,
		// Provenance label only — freeform text has no dataset.
		datasetId: generateId(),
		name: `Text ${n}`,
		visible: true,
		loading: false,
		error: null,
		hasTopology: false,
		style: defaultStyle(),
		processing: defaultProcessing(),
		kind: 'label',
		labelAttribute: 'text',
		labelStyle: defaultLabelStyle(),
		derivedFrom: null,
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	return id;
}

// Commits text boxes from a text session to the target layer, or a new "Text" layer
// when the target is null. Same shape as commitDrawnFeatures: append to the layer's
// on-screen topology and funnel through replaceLayerGeometry (one geometryId mint).
export function commitTextFeatures(
	targetLayerId: string | null,
	// `line` present = a baked text-on-path box (D10): lands as a LineString; coord
	// and the point-only fields (rotation/wrapWidth) are ignored for it.
	features: readonly { coord: [number, number]; text: string; rotation?: number; wrapWidth?: number; line?: [number, number][]; pathOffset?: number }[],
	onComplete?: () => void,
): string {
	const layerId = targetLayerId ?? addEmptyTextLayer();
	const layer = layers.find((l) => l.id === layerId);

	// Base geometry: the layer's current on-screen topology, or fresh when empty.
	const working = workingTopologyData.get(layerId);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let topo: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let geometries: any[];
	if (working) {
		topo = topologyToAbsolute(working);
		const objName = Object.keys(topo.objects)[0];
		geometries = topo.objects[objName].geometries;
	} else {
		geometries = [];
		topo = { type: 'Topology', arcs: [], objects: { data: { type: 'GeometryCollection', geometries } } };
	}

	// New features null-fill to the union of existing property keys, keeping the table
	// schema stable (matters when appending to a derived label layer).
	const keys = new Set<string>();
	for (const g of geometries) for (const k in (g.properties ?? {})) keys.add(k);
	const nullProps = (): Record<string, unknown> => {
		const o: Record<string, unknown> = {};
		for (const k of keys) o[k] = null;
		return o;
	};

	for (const f of features) {
		const properties: Record<string, unknown> = { ...nullProps(), text: f.text };
		if (f.line) {
			if (f.pathOffset !== undefined && f.pathOffset !== 0.5) properties.__pathOffset = f.pathOffset;
			geometries.push({
				type: 'LineString',
				arcs: [(topo.arcs as [number, number][][]).push(f.line.map((c) => [c[0], c[1]] as [number, number])) - 1],
				properties,
			});
			continue;
		}
		if (f.rotation !== undefined && f.rotation !== 0) properties.__rotation = f.rotation;
		if (f.wrapWidth !== undefined) properties.__wrapWidth = f.wrapWidth;
		geometries.push({
			type: 'Point',
			coordinates: [f.coord[0], f.coord[1]],
			properties,
		});
	}

	// Make sure the new text is actually displayed: a layer without a chosen attribute
	// (or a fresh one) reads from `text`.
	if (layer && layer.labelAttribute === null) layer.labelAttribute = 'text';

	replaceLayerGeometry(layerId, topo as Topology, { applyDefaults: false, geometryEdited: true }, onComplete);
	return layerId;
}

// Applies a text session's edits to one label layer: moved anchor coordinates, edited
// text (written to the layer's labelAttribute), per-feature rotation/wrap width (the
// reserved __rotation/__wrapWidth properties), and deleted features, against the
// layer's current on-screen topology. Funnels through replaceLayerGeometry (one
// geometryId mint) like every other geometry op.
export interface LabelEdits {
	moves?: Map<number, [number, number]>;
	// Curved labels: lon/lat delta added to every vertex of the line (whole-line translate).
	lineMoves?: Map<number, [number, number]>;
	// Curved labels: the line's coordinates replaced outright (baked path sculpt, D10).
	// On a Point feature this CONVERTS it to a LineString ("On path" toggled on).
	pathReplaces?: Map<number, [number, number][]>;
	// Curved labels toggled off their path: the LineString converts to a Point here.
	straightens?: Map<number, [number, number]>;
	// Where along its path a curved label's text centers (arc-length fraction, D12).
	pathOffsets?: Map<number, number>;
	deletes?: Set<number>;
	texts?: Map<number, string>;
	rotations?: Map<number, number>;
	// null = explicitly cleared back to auto-width (deletes the stored property
	// rather than writing it), number = a fixed width from a drag.
	wrapWidths?: Map<number, number | null>;
}

export function applyLabelEdits(layerId: string, edits: LabelEdits, onComplete?: () => void): void {
	const working = workingTopologyData.get(layerId);
	if (!working) { onComplete?.(); return; }

	const topo = topologyToAbsolute(working);
	const objName = Object.keys(topo.objects)[0];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const obj = (topo.objects as any)[objName];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let geometries = obj.geometries as any[];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const setProp = (i: number, key: string, value: any) => {
		const g = geometries[i];
		if (g) g.properties = { ...(g.properties ?? {}), [key]: value };
	};

	if (edits.moves) {
		for (const [i, coord] of edits.moves) {
			const g = geometries[i];
			if (g?.type === 'Point') g.coordinates = [coord[0], coord[1]];
		}
	}
	// Label-layer lines each own their arc (createLabelLayer builds one per line),
	// so mutating a feature's arcs can't disturb a neighbor.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (topo as any).arcs as [number, number][][];
	if (edits.lineMoves) {
		// The Set guards the degenerate case of one geometry referencing the same arc twice.
		for (const [i, [dlon, dlat]] of edits.lineMoves) {
			const g = geometries[i];
			if (g?.type !== 'LineString' || !Array.isArray(g.arcs)) continue;
			const translated = new Set<number>();
			for (const a of g.arcs as number[]) {
				const idx = a < 0 ? ~a : a;
				if (translated.has(idx) || !arcs[idx]) continue;
				translated.add(idx);
				for (const pt of arcs[idx]) {
					pt[0] += dlon;
					pt[1] += dlat;
				}
			}
		}
	}
	if (edits.pathReplaces) {
		// The sculpted line lands in the feature's first arc; extra arc references
		// (never produced by createLabelLayer) are dropped and left orphaned, same
		// as deletions leave orphaned arcs — harmless. A Point feature converts to
		// a LineString with a fresh arc ("On path" toggled on).
		for (const [i, coords] of edits.pathReplaces) {
			const g = geometries[i];
			if (!g) continue;
			const line = coords.map((c) => [c[0], c[1]] as [number, number]);
			if (g.type === 'Point') {
				g.type = 'LineString';
				delete g.coordinates;
				g.arcs = [arcs.push(line) - 1];
			} else if (g.type === 'LineString' && Array.isArray(g.arcs) && g.arcs.length > 0) {
				const first = g.arcs[0] as number;
				const idx = first < 0 ? ~first : first;
				if (!arcs[idx]) continue;
				arcs[idx] = line;
				g.arcs = [idx];
			}
		}
	}
	if (edits.straightens) {
		// The reverse conversion: the line's arc is orphaned, the label becomes a
		// plain point where its curve's midpoint sat.
		for (const [i, coord] of edits.straightens) {
			const g = geometries[i];
			if (g?.type !== 'LineString') continue;
			g.type = 'Point';
			g.coordinates = [coord[0], coord[1]];
			delete g.arcs;
		}
	}
	const attr = layers.find((l) => l.id === layerId)?.labelAttribute;
	if (edits.texts && attr) {
		for (const [i, text] of edits.texts) setProp(i, attr, text);
	}
	if (edits.rotations) {
		for (const [i, deg] of edits.rotations) setProp(i, '__rotation', deg);
	}
	if (edits.pathOffsets) {
		for (const [i, t] of edits.pathOffsets) setProp(i, '__pathOffset', t);
	}
	if (edits.wrapWidths) {
		for (const [i, px] of edits.wrapWidths) {
			if (px === null) delete geometries[i]?.properties?.__wrapWidth;
			else setProp(i, '__wrapWidth', px);
		}
	}
	// Deletions last — the other edits index into the pre-filter positions.
	if (edits.deletes && edits.deletes.size > 0) {
		const del = edits.deletes;
		geometries = geometries.filter((_, i) => !del.has(i));
		obj.geometries = geometries;
	}

	replaceLayerGeometry(layerId, topo as Topology, { applyDefaults: false, geometryEdited: true }, onComplete);
}

export function renameLayer(id: string, name: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) layer.name = name.trim() || layer.name;
}

export function reorderLayers(newOrder: Layer[]): void {
	// Replace contents in place to keep the reactive reference intact.
	layers.splice(0, layers.length, ...newOrder);
}

// Drops raw geometry versions no longer referenced by any live layer or history snapshot.
// rawTopologyData is append-only at runtime — every geometry op mints a new geometryId and
// never overwrites an existing entry — so without this it grows unbounded across edits.
// The caller (history) supplies the full live set: current layers ∪ every stacked snapshot.
export function pruneRawTopology(liveGeometryIds: Set<string>): void {
	for (const gid of [...rawTopologyData.keys()]) {
		if (!liveGeometryIds.has(gid)) rawTopologyData.delete(gid);
	}
}

export function clearLayers(): void {
	rawTopologyData.clear();
	simplifiedTopologyData.clear();
	workingTopologyData.clear();
	layers.splice(0, layers.length);
}

// ---------------------------------------------------------------------------
// Layer-level operations (dissolve, explode, clip, difference, union, merge)
// ---------------------------------------------------------------------------

// Runs a mapshaper command and returns the output record, or null on failure.
// Shows an error toast if mapshaper throws or the expected output file is missing.
async function runMapshaper(
	cmd: string,
	inputFiles: Record<string, string>,
	outputFile = 'output.topojson',
): Promise<Record<string, string> | null> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ms = (window as any).mapshaper;
	try {
		const output = await ms.applyCommands(cmd, inputFiles) as Record<string, string>;
		if (!output[outputFile]) {
			showToast('Operation produced no output — the layers may not overlap.', 6000, 'error');
			return null;
		}
		return output;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		showToast(`Operation failed: ${message}`, 8000, 'error');
		return null;
	}
}

// Clones a topology and renames its single object to `newName`.
// Mapshaper identifies layers by the object name inside the TopoJSON file,
// not by the filename — so we must normalize before using target=/source= flags.
function withRenamedObject(topo: Topology, newName: string): Topology {
	const oldName = Object.keys(topo.objects)[0];
	const clone = JSON.parse(JSON.stringify(topo)) as Topology;
	if (oldName !== newName) {
		(clone.objects as Record<string, unknown>)[newName] = clone.objects[oldName];
		delete (clone.objects as Record<string, unknown>)[oldName];
	}
	return clone;
}

// Internal helper: insert a new layer at a specific stack index.
// Preserves the passed style when given (used by operations that replace a layer
// in place). When style is null, applyDefaults runs and picks geometry-aware defaults.
function insertLayerAt(
	name: string,
	topology: Topology,
	index: number,
	style: LayerStyle | null,
	onComplete?: () => void,
	processing?: LayerProcessing,
): void {
	const id = generateId();
	const geometryId = generateId();
	// Derived layers get a unique datasetId purely as a stable provenance label; their
	// geometry lives in rawTopologyData (by geometryId) and persists inline (geometryEdited),
	// so there's no separate dataset to register.
	const datasetId = generateId();
	const plainTopology = $state.snapshot(topology) as unknown as Topology;
	layers.splice(index, 0, {
		id,
		geometryId,
		geometryEdited: true,
		datasetId,
		name,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: style ? JSON.parse(JSON.stringify(style)) : defaultStyle(),
		processing: processing ? JSON.parse(JSON.stringify(processing)) : defaultProcessing(),
		kind: 'geometry',
		labelAttribute: null,
		labelStyle: defaultLabelStyle(),
		derivedFrom: null,
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(geometryId, plainTopology);
	runLayerPipeline(id, style === null).then(() => onComplete?.());
}

// Processing for a layer produced by editing. Simplification and Chaikin are baked into
// the geometry, so they reset; bezier is a live render from the vertices, so it carries
// over (otherwise editing a smoothed layer would silently drop the curve).
function processingForEdit(source: Layer): LayerProcessing {
	return {
		...defaultProcessing(),
		bezierEnabled: source.processing.bezierEnabled,
		bezierCurveType: source.processing.bezierCurveType,
		bezierTension: source.processing.bezierTension,
		bezierAlpha: source.processing.bezierAlpha,
		bezierContinuity: source.processing.bezierContinuity,
		bezierBias: source.processing.bezierBias,
	};
}

// Duplicates a processed layer with its current on-screen (simplified/smoothed) geometry
// baked in as the new raw, and processing reset to defaults — so the duplicate renders
// exactly as it looked but is now editable at full fidelity. The original is kept.
// Calls onReady with the new layer id once its pipeline has produced working geometry.
export function bakeLayerForEdit(sourceId: string, onReady: (newId: string) => void): void {
	const source = layers.find((l) => l.id === sourceId);
	const working = workingTopologyData.get(sourceId);
	if (!source || !working) return;

	// topologyToAbsolute gives a clean, transform-free copy so editing never mutates the
	// source layer's cached geometry.
	const baked = topologyToAbsolute(working);
	const id = generateId();
	const geometryId = generateId();
	// datasetId is a provenance label only; the baked geometry lives in rawTopologyData.
	const datasetId = generateId();

	const index = layers.findIndex((l) => l.id === sourceId);
	layers.splice(index, 0, {
		id,
		geometryId,
		geometryEdited: true,
		datasetId,
		name: `${source.name} (edited)`,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: JSON.parse(JSON.stringify(source.style)),
		processing: processingForEdit(source),
		kind: source.kind,
		labelAttribute: source.labelAttribute,
		labelStyle: JSON.parse(JSON.stringify(source.labelStyle)),
		derivedFrom: source.derivedFrom,
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(geometryId, baked);
	runLayerPipeline(id, false).then(() => onReady(id));
}

// Commits an edited draft as the layer's new geometry. Swaps geometry in place (same
// layer.id → no flash; the pre-edit raw stays alive under the previous geometryId so undo
// re-derives it). Editing bakes simplification/Chaikin into the vertices, but bezier stays
// a live render, so processing keeps bezier and resets the rest.
export function commitEditedLayer(sourceId: string, draftTopo: Topology, onComplete?: () => void): void {
	const layer = layers.find((l) => l.id === sourceId);
	if (!layer) { onComplete?.(); return; }
	layer.processing = processingForEdit(layer);
	replaceLayerGeometry(sourceId, draftTopo, { applyDefaults: false }, onComplete);
}

export function dissolveLayer(layerId: string, field: string | null, onComplete?: () => void): void {
	const layer = layers.find(l => l.id === layerId);
	const topo = workingTopologyData.get(layerId);
	if (!layer || !topo) return;

	const inputFiles = { 'input.topojson': JSON.stringify(topo) };
	const cmd = `-i input.topojson -dissolve${field ? ` ${field}` : ''} -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		// The dissolve ran on already-processed working geometry, so simplification/smoothing
		// is baked into the result. Reset processing to defaults so the pipeline doesn't apply
		// it again, then swap geometry in place: same layer.id keeps selection / table / edit
		// session valid and avoids an accordion remount, while the old raw stays alive (under
		// the previous geometryId) so undo can re-derive the pre-dissolve geometry.
		layer.processing = defaultProcessing();
		replaceLayerGeometry(layerId, result, { applyDefaults: false }, onComplete);
	});
}

export function explodeLayer(layerId: string, onComplete?: () => void): void {
	const layer = layers.find(l => l.id === layerId);
	const topo = workingTopologyData.get(layerId);
	if (!layer || !topo) return;

	const inputFiles = { 'input.topojson': JSON.stringify(topo) };
	const cmd = `-i input.topojson -explode -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		// In-place geometry swap (same layer.id → no remount/flash, old raw kept for undo).
		// Result is built from already-processed working geometry, so reset processing.
		layer.processing = defaultProcessing();
		replaceLayerGeometry(layerId, result, { applyDefaults: false }, onComplete);
	});
}

export function clipByPolygon(targetIds: string[], maskId: string, onComplete?: () => void): void {
	const maskTopo = workingTopologyData.get(maskId);
	if (!maskTopo) return;

	const targets = targetIds
		.map(id => ({
			id,
			layer: layers.find(l => l.id === id),
			topo: workingTopologyData.get(id),
		}))
		.filter((t): t is typeof t & { layer: Layer; topo: Topology } => !!(t.layer && t.topo));

	if (targets.length === 0) return;

	const clips = targets.map(t => {
		const inputFiles = {
			'layer0.topojson': JSON.stringify(withRenamedObject(t.topo, 'layer0')),
			'layer1.topojson': JSON.stringify(withRenamedObject(maskTopo, 'layer1')),
		};
		const cmd = `-i layer0.topojson layer1.topojson combine-files -clip source=layer1 target=layer0 -o output.topojson format=topojson`;
		return runMapshaper(cmd, inputFiles).then(output =>
			output ? { t, result: JSON.parse(output['output.topojson']) as Topology } : null
		);
	});

	Promise.all(clips).then(results => {
		const valid = results.filter((r): r is NonNullable<typeof r> => r !== null);
		if (valid.length === 0) { onComplete?.(); return; }
		let remaining = valid.length;
		const afterEach = () => { if (--remaining === 0) onComplete?.(); };
		for (const r of valid) {
			// Swap geometry in place (same id → no flash, old raw kept for undo); reset
			// processing since the clip ran on already-processed working geometry.
			r.t.layer.processing = defaultProcessing();
			r.t.layer.name = `${r.t.layer.name} (clipped)`;
			replaceLayerGeometry(r.t.id, r.result, { applyDefaults: false }, afterEach);
		}
	});
}

function denseBboxGeoJSON(west: number, south: number, east: number, north: number): string {
	const coords: [number, number][] = [];
	const STEP = 1;
	for (let lon = west; lon < east; lon += STEP) coords.push([lon, north]);
	coords.push([east, north]);
	for (let lat = north; lat > south; lat -= STEP) coords.push([east, lat]);
	coords.push([east, south]);
	for (let lon = east; lon > west; lon -= STEP) coords.push([lon, south]);
	coords.push([west, south]);
	for (let lat = south; lat < north; lat += STEP) coords.push([west, lat]);
	coords.push([west, north]);
	return JSON.stringify({
		type: 'FeatureCollection',
		features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }],
	});
}

export function clipByBbox(layerIds: string[], bbox: [number, number, number, number], onComplete?: () => void): void {
	const [west, south, east, north] = bbox;

	const targets = layerIds
		.map(id => ({
			id,
			layer: layers.find(l => l.id === id),
			topo: workingTopologyData.get(id),
		}))
		.filter((t): t is typeof t & { layer: Layer; topo: Topology } => !!(t.layer && t.topo));

	if (targets.length === 0) return;

	const bboxGeoJSON = denseBboxGeoJSON(west, south, east, north);

	const clips = targets.map(t => {
		const inputFiles = {
			'input.topojson': JSON.stringify(withRenamedObject(t.topo, 'input')),
			'bbox_mask.geojson': bboxGeoJSON,
		};
		const cmd = `-i input.topojson bbox_mask.geojson combine-files -clip source=bbox_mask target=input -o output.topojson format=topojson`;
		return runMapshaper(cmd, inputFiles).then(output =>
			output ? { t, result: JSON.parse(output['output.topojson']) as Topology } : null
		);
	});

	Promise.all(clips).then(results => {
		const valid = results.filter((r): r is NonNullable<typeof r> => r !== null);
		if (valid.length === 0) { onComplete?.(); return; }
		let remaining = valid.length;
		const afterEach = () => { if (--remaining === 0) onComplete?.(); };
		for (const r of valid) {
			// In-place swap (same id → no flash, old raw kept for undo); reset processing.
			r.t.layer.processing = defaultProcessing();
			r.t.layer.name = `${r.t.layer.name} (clipped)`;
			replaceLayerGeometry(r.t.id, r.result, { applyDefaults: false }, afterEach);
		}
	});
}

export function differenceLayers(targetId: string, maskId: string, onComplete?: () => void): void {
	const targetLayer = layers.find(l => l.id === targetId);
	const targetTopo = workingTopologyData.get(targetId);
	const maskTopo = workingTopologyData.get(maskId);
	if (!targetLayer || !targetTopo || !maskTopo) return;

	const inputFiles = {
		'layer0.topojson': JSON.stringify(withRenamedObject(targetTopo, 'layer0')),
		'layer1.topojson': JSON.stringify(withRenamedObject(maskTopo, 'layer1')),
	};
	const cmd = `-i layer0.topojson layer1.topojson combine-files -erase source=layer1 target=layer0 -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		// In-place swap on the target (same id → no flash, old raw kept for undo); reset
		// processing since the erase ran on already-processed working geometry.
		targetLayer.processing = defaultProcessing();
		targetLayer.name = `${targetLayer.name} (subtracted)`;
		replaceLayerGeometry(targetId, result, { applyDefaults: false }, onComplete);
	});
}

export function mosaicLayer(layerId: string, onComplete?: () => void): void {
	const layer = layers.find(l => l.id === layerId);
	const topo = workingTopologyData.get(layerId);
	if (!layer || !topo) return;

	const inputFiles = { 'input.topojson': JSON.stringify(topo) };
	const cmd = `-i input.topojson -mosaic -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		// In-place swap (same id → no flash, old raw kept for undo); reset processing.
		layer.processing = defaultProcessing();
		layer.name = `${layer.name} (mosaic)`;
		replaceLayerGeometry(layerId, result, { applyDefaults: false }, onComplete);
	});
}

export function unionLayers(layerIds: string[], onComplete?: () => void): void {
	const selected = layerIds.map(id => layers.find(l => l.id === id)).filter((l): l is Layer => !!l);
	if (selected.length < 2) return;

	const insertIndex = Math.min(...layerIds.map(id => layers.findIndex(l => l.id === id)));
	const inputFiles: Record<string, string> = {};
	const inputNames: string[] = [];
	for (let i = 0; i < selected.length; i++) {
		const topo = workingTopologyData.get(selected[i].id);
		if (!topo) continue;
		const name = `layer${i}.topojson`;
		inputFiles[name] = JSON.stringify(withRenamedObject(topo, `layer${i}`));
		inputNames.push(name);
	}
	if (inputNames.length < 2) return;

	const resultName = selected.length === 2
		? `${selected[0].name} + ${selected[1].name} (mosaic)`
		: `${selected[0].name} + ${selected.length - 1} more (mosaic)`;

	const cmd = `-i ${inputNames.join(' ')} combine-files -union -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		// Remove in descending stack order so lower indices stay stable until we reach them.
		const byDescIndex = [...layerIds].sort((a, b) =>
			layers.findIndex(l => l.id === b) - layers.findIndex(l => l.id === a)
		);
		for (const id of byDescIndex) removeLayer(id);
		insertLayerAt(resultName, result, insertIndex, null, onComplete);
	});
}

export function mergeLayers(layerIds: string[], onComplete?: () => void): void {
	const selected = layerIds.map(id => layers.find(l => l.id === id)).filter((l): l is Layer => !!l);
	if (selected.length < 2) return;

	const insertIndex = Math.min(...layerIds.map(id => layers.findIndex(l => l.id === id)));
	const inputFiles: Record<string, string> = {};
	const inputNames: string[] = [];
	for (let i = 0; i < selected.length; i++) {
		const topo = workingTopologyData.get(selected[i].id);
		if (!topo) continue;
		const name = `layer${i}.topojson`;
		inputFiles[name] = JSON.stringify(withRenamedObject(topo, `layer${i}`));
		inputNames.push(name);
	}
	if (inputNames.length < 2) return;

	const resultName = selected.length === 2
		? `${selected[0].name} + ${selected[1].name}`
		: `${selected[0].name} + ${selected.length - 1} more`;

	const cmd = `-i ${inputNames.join(' ')} combine-files -merge-layers force -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		const byDescIndex = [...layerIds].sort((a, b) =>
			layers.findIndex(l => l.id === b) - layers.findIndex(l => l.id === a)
		);
		for (const id of byDescIndex) removeLayer(id);
		insertLayerAt(resultName, result, insertIndex, null, onComplete);
	});
}

// ---------------------------------------------------------------------------
// Feature-level operations (delete, extract)
// ---------------------------------------------------------------------------

// featureIndices contains indices into topology.objects[name].geometries.
// For homogeneous layers (all non-point or all point) this matches the
// chunk / hit-decode index directly. Mixed-geometry layers need a proper
// chunk→feature mapping — tracked as a TODO for the multiselect work.

export function deleteSelectedFeatures(
	layerId: string,
	featureIndices: Set<number>,
	onComplete?: () => void,
): void {
	const layer = layers.find((l) => l.id === layerId);
	if (!layer) return;
	const rawTopo = rawTopologyData.get(layer.geometryId);
	if (!rawTopo) return;

	// Clone raw and drop the selected geometries. We filter raw (not working) so the layer's
	// preserved processing re-derives the same simplification on the reduced geometry.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const newTopo = JSON.parse(JSON.stringify(rawTopo)) as typeof rawTopo;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = newTopo as any;
	const objectName = Object.keys(anyTopo.objects)[0];
	anyTopo.objects[objectName].geometries = anyTopo.objects[objectName].geometries
		.filter((_: unknown, i: number) => !featureIndices.has(i));

	// Swap geometry in place (same layer.id → no flash; the pre-delete raw stays alive under
	// the previous geometryId so undo restores it). Unlike the other ops, processing is NOT
	// reset — the reduced geometry is still raw, so the same simplification should re-apply.
	replaceLayerGeometry(layerId, newTopo, { applyDefaults: false }, onComplete);
}

function geometryFamily(type: string): string {
	if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
	if (type === 'LineString' || type === 'MultiLineString') return 'line';
	if (type === 'Point' || type === 'MultiPoint') return 'point';
	return 'unknown';
}

export function isMergeCompatible(featuresMap: Map<string, Set<number>>): boolean {
	const families = new Set<string>();
	for (const [layerId, featureIndices] of featuresMap) {
		const rawTopo = workingTopologyData.get(layerId);
		if (!rawTopo) continue;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyTopo = rawTopo as any;
		const objectName = Object.keys(anyTopo.objects)[0];
		const geometries = anyTopo.objects[objectName].geometries;
		for (const idx of featureIndices) {
			const type = geometries[idx]?.type;
			if (type) families.add(geometryFamily(type));
		}
	}
	return families.size <= 1;
}

export function extractSelectedFeatures(
	layerId: string,
	featureIndices: Set<number>,
	onComplete?: () => void,
): void {
	const layer = layers.find((l) => l.id === layerId);
	const rawTopo = workingTopologyData.get(layerId);
	if (!layer || !rawTopo) return;

	// Clone and keep only the selected geometries for the new layer.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const extractedTopo = JSON.parse(JSON.stringify(rawTopo)) as typeof rawTopo;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const extractedAny = extractedTopo as any;
	const objectName = Object.keys(extractedAny.objects)[0];
	extractedAny.objects[objectName].geometries = extractedAny.objects[objectName].geometries
		.filter((_: unknown, i: number) => featureIndices.has(i));

	// Copy only — features remain in the source layer.
	insertLayerAt(`${layer.name} (copy)`, extractedTopo, layers.findIndex(l => l.id === layerId), layer.style, onComplete);
}

export function mergeSelectedFeatures(
	featuresMap: Map<string, Set<number>>,
	onComplete?: () => void,
): void {
	const inputFiles: Record<string, string> = {};
	const inputNames: string[] = [];
	const layerNames: string[] = [];

	for (const [layerId, featureIndices] of featuresMap) {
		const layer = layers.find((l) => l.id === layerId);
		const rawTopo = workingTopologyData.get(layerId);
		if (!layer || !rawTopo) continue;

		layerNames.push(layer.name);

		const clonedTopo = JSON.parse(JSON.stringify(rawTopo)) as typeof rawTopo;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyTopo = clonedTopo as any;
		const objectName = Object.keys(anyTopo.objects)[0];
		anyTopo.objects[objectName].geometries = anyTopo.objects[objectName].geometries
			.filter((_: unknown, i: number) => featureIndices.has(i));

		const fileName = `layer${inputNames.length}.topojson`;
		inputFiles[fileName] = JSON.stringify(clonedTopo);
		inputNames.push(fileName);
	}

	if (inputNames.length === 0) return;

	const name =
		layerNames.length === 2
			? `${layerNames[0]} + ${layerNames[1]}`
			: `${layerNames[0]} + ${layerNames.length - 1} more`;

	const cmd = `-i ${inputNames.join(' ')} combine-files -merge-layers force -o output.topojson format=topojson`;
	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const topology = JSON.parse(output['output.topojson']) as Topology;
		const uploadId = 'merge_' + Math.random().toString(36).slice(2, 9);
		addUploadedLayer(name, topology, uploadId, false, onComplete);
	});
}

// Signals that a drag-to-reorder gesture is in progress.
// The cache effect in MapCanvas reads this to bail out early — path computation
// is wasted during drag since all paths are already cached.
export const layerDrag = $state({ active: false });

export { layers, rawTopologyData, workingTopologyData };
