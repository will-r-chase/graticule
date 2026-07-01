import type { Topology } from 'topojson-specification';
import type { BezierCurveType } from '$lib/types';
import { topologyToAbsolute } from './topology';

/**
 * Applies bezier smoothing to every arc of a TopoJSON topology in geographic
 * space, sampling each curve segment into a dense polyline. Works in
 * topology-space so shared borders are smoothed exactly once — adjacent
 * polygons always have matching edges with no gaps (same contract as
 * applyChaikinToTopology).
 *
 * Because the output is plain vertices, the smoothed topology renders through
 * the standard d3.geoPath pipeline, which handles antimeridian, hemisphere,
 * and viewport clipping correctly — none of the screen-space reconstruction
 * in bezier.ts is needed.
 *
 * First and last points of each arc are preserved so junction nodes (where
 * multiple borders meet) stay pinned in place. (For Catmull-Rom and KB the
 * spline interpolates every vertex; for B-spline the reflected ghost endpoints
 * make the curve start and end exactly on the arc endpoints.)
 *
 * Returns a new topology with the transform dropped — coordinates become
 * absolute geographic values, which topojson-client reads correctly via its
 * identity transform.
 *
 * toleranceDeg is the maximum deviation (in degrees) between the sampled
 * polyline and the true bezier curve. Sampling density adapts per segment:
 * near-straight segments collapse to a single point, sharp curves get dense
 * sampling. 0.01° ≈ 0.03px on a fit-to-canvas world map, so curves stay
 * smooth well past 8× zoom.
 */
export function applyBezierToTopology(
	topo: Topology,
	curveType: BezierCurveType,
	tension: number,
	alpha: number,
	continuity: number,
	bias: number,
	toleranceDeg = 0.01
): Topology {
	const absolute = topologyToAbsolute(topo);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyAbsolute = absolute as any;

	const newArcs = (anyAbsolute.arcs as number[][][]).map((arc: number[][]) =>
		smoothArc(arc, curveType, tension, alpha, continuity, bias, toleranceDeg)
	);

	anyAbsolute.arcs = newArcs;
	return absolute;
}

// Upper bound on samples per cubic, so a pathological segment can't explode
// the vertex count.
const MAX_SAMPLES_PER_SEGMENT = 32;

// Returns the number of line segments needed to flatten one cubic to within
// `tol` of the true curve. Uses the control-net deviation bound: the curve
// lies within 3/4 of the max distance from each control point to its uniform
// position on the chord, and that deviation shrinks quadratically as the
// curve is subdivided — so n = sqrt(dev / tol) segments suffice.
function segmentsForCubic(
	x0: number, y0: number, cp1x: number, cp1y: number,
	cp2x: number, cp2y: number, x3: number, y3: number,
	tol: number
): number {
	const d1 = Math.hypot(cp1x - (x0 + (x3 - x0) / 3), cp1y - (y0 + (y3 - y0) / 3));
	const d2 = Math.hypot(cp2x - (x0 + 2 * (x3 - x0) / 3), cp2y - (y0 + 2 * (y3 - y0) / 3));
	const dev = Math.max(d1, d2);
	if (dev <= tol) return 1;
	return Math.min(MAX_SAMPLES_PER_SEGMENT, Math.ceil(Math.sqrt(dev / tol)));
}

