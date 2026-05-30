import type { Topology } from 'topojson-specification';
import type { LayerProcessing } from '../types';

export type PathCommand =
	| { op: 'M'; x: number; y: number }
	| { op: 'L'; x: number; y: number }
	| { op: 'Z' }
	| { op: 'C'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; ex: number; ey: number };

export type SerializedChunk = {
	commands: PathCommand[];
	bbox: [number, number, number, number];
};

export type WorkerRequest =
	| { type: 'CHAIKIN'; requestId: string; id: string; topo: Topology; iterations: number }
	| { type: 'BUILD_PATHS'; requestId: string; id: string; topo: Topology; projId: string; width: number; height: number; processing: LayerProcessing; maxChunkVertices: number; noChunking: boolean };

export type WorkerResponse =
	| { type: 'CHAIKIN_DONE'; requestId: string; id: string; topo: Topology }
	| { type: 'PATHS_DONE'; requestId: string; id: string; chunks: SerializedChunk[] };
