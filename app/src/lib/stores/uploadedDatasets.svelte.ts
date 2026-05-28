import type { UploadedDataset } from '$lib/types';
import type { Topology } from 'topojson-specification';
import { addUploadedLayer } from './layers.svelte';

let uploadedDatasets = $state<UploadedDataset[]>([]);

function generateId(): string {
	return 'upload_' + Math.random().toString(36).slice(2, 9);
}

export function addUploadedDataset(name: string, topology: Topology): UploadedDataset {
	const id = generateId();
	const dataset: UploadedDataset = { id, name, topology };
	uploadedDatasets.push(dataset);
	addUploadedLayer(name, topology, id);
	return dataset;
}

export function clearUploadedDatasets(): void {
	uploadedDatasets.splice(0, uploadedDatasets.length);
}

export { uploadedDatasets };
