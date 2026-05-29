import type { Topology } from 'topojson-specification';
import type { Layer, LayerStyle, LayerProcessing, Dataset } from '$lib/types';
import { catalog } from './catalog.svelte';
import { applyChaikinToTopology, countTopoPoints } from '$lib/utils/chaikin';
import { showToast } from './toast.svelte';

const DISPLAY_VERTEX_THRESHOLD = 500_000;
const DISPLAY_SIMP_TOLERANCE = 70;

// Reactive array of layers currently added to the map.
// Components import `layers` to read, and call the functions below to modify.
let layers = $state<Layer[]>([]);

// Topology data — stored outside $state so Svelte never wraps it in a reactive
// proxy. Accessing large topology/GeoJSON through a reactive proxy causes Svelte
// to call deep_read() — traversing every coordinate — on each reactive update.
// rawTopologyData: the original topology as fetched/converted (never mutated).
// workingTopologyData: the processed topology after the pipeline (simplify → Chaikin).
// layer.hasTopology signals when workingTopologyData is ready to render.
const rawTopologyData = new Map<string, Topology>();
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

// Reads rawTopologyData for the given layer, applies any enabled processing
// (simplification → Chaikin), and writes the result to workingTopologyData.
// Geometry types are detected directly from the topology so we never need to
// materialise a full GeoJSON FeatureCollection here.
// applyDefaults: pass true on first load so geometry-aware style defaults are
// set; pass false on subsequent runs to preserve the user's style choices.
export async function runLayerPipeline(id: string, applyDefaults = true): Promise<void> {
	const rawTopo = rawTopologyData.get(id);
	const layer = layers.find((l) => l.id === id);
	if (!rawTopo || !layer) return;

	// Yield to the event loop before any heavy synchronous work (e.g. JSON.stringify
	// of a large topology for Mapshaper). This lets Svelte flush pending reactive
	// updates — like layer.loading = true — so the UI can reflect the loading state
	// before the thread is blocked.
	await Promise.resolve();

	// Auto-simplify large datasets on first load so they render at a usable speed.
	// This sets the processing state the same way the user would — visible in the
	// Process panel and adjustable at any time.
	if (applyDefaults && !layer.processing.simpEnabled) {
		const pointCount = countTopoPoints(rawTopo);
		if (pointCount > DISPLAY_VERTEX_THRESHOLD) {
			layer.processing.simpEnabled = true;
			layer.processing.simpTolerance = DISPLAY_SIMP_TOLERANCE;
			showToast('Large dataset auto-simplified to 70% for performance. Adjust in the layer\'s Process panel.');
		}
	}

	let topo: Topology = rawTopo;

	// Step 1 — Mapshaper simplification (topology-aware).
	if (layer.processing.simpEnabled) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ms = (window as any).mapshaper;
		if (ms) {
			const retainPct = 100 - layer.processing.simpTolerance;
			const keepShapes = layer.processing.simpKeepShapes ? 'keep-shapes' : '';
			const weightParam = layer.processing.simpAlgorithm === 'weighted'
				? `weighting=${layer.processing.simpWeight}` : '';
			const cmd = `-i input.topojson -simplify ${retainPct}% ${layer.processing.simpAlgorithm} ${weightParam} ${keepShapes} -o output.topojson format=topojson`
				.replace(/\s+/g, ' ').trim();
			const output = await ms.applyCommands(cmd, { 'input.topojson': JSON.stringify(topo) });
			topo = JSON.parse(output['output.topojson']) as Topology;
		}
	}

	// Step 2 — Chaikin smoothing.
	if (layer.processing.chaikinEnabled) {
		topo = applyChaikinToTopology(topo, layer.processing.chaikinIterations);
	}

	// Store the processed topology.
	workingTopologyData.set(id, topo);

	// Detect geometry types directly from the topology objects — no need to
	// materialise GeoJSON just to read the type strings.
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

	layer.loading     = false;
	layer.hasTopology = true;
}

// Updates a layer's processing settings and re-runs the pipeline.
// Called by the processing UI panel when the user changes any setting.
export function updateLayerProcessing(id: string, patch: Partial<LayerProcessing>, onComplete?: () => void): void {
	const layer = layers.find((l) => l.id === id);
	if (!layer) return;
	Object.assign(layer.processing, patch);
	// Signal MapCanvas to clear the stale path cache entry; runLayerPipeline
	// will set hasTopology back to true once the new topology is ready.
	layer.hasTopology = false;
	layer.loading = true;
	// onComplete fires after the pipeline resolves — callers use this to push
	// a history snapshot only once the final state is ready (not the transient
	// hasTopology=false loading state, which would break undo).
	runLayerPipeline(id, false).then(() => onComplete?.());
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
	workingTopologyData.clear();
	layers.splice(0, layers.length);
}

export { layers, rawTopologyData, workingTopologyData };