// Smooths one arc: computes cubic bezier control points per vertex pair (same
// math as the screen-space version in bezier.ts, minus projection and clipping
// concerns — geographic arcs are continuous, so no jump guards are needed),
// then flattens each cubic adaptively to within `tol` degrees of the true curve.
function smoothArc(
	arc: number[][],
	curveType: BezierCurveType,
	tension: number,
	alpha: number,
	continuity: number,
	bias: number,
	tol: number
): number[][] {
	const n = arc.length;
	if (n < 3) return arc.map((pt) => [...pt]);

	const out: number[][] = [[arc[0][0], arc[0][1]]];
	// Running current point — the start of the next cubic. For Catmull-Rom/KB
	// this always equals arc[i]; for B-spline the segment endpoint is a blend,
	// so the curve start drifts off the control polygon (intentionally).
	let cur: [number, number] = [arc[0][0], arc[0][1]];

	for (let i = 0; i < n - 1; i++) {
		// Reflected ghost endpoints keep the curve pinned at the arc ends.
		const prev: [number, number] = i === 0
			? [2 * arc[0][0] - arc[1][0], 2 * arc[0][1] - arc[1][1]]
			: (arc[i - 1] as [number, number]);
		const p1 = arc[i] as [number, number];
		const p2 = arc[i + 1] as [number, number];
		const next: [number, number] = i === n - 2
			? [2 * arc[n - 1][0] - arc[n - 2][0], 2 * arc[n - 1][1] - arc[n - 2][1]]
			: (arc[i + 2] as [number, number]);

		let cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number;

		if (curveType === 'bspline') {
			const bsplEx = (p1[0] + 4 * p2[0] + next[0]) / 6;
			const bsplEy = (p1[1] + 4 * p2[1] + next[1]) / 6;
			cp1x = p1[0] + (p2[0] - p1[0]) * tension / 3;
			cp1y = p1[1] + (p2[1] - p1[1]) * tension / 3;
			cp2x = p2[0] - (p2[0] - p1[0]) * tension / 3;
			cp2y = p2[1] - (p2[1] - p1[1]) * tension / 3;
			ex = p2[0] + (bsplEx - p2[0]) * tension;
			ey = p2[1] + (bsplEy - p2[1]) * tension;

		} else if (curveType === 'kb') {
			const T = 1 - tension;
			const outX = (1-T)*(1+continuity)*(1+bias)/2 * (p1[0]-prev[0]) + (1-T)*(1-continuity)*(1-bias)/2 * (p2[0]-p1[0]);
			const outY = (1-T)*(1+continuity)*(1+bias)/2 * (p1[1]-prev[1]) + (1-T)*(1-continuity)*(1-bias)/2 * (p2[1]-p1[1]);
			const inX  = (1-T)*(1+continuity)*(1-bias)/2 * (p2[0]-p1[0]) + (1-T)*(1-continuity)*(1+bias)/2 * (next[0]-p2[0]);
			const inY  = (1-T)*(1+continuity)*(1-bias)/2 * (p2[1]-p1[1]) + (1-T)*(1-continuity)*(1+bias)/2 * (next[1]-p2[1]);
			cp1x = p1[0] + outX / 3;
			cp1y = p1[1] + outY / 3;
			cp2x = p2[0] - inX / 3;
			cp2y = p2[1] - inY / 3;
			ex = p2[0];
			ey = p2[1];

		} else {
			// Catmull-Rom with alpha parameterization.
			let m1x: number, m1y: number, m2x: number, m2y: number;
			if (alpha === 0) {
				m1x = (p2[0] - prev[0]) / 2;
				m1y = (p2[1] - prev[1]) / 2;
				m2x = (next[0] - p1[0]) / 2;
				m2y = (next[1] - p1[1]) / 2;
			} else {
				const dist = (a: [number, number], b: [number, number]) =>
					Math.pow((a[0]-b[0])**2 + (a[1]-b[1])**2, alpha / 2) || 1e-6;
				const dt01 = dist(prev, p1);
				const dt12 = dist(p1, p2);
				const dt23 = dist(p2, next);
				m1x = dt12 * ((p1[0]-prev[0])/dt01 - (p2[0]-prev[0])/(dt01+dt12) + (p2[0]-p1[0])/dt12);
				m1y = dt12 * ((p1[1]-prev[1])/dt01 - (p2[1]-prev[1])/(dt01+dt12) + (p2[1]-p1[1])/dt12);
				m2x = dt12 * ((p2[0]-p1[0])/dt12 - (next[0]-p1[0])/(dt12+dt23) + (next[0]-p2[0])/dt23);
				m2y = dt12 * ((p2[1]-p1[1])/dt12 - (next[1]-p1[1])/(dt12+dt23) + (next[1]-p2[1])/dt23);
			}
			cp1x = p1[0] + m1x * tension / 3;
			cp1y = p1[1] + m1y * tension / 3;
			cp2x = p2[0] - m2x * tension / 3;
			cp2y = p2[1] - m2y * tension / 3;
			ex = p2[0];
			ey = p2[1];
		}

		// Flatten the cubic from cur to (ex, ey) — cubic Bernstein evaluation at
		// t = 1/samples … 1. t=0 is skipped (it duplicates the previous point).
		const samples = segmentsForCubic(cur[0], cur[1], cp1x, cp1y, cp2x, cp2y, ex, ey, tol);
		for (let s = 1; s <= samples; s++) {
			const t = s / samples;
			const u = 1 - t;
			const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
			out.push([
				b0 * cur[0] + b1 * cp1x + b2 * cp2x + b3 * ex,
				b0 * cur[1] + b1 * cp1y + b2 * cp2y + b3 * ey,
			]);
		}
		cur = [ex, ey];
	}

	return out;
}
