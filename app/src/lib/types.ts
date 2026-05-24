export interface DatasetLayer {
	name: string;
	objectName: string;
	filePath: string;
	geometryType?: string;
}

export interface Dataset {
	id: string;
	name: string;
	description: string;
	source: string;
	sourceName: string;
	adminLevel: number;
	region: string;
	license: string;
	tags: string[];
	filePath: string;
	featureCount: number;
	bbox: [number, number, number, number];
	coverage?: string;
	geometryType?: string;
	layers?: DatasetLayer[];
}

export interface LayerStyle {
	fill: string;
	fillOpacity: number;
	stroke: string;
	strokeOpacity: number;
	strokeWidth: number;
}

export interface Layer {
	id: string;
	datasetId: string;
	name: string;
	visible: boolean;
	loading: boolean;
	error: string | null;
	// data lives outside $state in layerData (layers.svelte.ts) to prevent
	// Svelte from deep_reading large GeoJSON trees on every reactive update.
	hasData: boolean;
	style: LayerStyle;
}

export interface Catalog {
	version: string;
	generated: string;
	baseUrl: string;
	datasets: Dataset[];
}
