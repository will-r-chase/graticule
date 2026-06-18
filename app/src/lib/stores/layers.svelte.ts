import type { Topology } from 'topojson-specification';
import type { Layer, LayerStyle, LayerProcessing, Dataset } from '$lib/types';
import { catalog } from './catalog.svelte';
import { countTopoPoints } from '$lib/utils/chaikin';
import { topologyToAbsolute } from '$lib/utils/topology';
import { workerChaikin } from '$lib/workers/geoWorker';
import { workerSimplify } from '$lib/workers/simplifyWorker';
import { showToast } from './toast.svelte';
import { registerDataset } from './uploadedDatasets.svelte';

const DISPLAY_VERTEX_THRESHOLD = 500_000;
const DISPLAY_SIMP_TOLERANCE = 90;

// Reactive array of layers currently added to the map.
// Components import `layers` to read, and call the functions below to modify.
let layers = $state<Layer[]>([]);

// Topology data — stored outside $state so Svelte never wraps it in a reactive
// proxy. Accessing large topology/GeoJSON through a reactive proxy causes Svelte
// to call deep_read() — traversing every coordinate — on each reactive update.
//
// rawTopologyData:        original topology as fetched/converted (never mutated).
// simplifiedTopologyData: post-Mapshaper, pre-Chaikin. Internal pipeline cache —
//                         no consumer outside layers.svelte.ts should read this.
// workingTopologyData:    post-Chaikin (or same reference as simplified if Chaikin
//                         is disabled). This is what all renderers and exporters use.
// layer.hasTopology signals when workingTopologyData is ready to render.
const rawTopologyData = new Map<string, Topology>();
const simplifiedTopologyData = new Map<string, Topology>();
const workingTopologyData = new Map<string, Topology>();

// Generates a simple unique ID for each layer instance.
function generateId(): string {
	return Math.random().toString(36).slice(2, 9);
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
	const rawTopo = rawTopologyData.get(id);
	const layer = layers.find((l) => l.id === id);
	if (!rawTopo || !layer) return;

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
function fetchTopoJSON(id: string, url: string, onComplete?: () => void): void {
	fetch(url)
		.then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json() as Promise<Topology>;
		})
		.then((topology) => {
			rawTopologyData.set(id, topology);
			return runLayerPipeline(id);
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
				datasetId: dataset.id,
				name: `${baseName} — ${subLayer.name}`,
				visible: true,
				loading: true,
				error: null,
				hasTopology: false,
				style: defaultStyle(),
				processing: defaultProcessing(),
				geometryTypes: [],
				bezierCacheKey: 0,
			});

			fetchTopoJSON(id, `${catalog.baseURL}/${subLayer.filePath}`, onSubComplete);
		}
	} else {
		// Single-layer dataset — existing behaviour.
		const id = generateId();
		const name = copies === 0 ? dataset.name : `${dataset.name} (${copies + 1})`;

		layers.unshift({
			id,
			datasetId: dataset.id,
			name,
			visible: true,
			loading: true,
			error: null,
			hasTopology: false,
			style: defaultStyle(),
			processing: defaultProcessing(),
			geometryTypes: [],
			bezierCacheKey: 0,
		});

		fetch(`${catalog.baseURL}/${dataset.filePath}`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<Topology>;
			})
			.then((topology) => {
				rawTopologyData.set(id, topology);
				return runLayerPipeline(id);
			})
			.then(() => {
				onComplete?.();
			})
			.catch((err) => {
				setLayerError(id, err.message);
			});
	}
}

