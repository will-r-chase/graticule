import type { Layer, LayerStyle, LayerProcessing } from '$lib/types';
import { layers, rawTopologyData, clearLayers, addUploadedLayer, runLayerPipeline, defaultProcessing } from '$lib/stores/layers.svelte';
import { uploadedDatasets, clearUploadedDatasets } from '$lib/stores/uploadedDatasets.svelte';
import { projection } from '$lib/stores/projection.svelte';
import { catalog } from '$lib/stores/catalog.svelte';
import type { Topology } from 'topojson-specification';

const PROJECT_VERSION = '1';
const SIZE_WARNING_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Serialised shape (what goes into the .json file)
//
// IMPORTANT: any new feature that affects map output must be reflected here.
// That includes new layer style properties, canvas settings, projection
// parameters, label config, clip regions, etc. If it changes what the user
// sees, it should be saved and restored.
// ---------------------------------------------------------------------------

interface SavedLayer {
	id: string;
	datasetId: string;
	name: string;
	visible: boolean;
	style: LayerStyle;
	processing: LayerProcessing;
	// 'catalog' layers re-fetch on load; 'upload' layers carry their GeoJSON
	source: 'catalog' | 'upload';
}

interface SavedUploadedDataset {
	id: string;
	name: string;
	topology: Topology;
}

interface ProjectFile {
	version: string;
	projectionId: string;
	layers: SavedLayer[];
	uploadedDatasets: SavedUploadedDataset[];
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveResult {
	sizeBytes: number;
	overLimit: boolean;
	json: string;
}

export function prepareProject(): SaveResult {
	const savedLayers: SavedLayer[] = layers.map((l) => ({
		id: l.id,
		datasetId: l.datasetId,
		name: l.name,
		visible: l.visible,
		style: { ...l.style },
		processing: { ...l.processing },
		source: uploadedDatasets.some((u) => u.id === l.datasetId) ? 'upload' : 'catalog',
	}));

	const savedUploads: SavedUploadedDataset[] = uploadedDatasets.map((u) => ({
		id: u.id,
		name: u.name,
		topology: u.topology,
	}));

	const project: ProjectFile = {
		version: PROJECT_VERSION,
		projectionId: projection.id,
		layers: savedLayers,
		uploadedDatasets: savedUploads,
	};

	const json = JSON.stringify(project, null, 2);
	return {
		sizeBytes: new TextEncoder().encode(json).length,
		overLimit: new TextEncoder().encode(json).length > SIZE_WARNING_BYTES,
		json,
	};
}

export function downloadProject(json: string): void {
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'project.json';
	a.click();
	URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validateProject(json: string): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error('Invalid JSON');
	}
	if (
		typeof parsed !== 'object' || parsed === null ||
		typeof (parsed as Record<string, unknown>).version !== 'string' ||
		!Array.isArray((parsed as Record<string, unknown>).layers)
	) {
		throw new Error('Not a valid project file');
	}
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export function loadProject(json: string): void {
	const project = JSON.parse(json) as ProjectFile;

	// Clear existing session
	clearLayers();
	clearUploadedDatasets();

	// Restore projection
	projection.id = project.projectionId ?? 'geoMercator';

	// Restore uploaded datasets (topology stored inline in the project file)
	for (const u of project.uploadedDatasets ?? []) {
		uploadedDatasets.push({ id: u.id, name: u.name, topology: u.topology });
	}

	// Restore layers
	for (const saved of project.layers ?? []) {
		if (saved.source === 'upload') {
			// Find the matching uploaded dataset and add the layer directly.
			// Pass applyDefaults=false so the pipeline doesn't overwrite the saved style.
			const uploaded = uploadedDatasets.find((u) => u.id === saved.datasetId);
			if (uploaded) {
				addUploadedLayer(saved.name, uploaded.topology, saved.datasetId, false);
				// Apply saved style, processing + visibility on the layer object immediately.
				// The pipeline runs as a microtask after this, but won't touch style
				// since applyDefaults=false.
				const l = layers.find((l) => l.datasetId === saved.datasetId);
				if (l) {
					l.visible = saved.visible;
					Object.assign(l.style, saved.style);
					if (saved.processing) Object.assign(l.processing, saved.processing);
				}
			}
		} else {
			// Catalog layer — find dataset and re-fetch, then run the pipeline with
			// the saved processing settings (already set on the layer before fetch).
			const dataset = catalog.datasets.find((d) => d.id === saved.datasetId);
			if (!dataset) continue;

			layers.push({
				id: saved.id,
				datasetId: saved.datasetId,
				name: saved.name,
				visible: saved.visible,
				loading: true,
				error: null,
				hasTopology: false,
				style: { ...saved.style },
				processing: saved.processing ? { ...saved.processing } : defaultProcessing(),
				geometryTypes: [],
			});

			fetch(`${catalog.baseURL}/${dataset.filePath}`)
				.then((r) => {
					if (!r.ok) throw new Error(`HTTP ${r.status}`);
					return r.json() as Promise<Topology>;
				})
				.then((topology) => {
					rawTopologyData.set(saved.id, topology);
					// applyDefaults=false — saved style is already on the layer
					return runLayerPipeline(saved.id, false);
				})
				.catch((err) => {
					const l = layers.find((l) => l.id === saved.id);
					if (l) { l.error = err.message; l.loading = false; }
				});
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

