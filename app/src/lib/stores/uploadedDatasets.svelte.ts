import type { UploadedDataset } from '$lib/types';
import type { Topology } from 'topojson-specification';

let uploadedDatasets = $state<UploadedDataset[]>([]);

function generateId(): string {
	return 'upload_' + Math.random().toString(36).slice(2, 9);
}

export function addUploadedDataset(name: string, topology: Topology): UploadedDataset {
	const id = generateId();
	const dataset: UploadedDataset = { id, name, topology };
	uploadedDatasets.push(dataset);
	return dataset;
}


export function pruneUploadedDatasets(activeDatasetIds: Set<string>): void {
	const pruned = uploadedDatasets.filter((u) => activeDatasetIds.has(u.id));
	uploadedDatasets.splice(0, uploadedDatasets.length, ...pruned);
}

export function clearUploadedDatasets(): void {
	uploadedDatasets.splice(0, uploadedDatasets.length);
}

export { uploadedDatasets };
