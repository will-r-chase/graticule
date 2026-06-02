import * as d3 from 'd3-geo';
import * as d3gp from 'd3-geo-projection';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { WorkerRequest, WorkerResponse, PathCommand, SerializedChunk } from './types';
import { applyChaikinToTopology } from '../utils/chaikin';
import { buildAdjacencyGraph, buildChunksBFS, buildChunksHilbert } from '../utils/spatial';
import { buildBezierArcs, arcRingToPath } from '../utils/bezier';
import type { PathRecorder } from '../utils/bezier';

const allProjections = { ...d3, ...d3gp } as Record<string, unknown>;

// Persistent topology store: topology is sent once per layer (or on change)
// rather than with every BUILD_PATHS message, eliminating repeated large transfers.
const topologyStore = new Map<string, Topology>();

// Wraps a projection to clamp lon/lat before projection math runs.
// Matches the same guard in MapCanvas — prevents NaN coords from quantization artifacts.
function makeClampedProjection(proj: d3.GeoProjection): { stream: (sink: d3.GeoStream) => d3.GeoStream } {
	return {
		stream: (sink: d3.GeoStream): d3.GeoStream => {
			const s = proj.stream(sink);
			return {
				point(lon: number, lat: number) {
					s.point(Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat)));
				},
				lineStart()    { s.lineStart(); },
				lineEnd()      { s.lineEnd(); },
				polygonStart() { s.polygonStart(); },
				polygonEnd()   { s.polygonEnd(); },
				sphere()       { s.sphere?.(); },
			};
		}
	};
}

function buildProjection(projId: string, width: number, height: number, rotate: [number, number, number]): d3.GeoProjection | null {
	const resolvedId = projId === 'geoGlobe' ? 'geoOrthographic' : projId;
	const fn = allProjections[resolvedId] as (() => d3.GeoProjection) | undefined;
	if (!fn) return null;
	return fn().fitSize([width, height], { type: 'Sphere' }).rotate(rotate);
}

// A PathRecorder that accumulates path commands and tracks the bbox simultaneously.
class CommandRecorder implements PathRecorder {
	commands: PathCommand[] = [];
	xMin = Infinity; yMin = Infinity; xMax = -Infinity; yMax = -Infinity;

	private trackXY(x: number, y: number) {
		if (x < this.xMin) this.xMin = x; if (x > this.xMax) this.xMax = x;
		if (y < this.yMin) this.yMin = y; if (y > this.yMax) this.yMax = y;
	}

	moveTo(x: number, y: number) {
		this.commands.push({ op: 'M', x, y });
		this.trackXY(x, y);
	}

	lineTo(x: number, y: number) {
		this.commands.push({ op: 'L', x, y });
		this.trackXY(x, y);
	}

	bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number) {
		this.commands.push({ op: 'C', cp1x, cp1y, cp2x, cp2y, ex, ey });
		this.trackXY(ex, ey);
	}

	closePath() {
		this.commands.push({ op: 'Z' });
	}

	bbox(): [number, number, number, number] {
		return [this.xMin, this.yMin, this.xMax, this.yMax];
	}
}

// Chunk groups cache: maps layerId → pre-computed feature groups + the
// chunking settings they were built with. Adjacency and grouping depend only
// on topology structure, not on projection or rotation, so they can be built
// once and reused across all rotation-only rebuilds. The version string
// captures the settings that affect grouping; a mismatch triggers a rebuild.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chunkGroupsCache = new Map<string, { groups: any[][], version: string }>();

