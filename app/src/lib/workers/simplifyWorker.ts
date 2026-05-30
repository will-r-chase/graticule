import type { Topology } from 'topojson-specification';

let worker: Worker | null = null;
const pending = new Map<string, (topo: Topology) => void>();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker('/simplify.worker.js');
		worker.onmessage = (e: MessageEvent<{ requestId: string; id: string; topo: Topology }>) => {
			const handler = pending.get(e.data.requestId);
			if (handler) {
				pending.delete(e.data.requestId);
				handler(e.data.topo);
			}
		};
	}
	return worker;
}

function nextId(): string {
	return Math.random().toString(36).slice(2, 9);
}

export function workerSimplify(
	id: string,
	topo: Topology,
	algorithm: string,
	tolerance: number,
	weight: number,
	keepShapes: boolean,
): Promise<Topology> {
	return new Promise((resolve) => {
		const requestId = nextId();
		pending.set(requestId, resolve);
		getWorker().postMessage({ requestId, id, topo, algorithm, tolerance, weight, keepShapes });
	});
}
