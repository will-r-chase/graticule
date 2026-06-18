import type { Topology } from 'topojson-specification';

/**
 * Returns a copy of the topology with every arc decoded to absolute geographic
 * coordinates and the `transform` dropped. topojson-client reads a transform-less
 * topology via its identity transform, so the result renders identically.
 *
 * Handles both cases correctly:
 *   - Quantized topology (transform present): arcs are delta-encoded integers;
 *     accumulate the deltas, then apply scale + translate.
 *   - Unquantized topology (no transform): arcs already hold absolute points,
 *     so copy them through unchanged — accumulating here would corrupt them.
 *
 * This is the shared decode used by the Chaikin stage and by vertex editing,
 * which both need geometry in plain absolute form.
 */
export function topologyToAbsolute(topo: Topology): Topology {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const transform = anyTopo.transform as
		| { scale: [number, number]; translate: [number, number] }
		| undefined;

	let newArcs: number[][][];
	if (transform) {
		const [sx, sy] = transform.scale;
		const [tx, ty] = transform.translate;
		newArcs = (anyTopo.arcs as number[][][]).map((arc: number[][]) => {
			const pts: number[][] = [];
			let qx = 0, qy = 0;
			for (const [dqx, dqy] of arc) {
				qx += dqx;
				qy += dqy;
				pts.push([qx * sx + tx, qy * sy + ty]);
			}
			return pts;
		});
	} else {
		// Already absolute — copy each point so callers can mutate the draft freely
		// without touching the source arcs.
		newArcs = (anyTopo.arcs as number[][][]).map((arc: number[][]) =>
			arc.map((pt) => [...pt])
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const result: any = { ...topo, arcs: newArcs };
	delete result.transform;
	return result as Topology;
}

// A reference to one endpoint (start or end) of an arc. The shared endpoints of
// multiple arcs are the topology's "nodes" — moving one must move all of them
// together to keep borders connected.
export interface NodeRef {
	arcIndex: number;
	end: 'start' | 'end';
}

// Coordinate key for matching arc endpoints. Shared endpoints are produced by the
// same decode arithmetic, so identical floats stringify identically — an exact match
// with no tolerance needed.
function coordKey(pt: number[]): string {
	return `${pt[0]},${pt[1]}`;
}

export { coordKey };

/**
 * Builds a map from coordinate key → every arc endpoint sitting at that coordinate.
 * Any key with more than one entry is a shared node: dragging it must update all of
 * those arc endpoints. Interior arc vertices are never nodes, so they aren't indexed.
 *
 * Expects an absolute-coordinate topology (run topologyToAbsolute first).
 */
export function buildNodeMap(topo: Topology): Map<string, NodeRef[]> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const arcs = (topo as any).arcs as number[][][];
	const map = new Map<string, NodeRef[]>();

	const add = (pt: number[], ref: NodeRef) => {
		const key = coordKey(pt);
		const existing = map.get(key);
		if (existing) existing.push(ref);
		else map.set(key, [ref]);
	};

	arcs.forEach((arc, arcIndex) => {
		if (arc.length === 0) return;
		add(arc[0], { arcIndex, end: 'start' });
		add(arc[arc.length - 1], { arcIndex, end: 'end' });
	});

	return map;
}

/**
 * Returns the unique (non-negative) arc indices referenced by one feature geometry.
 * TopoJSON encodes a reversed arc as the one's-complement (~i) of its index; both
 * directions point at the same underlying arc, so we normalise to the positive index.
 * Point/MultiPoint geometries have no arcs and yield an empty list.
 */
export function featureArcIndices(topo: Topology, featureIndex: number): number[] {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const objName = Object.keys(anyTopo.objects)[0];
	const geom = anyTopo.objects[objName].geometries[featureIndex];
	if (!geom) return [];

	const set = new Set<number>();
	const addRing = (ring: number[]) => {
		for (const a of ring) set.add(a < 0 ? ~a : a);
	};

	switch (geom.type) {
		case 'LineString':
			addRing(geom.arcs as number[]);
			break;
		case 'MultiLineString':
		case 'Polygon':
			for (const ring of geom.arcs as number[][]) addRing(ring);
			break;
		case 'MultiPolygon':
			for (const poly of geom.arcs as number[][][]) for (const ring of poly) addRing(ring);
			break;
		// Point / MultiPoint store coordinates directly — no arcs.
	}

	return [...set];
}

/**
 * Inverse of featureArcIndices for the whole topology: arc index → the feature indices
 * that reference it. Used during editing to find which features a dragged (possibly
 * shared) arc belongs to, so only those features need re-rendering from the draft.
 */
export function buildArcToFeatures(topo: Topology): Map<number, number[]> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const objName = Object.keys(anyTopo.objects)[0];
	const geometries = anyTopo.objects[objName].geometries as unknown[];
	const map = new Map<number, number[]>();
	for (let fi = 0; fi < geometries.length; fi++) {
		for (const ai of featureArcIndices(topo, fi)) {
			const arr = map.get(ai);
			if (arr) arr.push(fi);
			else map.set(ai, [fi]);
		}
	}
	return map;
}
