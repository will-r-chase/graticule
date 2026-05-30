import type { Topology } from 'topojson-specification';
import type { LayerProcessing } from '../types';
import type { WorkerRequest, WorkerResponse, SerializedChunk } from './types';

let worker: Worker | null = null;
const pending = new Map<string, (response: WorkerResponse) => void>();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./geo.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
			const handler = pending.get(e.data.requestId);
			if (handler) {
				pending.delete(e.data.requestId);
				handler(e.data);
			}
		};
	}
	return worker;
}

function nextId(): string {
	return Math.random().toString(36).slice(2, 9);
}

export function workerChaikin(id: string, topo: Topology, iterations: number): Promise<Topology> {
	return new Promise((resolve) => {
		const requestId = nextId();
		pending.set(requestId, (response) => {
			if (response.type === 'CHAIKIN_DONE') resolve(response.topo);
		});
		const msg: WorkerRequest = { type: 'CHAIKIN', requestId, id, topo, iterations };
		getWorker().postMessage(msg);
	});
}

export function workerBuildPaths(
	id: string,
	topo: Topology,
	projId: string,
	width: number,
	height: number,
	processing: LayerProcessing,
	maxChunkVertices: number,
	noChunking: boolean,
): Promise<SerializedChunk[]> {
	return new Promise((resolve) => {
		const requestId = nextId();
		pending.set(requestId, (response) => {
			if (response.type === 'PATHS_DONE') resolve(response.chunks);
		});
		const msg: WorkerRequest = {
			type: 'BUILD_PATHS',
			requestId, id, topo, projId, width, height, processing, maxChunkVertices, noChunking,
		};
		getWorker().postMessage(msg);
	});
}
