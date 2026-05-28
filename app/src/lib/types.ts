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

export type BezierCurveType = 'catmull-rom' | 'kb' | 'bspline';

export type SimplificationAlgorithm = 'weighted' | 'dp' | 'visvalingam';

export interface LayerProcessing {
	// Simplification
	simpEnabled: boolean;
	simpAlgorithm: SimplificationAlgorithm;
	simpTolerance: number;       // 0–100
	simpWeight: number;          // 0–1, weighted algorithm only
	simpKeepShapes: boolean;

	// Chaikin smoothing
	chaikinEnabled: boolean;
	chaikinIterations: number;   // 1–4

	// Bezier fitting
	bezierEnabled: boolean;
	bezierCurveType: BezierCurveType;
	bezierTension: number;       // 0–1
	bezierAlpha: number;         // 0–1, Catmull-Rom only
	bezierContinuity: number;    // -1–1, KB only
	bezierBias: number;          // -1–1, KB only
}

export interface LayerStyle {
	fill: string;
	fillOpacity: number;
	stroke: string;
	strokeOpacity: number;
	strokeWidth: number;
	strokeDashed: boolean;
	strokeDash: number;
	strokeGap: number;
	pointRadius: number;
	pointShape: string;
}

export interface Layer {
	id: string;
	datasetId: string;
	name: string;
	visible: boolean;
	loading: boolean;
	error: string | null;
	// topology lives outside $state in rawTopologyData / workingTopologyData.
	// hasTopology is the signal that workingTopologyData is ready to render.
	hasTopology: boolean;
	style: LayerStyle;
	processing: LayerProcessing;
	geometryTypes: string[];
}

export interface UploadedDataset {
	id: string;
	name: string;
	topology: import('topojson-specification').Topology;
}

export interface Catalog {
	version: string;
	generated: string;
	baseUrl: string;
	datasets: Dataset[];
}
