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

// Send a topology to the worker once (or when it changes). Fire-and-forget —
// no response needed. The worker stores it and BUILD_PATHS reads from there.
export function workerStoreTopology(id: string, topo: Topology): void {
	const msg: WorkerRequest = { type: 'STORE_TOPOLOGY', id, topo };
	getWorker().postMessage(msg);
}

// Tell the worker to discard a layer's stored topology and chunk cache.
export function workerRemoveTopology(id: string): void {
	const msg: WorkerRequest = { type: 'REMOVE_TOPOLOGY', id };
	getWorker().postMessage(msg);
}

export function workerBuildPaths(
	id: string,
	projId: string,
	width: number,
	height: number,
	rotate: [number, number, number],
	processing: LayerProcessing,
): Promise<SerializedChunk[]> {
	return new Promise((resolve) => {
		const requestId = nextId();
		pending.set(requestId, (response) => {
			if (response.type === 'PATHS_DONE') resolve(response.chunks);
		});
		const msg: WorkerRequest = {
			type: 'BUILD_PATHS',
			requestId, id, projId, width, height, rotate, processing,
		};
		getWorker().postMessage(msg);
	});
}