export function addUploadedLayer(name: string, topology: Topology, uploadId: string, applyDefaults = true, onComplete?: () => void, style?: LayerStyle): void {
	const id = generateId();
	// Strip any Svelte reactive Proxy wrapper before the topology enters the pipeline.
	// Proxies can't be structured-cloned, which causes postMessage to the geo worker to fail.
	const plainTopology = $state.snapshot(topology) as unknown as Topology;
	layers.unshift({
		id,
		datasetId: uploadId,
		name,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: style ? JSON.parse(JSON.stringify(style)) : defaultStyle(),
		processing: defaultProcessing(),
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(id, plainTopology);
	runLayerPipeline(id, applyDefaults).then(() => onComplete?.());
}

export function duplicateLayer(id: string): void {
	const index = layers.findIndex((l) => l.id === id);
	if (index === -1) return;
	const source = layers[index];
	const newId = generateId();

	// Deep-copy style and processing so changes to the duplicate don't affect the original.
	const newLayer: Layer = {
		...source,
		id: newId,
		name: `${source.name} copy`,
		// Reset transient state.
		loading: false,
		error: null,
		style: JSON.parse(JSON.stringify(source.style)),
		processing: JSON.parse(JSON.stringify(source.processing)),
	};

	// Copy all topology caches so the duplicate is immediately renderable and can
	// re-run the pipeline from raw data if the user changes processing settings.
	const raw = rawTopologyData.get(id);
	if (raw) rawTopologyData.set(newId, raw);
	const simplified = simplifiedTopologyData.get(id);
	if (simplified) simplifiedTopologyData.set(newId, simplified);
	const working = workingTopologyData.get(id);
	if (working) workingTopologyData.set(newId, working);

	// Insert immediately above the original.
	layers.splice(index, 0, newLayer);
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

export function renameLayer(id: string, name: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) layer.name = name.trim() || layer.name;
}

export function reorderLayers(newOrder: Layer[]): void {
	// Replace contents in place to keep the reactive reference intact.
	layers.splice(0, layers.length, ...newOrder);
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
	const datasetId = generateId();
	const plainTopology = $state.snapshot(topology) as unknown as Topology;
	registerDataset(datasetId, plainTopology);
	layers.splice(index, 0, {
		id,
		datasetId,
		name,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: style ? JSON.parse(JSON.stringify(style)) : defaultStyle(),
		processing: processing ? JSON.parse(JSON.stringify(processing)) : defaultProcessing(),
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(id, plainTopology);
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
	const datasetId = generateId();
	registerDataset(datasetId, baked);

	const index = layers.findIndex((l) => l.id === sourceId);
	layers.splice(index, 0, {
		id,
		datasetId,
		name: `${source.name} (edited)`,
		visible: true,
		loading: true,
		error: null,
		hasTopology: false,
		style: JSON.parse(JSON.stringify(source.style)),
		processing: processingForEdit(source),
		geometryTypes: [],
		bezierCacheKey: 0,
	});
	rawTopologyData.set(id, baked);
	runLayerPipeline(id, false).then(() => onReady(id));
}

// Commits an edited draft as a NEW layer replacing the one being edited: removes the
// source (its raw stays in the caches so undo can re-derive the pre-edit geometry) and
// inserts a fresh layer with the draft as raw at the same z-index, name, and style. The
// new id is what keeps vertex editing undoable.
export function commitEditedLayer(sourceId: string, draftTopo: Topology, onComplete?: () => void): void {
	const source = layers.find((l) => l.id === sourceId);
	if (!source) { onComplete?.(); return; }
	const index = layers.findIndex((l) => l.id === sourceId);
	const { name, style } = source;
	const processing = processingForEdit(source);
	removeLayer(sourceId);
	insertLayerAt(name, draftTopo, index, style, onComplete, processing);
}

export function dissolveLayer(layerId: string, field: string | null, onComplete?: () => void): void {
	const layer = layers.find(l => l.id === layerId);
	const topo = workingTopologyData.get(layerId);
	if (!layer || !topo) return;

	const index = layers.findIndex(l => l.id === layerId);
	const inputFiles = { 'input.topojson': JSON.stringify(topo) };
	const cmd = `-i input.topojson -dissolve${field ? ` ${field}` : ''} -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		removeLayer(layerId);
		insertLayerAt(layer.name, result, index, layer.style, onComplete);
	});
}

export function explodeLayer(layerId: string, onComplete?: () => void): void {
	const layer = layers.find(l => l.id === layerId);
	const topo = workingTopologyData.get(layerId);
	if (!layer || !topo) return;

	const index = layers.findIndex(l => l.id === layerId);
	const inputFiles = { 'input.topojson': JSON.stringify(topo) };
	const cmd = `-i input.topojson -explode -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		removeLayer(layerId);
		insertLayerAt(layer.name, result, index, layer.style, onComplete);
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
			index: layers.findIndex(l => l.id === id),
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
			removeLayer(r.t.id);
			insertLayerAt(`${r.t.layer.name} (clipped)`, r.result, r.t.index, r.t.layer.style, afterEach);
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
			index: layers.findIndex(l => l.id === id),
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
			removeLayer(r.t.id);
			insertLayerAt(`${r.t.layer.name} (clipped)`, r.result, r.t.index, r.t.layer.style, afterEach);
		}
	});
}

export function differenceLayers(targetId: string, maskId: string, onComplete?: () => void): void {
	const targetLayer = layers.find(l => l.id === targetId);
	const targetTopo = workingTopologyData.get(targetId);
	const maskTopo = workingTopologyData.get(maskId);
	if (!targetLayer || !targetTopo || !maskTopo) return;

	const index = layers.findIndex(l => l.id === targetId);
	const inputFiles = {
		'layer0.topojson': JSON.stringify(withRenamedObject(targetTopo, 'layer0')),
		'layer1.topojson': JSON.stringify(withRenamedObject(maskTopo, 'layer1')),
	};
	const cmd = `-i layer0.topojson layer1.topojson combine-files -erase source=layer1 target=layer0 -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		removeLayer(targetId);
		insertLayerAt(`${targetLayer.name} (subtracted)`, result, index, targetLayer.style, onComplete);
	});
}

export function mosaicLayer(layerId: string, onComplete?: () => void): void {
	const layer = layers.find(l => l.id === layerId);
	const topo = workingTopologyData.get(layerId);
	if (!layer || !topo) return;

	const index = layers.findIndex(l => l.id === layerId);
	const inputFiles = { 'input.topojson': JSON.stringify(topo) };
	const cmd = `-i input.topojson -mosaic -o output.topojson format=topojson`;

	runMapshaper(cmd, inputFiles).then(output => {
		if (!output) return;
		const result = JSON.parse(output['output.topojson']) as Topology;
		removeLayer(layerId);
		insertLayerAt(`${layer.name} (mosaic)`, result, index, layer.style, onComplete);
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
	const rawTopo = rawTopologyData.get(layerId);
	if (!layer || !rawTopo) return;

	const index = layers.findIndex((l) => l.id === layerId);

	// Clone raw and drop the selected geometries. We filter raw (not working) so
	// the new layer's preserved processing re-derives the same simplification.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const newTopo = JSON.parse(JSON.stringify(rawTopo)) as typeof rawTopo;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = newTopo as any;
	const objectName = Object.keys(anyTopo.objects)[0];
	anyTopo.objects[objectName].geometries = anyTopo.objects[objectName].geometries
		.filter((_: unknown, i: number) => !featureIndices.has(i));

	// Model delete like the other geometry ops: drop the old layer (its raw stays
	// in the Maps so undo can restore it) and insert a new layer id holding the
	// reduced geometry, preserving the original style and processing.
	removeLayer(layerId);
	insertLayerAt(layer.name, newTopo, index, layer.style, onComplete, layer.processing);
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
