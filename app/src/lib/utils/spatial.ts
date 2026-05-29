// Hilbert curve 2D→1D mapping. Unlike the Z-order (Morton) curve, the Hilbert
// curve has no "zigzag" jumps at quadrant boundaries — every two adjacent indices
// in the result correspond to spatially adjacent grid cells. This gives much better
// spatial locality when sorting geographic features into render chunks.
function hilbert(x: number, y: number, order: number): number {
	let d = 0;
	for (let s = order >> 1; s > 0; s >>= 1) {
		const rx = (x & s) > 0 ? 1 : 0;
		const ry = (y & s) > 0 ? 1 : 0;
		d += s * s * ((3 * rx) ^ ry);
		if (ry === 0) {
			if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
			const tmp = x; x = y; y = tmp;
		}
	}
	return d;
}

function hilbertXY(lon: number, lat: number): number {
	const ORDER = 1024;
	const ix = Math.floor(((lon + 180) / 360) * (ORDER - 1)) & (ORDER - 1);
	const iy = Math.floor(((lat + 90) / 180) * (ORDER - 1)) & (ORDER - 1);
	return hilbert(ix, iy, ORDER);
}

// Computes a Hilbert curve sort key for a GeoJSON feature from its geometry bbox center.
export function featureHilbertKey(feature: { geometry?: unknown }): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const geom = feature.geometry as { type?: string; coordinates?: any } | null | undefined;
	if (!geom) return 0;

	const c = geom.coordinates;
	let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
	const upd = (x: number, y: number) => {
		if (x < xMin) xMin = x; if (x > xMax) xMax = x;
		if (y < yMin) yMin = y; if (y > yMax) yMax = y;
	};

	if (geom.type === 'Polygon') {
		for (const ring of c) for (const [x, y] of ring) upd(x, y);
	} else if (geom.type === 'MultiPolygon') {
		for (const poly of c) for (const ring of poly) for (const [x, y] of ring) upd(x, y);
	} else if (geom.type === 'LineString') {
		for (const [x, y] of c) upd(x, y);
	} else if (geom.type === 'MultiLineString') {
		for (const line of c) for (const [x, y] of line) upd(x, y);
	}

	if (!isFinite(xMin)) return 0;
	return hilbertXY((xMin + xMax) / 2, (yMin + yMax) / 2);
}

// Counts total coordinate positions in a GeoJSON geometry.
// Used to balance chunk sizes by rendering cost rather than feature count.
export function countGeometryVertices(geom: unknown): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const g = geom as { type?: string; coordinates?: any } | null | undefined;
	if (!g) return 0;
	const c = g.coordinates;
	switch (g.type) {
		case 'Polygon':
			return c.reduce((s: number, r: unknown[]) => s + r.length, 0);
		case 'MultiPolygon':
			return c.reduce((s: number, p: unknown[][]) =>
				s + p.reduce((s2: number, r: unknown[]) => s2 + r.length, 0), 0);
		case 'LineString':
			return c.length;
		case 'MultiLineString':
			return c.reduce((s: number, l: unknown[]) => s + l.length, 0);
		default:
			return 0;
	}
}

// ---------------------------------------------------------------------------
// Chunk building
// ---------------------------------------------------------------------------

// Collects all arc indices from a TopoJSON geometry's arcs property.
// Arc refs can be negative: ~ref gives the forward arc index (bitwise NOT).
function extractArcIndices(arcs: unknown): number[] {
	const result: number[] = [];
	function traverse(a: unknown) {
		if (typeof a === 'number') {
			result.push(a < 0 ? ~a : a);
		} else if (Array.isArray(a)) {
			for (const item of a) traverse(item);
		}
	}
	traverse(arcs);
	return result;
}

