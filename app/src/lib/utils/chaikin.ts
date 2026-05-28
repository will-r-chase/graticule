import type { Topology } from 'topojson-specification';

/**
 * Counts the total number of coordinate points across all arcs in a topology.
 * Used to estimate point count before applying Chaikin (which doubles per iteration).
 */
export function countTopoPoints(topo: Topology): number {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return ((topo as any).arcs as number[][][])
		.reduce((sum: number, arc: number[][]) => sum + arc.length, 0);
}

/**
 * Applies Chaikin's corner-cutting algorithm to every arc in a TopoJSON topology.
 * Works in topology-space so shared borders are smoothed exactly once — adjacent
 * polygons always have matching edges with no gaps.
 *
 * Uses the open-line variant: first and last points of each arc are preserved so
 * junction nodes (where multiple borders meet) stay pinned in place.
 *
 * Returns a new topology with the transform dropped — coordinates become absolute
 * geographic values, which topojson-client reads correctly via its identity transform.
 */
export function applyChaikinToTopology(topo: Topology, iterations: number): Topology {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const transform = anyTopo.transform as
		| { scale: [number, number]; translate: [number, number] }
		| undefined;
	const [sx, sy] = transform ? transform.scale : [1, 1];
	const [tx, ty] = transform ? transform.translate : [0, 0];

	const newArcs = (anyTopo.arcs as number[][][]).map((arc: number[][]) => {
		// Decode delta-encoded quantized coords -> absolute geographic coords.
		// If there's a transform, apply scale + translate after accumulation.
		const pts: number[][] = [];
		let qx = 0, qy = 0;
		for (const [dqx, dqy] of arc) {
			qx += dqx;
			qy += dqy;
			pts.push([qx * sx + tx, qy * sy + ty]);
		}

		// Open-line Chaikin — preserves first and last point so arc junction
		// nodes (where multiple borders meet) stay pinned in place.
		let line = pts;
		for (let iter = 0; iter < iterations; iter++) {
			const out = [line[0]];
			for (let i = 0; i < line.length - 1; i++) {
				const [x0, y0] = line[i];
				const [x1, y1] = line[i + 1];
				out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
				out.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
			}
			out.push(line[line.length - 1]);
			line = out;
		}

		// No re-encoding needed. When a topology has no transform,
		// topojson-client uses identity() — it reads coords as absolute
		// values with no delta decoding. So we just return the decoded
		// geographic coordinates directly.
		return line;
	});

	// Drop the transform — coordinates are geographic from here on.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const result: any = { ...topo, arcs: newArcs };
	delete result.transform;
	return result as Topology;
}
