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

// 'geometry' renders shapes via LayerStyle; 'label' renders text via LabelStyle.
// One Layer type for both — label layers reuse all layer machinery (geometryId,
// history, persistence) and simply ignore processing/style, and vice versa.
export type LayerKind = 'geometry' | 'label';

export type LabelTextTransform = 'none' | 'uppercase' | 'lowercase' | 'sentence' | 'capitalize';

// Where the text sits relative to its anchor point (9-way grid).
export type LabelAnchor =
	| 'center' | 'top' | 'bottom' | 'left' | 'right'
	| 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// Layer-level label styling. Per-feature data (text content, position, rotation,
// wrap width) lives in feature properties/geometry, not here.
export interface LabelStyle {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;        // CSS weight, 100–900
	italic: boolean;
	letterSpacing: number;     // px
	textTransform: LabelTextTransform;
	color: string;
	colorOpacity: number;
	haloColor: string;
	haloWidth: number;         // px, 0 = no halo
	anchor: LabelAnchor;
	lineHeight: number;        // multiplier
	textAlign: 'left' | 'center' | 'right';
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
	// Stable identity. All UI and derived caches (simplified/working topology) key off this.
	// geometryId is the version key for the immutable raw geometry store — a geometry op
	// mints a NEW geometryId while keeping id, so identity stays put across edits.
	geometryId: string;
	// True once the layer's geometry has been replaced (op or edit) so it no longer matches
	// its original source. Drives persistence: unedited catalog/upload layers re-fetch or
	// re-link by datasetId; edited/derived layers inline their raw geometry into the project.
	geometryEdited: boolean;
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
	kind: LayerKind;
	// Which feature property supplies the label text. null until set (label layers only).
	labelAttribute: string | null;
	labelStyle: LabelStyle;
	// Display-only provenance: the source layer's name captured when this layer was
	// derived (e.g. by createLabelLayer). No live link — informational, null otherwise.
	derivedFrom: string | null;
	geometryTypes: string[];
	// Bumped when bezier settings change so the path cache rebuilds without
	// re-running the topology pipeline. Bezier runs entirely in the cache builder.
	bezierCacheKey: number;
}

export interface UploadedDataset {
	id: string;
	name: string;
	topology: import('topojson-specification').Topology;
	internal?: boolean;
}

export interface Catalog {
	version: string;
	generated: string;
	baseUrl: string;
	datasets: Dataset[];
}
