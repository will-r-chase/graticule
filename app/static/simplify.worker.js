// Classic (non-module) worker — importScripts is only available here.
//
// mapshaper.js and mapshaper-modules.js check `typeof window === "object"` to
// decide whether to use window.modules / assign to window.mapshaper or fall
// back to Node's require(). Workers have no `window`, so we patch self.window
// before loading the scripts. self.document = {} satisfies the runningInBrowser()
// check inside mapshaper, routing gzip through its built-in fflate fallback
// instead of Node's zlib.
self.window = self;
self.document = {};

importScripts('/mapshaper-modules.js', '/mapshaper.js');

self.onmessage = async function (e) {
	const { requestId, id, topo, algorithm, tolerance, weight, keepShapes } = e.data;
	const retainPct = 100 - tolerance;
	const keepShapesParam = keepShapes ? 'keep-shapes' : '';
	const weightParam = algorithm === 'weighted' ? `weighting=${weight}` : '';
	const cmd = `-i input.topojson -simplify ${retainPct}% ${algorithm} ${weightParam} ${keepShapesParam} -o output.topojson format=topojson`
		.replace(/\s+/g, ' ').trim();
	const output = await self.mapshaper.applyCommands(cmd, { 'input.topojson': JSON.stringify(topo) });
	const simplifiedTopo = JSON.parse(output['output.topojson']);
	self.postMessage({ requestId, id, topo: simplifiedTopo });
};