function handleBuildPaths(msg: Extract<WorkerRequest, { type: 'BUILD_PATHS' }>): SerializedChunk[] {
	const { id, projId, width, height, rotate, processing, maxChunkVertices, noChunking } = msg;
	const topo = topologyStore.get(id);
	if (!topo) return [];
	const proj = buildProjection(projId, width, height, rotate);
	if (!proj) return [];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const objectName = Object.keys(anyTopo.objects)[0];

	if (processing.bezierEnabled) {
		const { bezierCurveType, bezierTension, bezierAlpha, bezierContinuity, bezierBias } = processing;
		const bezierArcs = buildBezierArcs(topo as Topology, proj, bezierCurveType, bezierTension, bezierAlpha, bezierContinuity, bezierBias);
		const recorder = new CommandRecorder();
		for (const objName of Object.keys(anyTopo.objects)) {
			for (const geom of anyTopo.objects[objName].geometries) {
				if (geom.type === 'Polygon') {
					for (const ring of geom.arcs) arcRingToPath(ring, bezierArcs, recorder);
				} else if (geom.type === 'MultiPolygon') {
					for (const poly of geom.arcs) for (const ring of poly) arcRingToPath(ring, bezierArcs, recorder);
				} else if (geom.type === 'LineString') {
					arcRingToPath(geom.arcs, bezierArcs, recorder, false);
				} else if (geom.type === 'MultiLineString') {
					for (const line of geom.arcs) arcRingToPath(line, bezierArcs, recorder, false);
				}
			}
		}
		return [{ commands: recorder.commands, bbox: [-Infinity, -Infinity, Infinity, Infinity] }];
	}

	// Standard (non-bezier) path: convert to GeoJSON, chunk, project.
	const data = feature(topo as Topology, anyTopo.objects[objectName]) as {
		type?: string;
		features?: { geometry?: { type?: string } }[];
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const topoGeoms: { arcs?: unknown }[] = (anyTopo.objects[objectName] as any).geometries ?? [];
	type GeoFeature = NonNullable<typeof data.features>[number];
	const nonPointGeo: GeoFeature[] = [];
	const nonPointTopo: typeof topoGeoms = [];
	for (let i = 0; i < (data.features?.length ?? 0); i++) {
		const t = data.features![i]?.geometry?.type;
		if (t !== 'Point' && t !== 'MultiPoint') {
			nonPointGeo.push(data.features![i]);
			nonPointTopo.push(topoGeoms[i] ?? {});
		}
	}

	if (nonPointGeo.length === 0) return [];

	// Check whether we have pre-computed chunk groups for this layer.
	// Groups only depend on topology structure and chunking settings, not on
	// projection or rotation, so they can be reused across rotation rebuilds.
	const chunkVersion = `${maxChunkVertices}:${noChunking ? 1 : 0}`;
	const cached = chunkGroupsCache.get(id);
	let featureGroups: GeoFeature[][];

	if (cached && cached.version === chunkVersion) {
		featureGroups = cached.groups;
	} else {
		const isPolygonLayer = nonPointGeo.every(f => {
			const t = f?.geometry?.type;
			return t === 'Polygon' || t === 'MultiPolygon';
		});
		const adjacency = isPolygonLayer ? buildAdjacencyGraph(nonPointTopo) : [];
		const hasAdjacency = isPolygonLayer && adjacency.some(s => s.size > 0);
		featureGroups = noChunking
			? nonPointGeo.map(f => [f])
			: hasAdjacency
				? buildChunksBFS(nonPointGeo, adjacency, maxChunkVertices)
				: buildChunksHilbert(nonPointGeo, maxChunkVertices);
		chunkGroupsCache.set(id, { groups: featureGroups, version: chunkVersion });
	}

	const clampedProj = makeClampedProjection(proj) as unknown as d3.GeoProjection;
	const chunks: SerializedChunk[] = [];

	for (const chunkFeatures of featureGroups) {
		const recorder = new CommandRecorder();
		const pathCtx = {
			beginPath: () => {},
			moveTo:    (x: number, y: number) => recorder.moveTo(x, y),
			lineTo:    (x: number, y: number) => recorder.lineTo(x, y),
			closePath: () => recorder.closePath(),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			arc: (x: number, y: number, r: number, a1: number, a2: number) => {
				// Points are filtered out before chunking — this branch is unreachable
				// for polygon/line layers, but d3.geoPath requires an arc method.
				void x; void y; void r; void a1; void a2;
			},
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		d3.geoPath(clampedProj, pathCtx as any)({ ...data, features: chunkFeatures } as d3.GeoPermissibleObjects);
		chunks.push({ commands: recorder.commands, bbox: recorder.bbox() });
	}

	return chunks;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	const msg = e.data;

	if (msg.type === 'STORE_TOPOLOGY') {
		topologyStore.set(msg.id, msg.topo);
		chunkGroupsCache.delete(msg.id); // new topology → old chunk groups are invalid
		return;
	}

	if (msg.type === 'REMOVE_TOPOLOGY') {
		topologyStore.delete(msg.id);
		chunkGroupsCache.delete(msg.id);
		return;
	}

	if (msg.type === 'CHAIKIN') {
		const topo = applyChaikinToTopology(msg.topo, msg.iterations);
		const response: WorkerResponse = {
			type: 'CHAIKIN_DONE',
			requestId: msg.requestId,
			id: msg.id,
			topo,
		};
		(self as unknown as Worker).postMessage(response);
	}

	if (msg.type === 'BUILD_PATHS') {
		const chunks = handleBuildPaths(msg);
		const response: WorkerResponse = {
			type: 'PATHS_DONE',
			requestId: msg.requestId,
			id: msg.id,
			chunks,
		};
		(self as unknown as Worker).postMessage(response);
	}
};