// Builds an adjacency list from TopoJSON geometries by finding which pairs of
// geometries share an arc. Two geometries sharing an arc share a border.
// Input: TopoJSON geometry objects (not GeoJSON features — these have .arcs, not .coordinates).
// Returns: adjacency[i] = Set of geometry indices adjacent to i.
export function buildAdjacencyGraph(geoms: { arcs?: unknown }[]): Set<number>[] {
	const adjacency: Set<number>[] = geoms.map(() => new Set<number>());
	const arcToGeoms = new Map<number, number[]>();

	for (let i = 0; i < geoms.length; i++) {
		for (const arcIdx of extractArcIndices(geoms[i].arcs)) {
			if (!arcToGeoms.has(arcIdx)) arcToGeoms.set(arcIdx, []);
			arcToGeoms.get(arcIdx)!.push(i);
		}
	}

	for (const [, geomIdxs] of arcToGeoms) {
		if (geomIdxs.length < 2) continue;
		for (let i = 0; i < geomIdxs.length; i++) {
			for (let j = i + 1; j < geomIdxs.length; j++) {
				adjacency[geomIdxs[i]].add(geomIdxs[j]);
				adjacency[geomIdxs[j]].add(geomIdxs[i]);
			}
		}
	}

	return adjacency;
}

// Builds render chunks using BFS over the adjacency graph.
// Each chunk starts from a seed (chosen in Hilbert order for consistency) and
// expands to adjacent features until the vertex budget is reached. Features
// with no shared borders (island nations, archipelagos) become their own seeds.
// This produces geographically compact chunks, which means tighter bboxes and
// more effective viewport culling compared to 1D curve sorts.
export function buildChunksBFS<F extends { geometry?: unknown }>(
	features: F[],
	adjacency: Set<number>[],
	maxVertices: number
): F[][] {
	const unassigned = new Set<number>(features.map((_, i) => i));
	const chunks: F[][] = [];

	// Hilbert order determines which unassigned feature becomes the next seed,
	// giving stable, geographically consistent chunk boundaries across datasets.
	const hilbertOrder = [...features.keys()].sort(
		(a, b) => featureHilbertKey(features[a]) - featureHilbertKey(features[b])
	);

	while (unassigned.size > 0) {
		const seedIdx = hilbertOrder.find(i => unassigned.has(i))!;

		const chunkIndices: number[] = [];
		let vertexCount = 0;
		const visited = new Set<number>([seedIdx]);
		const queue: number[] = [seedIdx];
		let qi = 0;

		while (qi < queue.length) {
			const fi = queue[qi++];
			if (!unassigned.has(fi)) continue;

			const v = countGeometryVertices(features[fi].geometry);
			// Always admit at least one feature (the seed) even if it alone exceeds the budget.
			if (chunkIndices.length > 0 && vertexCount + v > maxVertices) continue;

			chunkIndices.push(fi);
			vertexCount += v;
			unassigned.delete(fi);

			for (const neighbor of adjacency[fi]) {
				if (unassigned.has(neighbor) && !visited.has(neighbor)) {
					visited.add(neighbor);
					queue.push(neighbor);
				}
			}
		}

		if (chunkIndices.length > 0) {
			chunks.push(chunkIndices.map(i => features[i]));
		}
	}

	return chunks;
}

// Fallback chunker for datasets without topology (e.g. uploaded GeoJSON where
// arcs are not shared). Sorts by Hilbert key and groups by vertex budget.
export function buildChunksHilbert<F extends { geometry?: unknown }>(
	features: F[],
	maxVertices: number
): F[][] {
	const sorted = [...features].sort(
		(a, b) => featureHilbertKey(a) - featureHilbertKey(b)
	);

	const chunks: F[][] = [];
	let fi = 0;

	while (fi < sorted.length) {
		let vertexCount = 0;
		const chunk: F[] = [];

		while (fi < sorted.length) {
			const v = countGeometryVertices(sorted[fi].geometry);
			if (chunk.length > 0 && vertexCount + v > maxVertices) break;
			chunk.push(sorted[fi]);
			vertexCount += v;
			fi++;
		}

		chunks.push(chunk);
	}

	return chunks;
}
