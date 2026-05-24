import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Layer, Dataset } from '$lib/types';
import { catalog } from './catalog.svelte';

// Reactive array of layers currently added to the map.
// Components import `layers` to read, and call the functions below to modify.
let layers = $state<Layer[]>([]);

// GeoJSON data stored outside $state so Svelte never wraps it in a reactive
// proxy. Accessing large GeoJSON through a reactive proxy causes Svelte to
// call deep_read() — traversing every coordinate — on each reactive update.
// layer.hasData signals when data is ready; layerData holds the actual value.
const layerData = new Map<string, unknown>();

// Generates a simple unique ID for each layer instance.
function generateId(): string {
	return Math.random().toString(36).slice(2, 9);
}

// Default style for a new layer — no fill, dark stroke.
function defaultStyle() {
	return {
		fill: 'none',
		fillOpacity: 1,
		stroke: '#161819',
		strokeOpacity: 1,
		strokeWidth: 0.5,
	};
}

// Fetches a single TopoJSON file and populates the given layer.
function fetchTopoJSON(id: string, url: string, objectName: string): void {
	fetch(url)
		.then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json() as Promise<Topology>;
		})
		.then((topology) => {
			const geojson = feature(topology, topology.objects[objectName]);
			setLayerData(id, geojson);
		})
		.catch((err) => {
			setLayerError(id, err.message);
		});
}

export function addLayer(dataset: Dataset): void {
	const copies = layers.filter((l) => l.datasetId === dataset.id).length;

	if (dataset.layers && dataset.layers.length > 0) {
		// Multi-layer dataset (e.g. Project Linework) — add one map layer per sub-layer.
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
				hasData: false,
				style: defaultStyle(),
			});

			fetchTopoJSON(id, `${catalog.baseURL}/${subLayer.filePath}`, subLayer.objectName);
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
			hasData: false,
			style: defaultStyle(),
		});

		// The object name is the first key in the topology's objects map.
		fetch(`${catalog.baseURL}/${dataset.filePath}`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<Topology>;
			})
			.then((topology) => {
				const objectName = Object.keys(topology.objects)[0];
				const geojson = feature(topology, topology.objects[objectName]);
				setLayerData(id, geojson);
			})
			.catch((err) => {
				setLayerError(id, err.message);
			});
	}
}

export function removeLayer(id: string): void {
	const index = layers.findIndex((l) => l.id === id);
	if (index !== -1) {
		layers.splice(index, 1);
		layerData.delete(id);
	}
}

export function toggleVisibility(id: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) layer.visible = !layer.visible;
}

export function setLayerData(id: string, data: unknown): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) {
		layerData.set(id, data);
		layer.hasData = true;
		layer.loading = false;
	}
}

export function setLayerError(id: string, error: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) {
		layer.error = error;
		layer.loading = false;
	}
}

export function renameLayer(id: string, name: string): void {
	const layer = layers.find((l) => l.id === id);
	if (layer) layer.name = name.trim() || layer.name;
}

export function reorderLayers(newOrder: Layer[]): void {
	// Replace contents in place to keep the reactive reference intact.
	layers.splice(0, layers.length, ...newOrder);
}

export { layers, layerData };
