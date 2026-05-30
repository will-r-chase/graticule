import type { Topology } from 'topojson-specification';
import type { Layer, LayerStyle, LayerProcessing, Dataset } from '$lib/types';
import { catalog } from './catalog.svelte';
import { countTopoPoints } from '$lib/utils/chaikin';
import { workerChaikin } from '$lib/workers/geoWorker';
import { workerSimplify } from '$lib/workers/simplifyWorker';
import { showToast } from './toast.svelte';

const DISPLAY_VERTEX_THRESHOLD = 500_000;
const DISPLAY_SIMP_TOLERANCE = 70;

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
			showToast('Large dataset auto-simplified to 70% for performance. Adjust in the layer\'s Process panel.');
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

			layers.push({
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

		layers.push({
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

export function addUploadedLayer(name: string, topology: Topology, uploadId: string, applyDefaults = true): void {
	const id = generateId();
	layers.push({
		id,
		datasetId: uploadId,
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
	rawTopologyData.set(id, topology);
	runLayerPipeline(id, applyDefaults); // resolves as a microtask — layer will be ready almost immediately
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

// Signals that a drag-to-reorder gesture is in progress.
// The cache effect in MapCanvas reads this to bail out early — path computation
// is wasted during drag since all paths are already cached.
export const layerDrag = $state({ active: false });

export { layers, rawTopologyData, workingTopologyData };
