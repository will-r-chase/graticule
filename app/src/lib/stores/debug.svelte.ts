export interface LayerChunkStats {
	layerId: string;
	layerName: string;
	total: number;
	visible: number;
}

let enabled = $state(false);
let chunkStats = $state<LayerChunkStats[]>([]);
let showBboxes = $state(false);
let maxChunkVertices = $state(50_000);
let noChunking = $state(false);

export const debug = {
	get enabled() { return enabled; },
	set enabled(v: boolean) { enabled = v; },
	get chunkStats() { return chunkStats; },
	set chunkStats(v: LayerChunkStats[]) { chunkStats = v; },
	get showBboxes() { return showBboxes; },
	set showBboxes(v: boolean) { showBboxes = v; },
	get maxChunkVertices() { return maxChunkVertices; },
	set maxChunkVertices(v: number) { maxChunkVertices = v; },
	get noChunking() { return noChunking; },
	set noChunking(v: boolean) { noChunking = v; },
};
