import * as d3 from 'd3-geo';
import type { Topology } from 'topojson-specification';
import type { BezierCurveType } from '$lib/types';

export type BezierSegment = {
	cp1x: number;
	cp1y: number;
	cp2x: number;
	cp2y: number;
	ex: number;
	ey: number;
	isBreak?: boolean;
};

export type BezierArc = { sx: number; sy: number; segs: BezierSegment[] };

// Re-exported for convenience — defined in types.ts.
export type { BezierCurveType };

/**
 * Projects every arc in a TopoJSON topology to screen space and computes
 * cubic Bezier control points. Topology arcs are processed independently
 * with reflected ghost endpoints, so shared borders produce identical C
 * commands on both sides — no gaps between adjacent polygons.
 */
export function buildBezierArcs(
	topo: Topology,
	proj: d3.GeoProjection,
	curveType: BezierCurveType,
	tension: number,
	alpha: number,
	continuity: number,
	bias: number
): BezierArc[] {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const transform = anyTopo.transform as
		| { scale: [number, number]; translate: [number, number] }
		| undefined;
	const [scx, scy] = transform ? transform.scale : [1, 1];
	const [otx, oty] = transform ? transform.translate : [0, 0];
	const hasTransform = !!transform;
	// Approximate canvas width from the projection's translate (fitSize sets it to [w/2, h/2]).
	// Used to detect lon=180 wrap artefacts where proj([180,lat]) maps to the left edge.
	const projWidth = proj.translate()[0] * 2;

	return (anyTopo.arcs as number[][][]).map((arc: number[][]) => {
		const geo: [number, number][] = [];
		if (hasTransform) {
			let qx = 0, qy = 0;
			for (const [dqx, dqy] of arc) {
				qx += dqx; qy += dqy;
				geo.push([qx * scx + otx, qy * scy + oty]);
			}
		} else {
			for (const [gx, gy] of arc) geo.push([gx, gy]);
		}

		// Project while keeping geographic coords in sync — needed to detect
		// antimeridian crossings (|lon_a - lon_b| > 180) later in the loop.
		const paired = geo
			.map(g => ({ g, p: proj(g) as [number, number] | null }))
			.filter((x): x is { g: [number, number]; p: [number, number] } => x.p !== null);

		const pts: [number, number][] = paired.map(x => x.p);
		const geoCoords: [number, number][] = paired.map(x => x.g);

		if (pts.length < 2) {
			return { sx: pts[0]?.[0] ?? 0, sy: pts[0]?.[1] ?? 0, segs: [] };
		}

		const n = pts.length;
		const segs: BezierSegment[] = [];

		for (let i = 0; i < n - 1; i++) {
			const prev: [number, number] = i === 0
				? [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]]
				: pts[i - 1];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const next: [number, number] = i === n - 2
				? [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]]
				: pts[i + 2];

			// Guard against antimeridian jumps: if a neighbour is more than 10x the
			// current segment length away in screen space, it almost certainly crossed
			// +-180 deg and the projected coords are on opposite sides of the canvas.
			// Fall back to the reflected ghost so the tangent doesn't blow out.
			const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
			const JUMP = 10;
			const distPrev = Math.hypot(p1[0] - prev[0], p1[1] - prev[1]);
			const safePrev: [number, number] = distPrev > JUMP * segLen || distPrev > projWidth * 0.3
				? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]]
				: prev;
			const distNext = Math.hypot(next[0] - p2[0], next[1] - p2[1]);
			const safeNext: [number, number] = distNext > JUMP * segLen || distNext > projWidth * 0.3
				? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]]
				: next;

			// If p1 and p2 themselves cross +-180 deg longitude, their projected
			// coords span the full canvas width. Push a break marker so the path
			// emits M (moveto) here instead of drawing a curve across the globe.
			const screenSegDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
			if (Math.abs(geoCoords[i][0] - geoCoords[i + 1][0]) > 180 || screenSegDist > projWidth * 0.3) {
				segs.push({ cp1x: p2[0], cp1y: p2[1], cp2x: p2[0], cp2y: p2[1], ex: p2[0], ey: p2[1], isBreak: true });
				continue;
			}

			if (curveType === 'bspline') {
				// B-spline: approximating spline — the curve passes between vertices
				// rather than through them, giving a more abstracted, rounded look.
				// CPs lie on the P1–P2 line; the end point is blended toward the
				// B-spline position. Arc endpoints stay pinned (due to ghost reflection).
				const bsplEx = (p1[0] + 4 * p2[0] + safeNext[0]) / 6;
				const bsplEy = (p1[1] + 4 * p2[1] + safeNext[1]) / 6;
				segs.push({
					cp1x: p1[0] + (p2[0] - p1[0]) * tension / 3,
					cp1y: p1[1] + (p2[1] - p1[1]) * tension / 3,
					cp2x: p2[0] - (p2[0] - p1[0]) * tension / 3,
					cp2y: p2[1] - (p2[1] - p1[1]) * tension / 3,
					ex: p2[0] + (bsplEx - p2[0]) * tension,
					ey: p2[1] + (bsplEy - p2[1]) * tension,
				});

			} else if (curveType === 'kb') {
				// Kochanek-Bartels: superset of Catmull-Rom with continuity + bias.
				// Our tension (0=straight, 1=full) maps to KB's T parameter (1->0).
				const T = 1 - tension;
				const outX = (1-T)*(1+continuity)*(1+bias)/2 * (p1[0]-safePrev[0]) + (1-T)*(1-continuity)*(1-bias)/2 * (p2[0]-p1[0]);
				const outY = (1-T)*(1+continuity)*(1+bias)/2 * (p1[1]-safePrev[1]) + (1-T)*(1-continuity)*(1-bias)/2 * (p2[1]-p1[1]);
				const inX  = (1-T)*(1+continuity)*(1-bias)/2 * (p2[0]-p1[0]) + (1-T)*(1-continuity)*(1+bias)/2 * (safeNext[0]-p2[0]);
				const inY  = (1-T)*(1+continuity)*(1-bias)/2 * (p2[1]-p1[1]) + (1-T)*(1-continuity)*(1+bias)/2 * (safeNext[1]-p2[1]);
				segs.push({
					cp1x: p1[0] + outX / 3,
					cp1y: p1[1] + outY / 3,
					cp2x: p2[0] - inX / 3,
					cp2y: p2[1] - inY / 3,
					ex: p2[0],
					ey: p2[1],
				});

			} else {
				// Catmull-Rom with alpha parameterization.
				// alpha=0: uniform (equal time spacing).
				// alpha=0.5: centripetal — avoids loops on uneven point spacing.
				// alpha=1: chordal — proportional to chord length, can loop.
				let m1x: number, m1y: number, m2x: number, m2y: number;
				if (alpha === 0) {
					m1x = (p2[0] - safePrev[0]) / 2;
					m1y = (p2[1] - safePrev[1]) / 2;
					m2x = (safeNext[0] - p1[0]) / 2;
					m2y = (safeNext[1] - p1[1]) / 2;
				} else {
					const dist = (a: [number, number], b: [number, number]) =>
						Math.pow((a[0]-b[0])**2 + (a[1]-b[1])**2, alpha / 2) || 1e-6;
					const dt01 = dist(safePrev, p1);
					const dt12 = dist(p1, p2);
					const dt23 = dist(p2, safeNext);
					m1x = dt12 * ((p1[0]-safePrev[0])/dt01 - (p2[0]-safePrev[0])/(dt01+dt12) + (p2[0]-p1[0])/dt12);
					m1y = dt12 * ((p1[1]-safePrev[1])/dt01 - (p2[1]-safePrev[1])/(dt01+dt12) + (p2[1]-p1[1])/dt12);
					m2x = dt12 * ((p2[0]-p1[0])/dt12 - (safeNext[0]-p1[0])/(dt12+dt23) + (safeNext[0]-p2[0])/dt23);
					m2y = dt12 * ((p2[1]-p1[1])/dt12 - (safeNext[1]-p1[1])/(dt12+dt23) + (safeNext[1]-p2[1])/dt23);
				}
				segs.push({
					cp1x: p1[0] + m1x * tension / 3,
					cp1y: p1[1] + m1y * tension / 3,
					cp2x: p2[0] - m2x * tension / 3,
					cp2y: p2[1] - m2y * tension / 3,
					ex: p2[0],
					ey: p2[1],
				});
			}
		}

		return { sx: pts[0][0], sy: pts[0][1], segs };
	});
}

export interface PathRecorder {
	moveTo(x: number, y: number): void;
	bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number): void;
	closePath(): void;
}

/**
 * Writes one ring of arc indices into a PathRecorder, honouring forward/reversed
 * arcs via the ~idx convention. Break segments emit moveTo rather than
 * bezierCurveTo to avoid drawing across the antimeridian.
 * Pass close=false for LineString arcs that should not be closed.
 * Path2D satisfies PathRecorder, so existing callers are unaffected.
 */
export function arcRingToPath(arcIndices: number[], bezierArcs: BezierArc[], recorder: PathRecorder, close = true): void {
	let started = false;

	for (const idx of arcIndices) {
		const reversed = idx < 0;
		const arc = bezierArcs[reversed ? ~idx : idx];
		if (!arc || arc.segs.length === 0) continue;

		if (reversed) {
			// Reversed arc: start from the last point, traverse segments backwards.
			// Reversing a cubic bezier just swaps cp1 and cp2.
			const last = arc.segs[arc.segs.length - 1];
			if (!started) { recorder.moveTo(last.ex, last.ey); started = true; }
			for (let i = arc.segs.length - 1; i >= 0; i--) {
				const seg = arc.segs[i];
				const toX = i === 0 ? arc.sx : arc.segs[i - 1].ex;
				const toY = i === 0 ? arc.sy : arc.segs[i - 1].ey;
				if (seg.isBreak) {
					recorder.moveTo(toX, toY);
				} else {
					recorder.bezierCurveTo(seg.cp2x, seg.cp2y, seg.cp1x, seg.cp1y, toX, toY);
				}
			}
		} else {
			if (!started) { recorder.moveTo(arc.sx, arc.sy); started = true; }
			for (const seg of arc.segs) {
				if (seg.isBreak) {
					recorder.moveTo(seg.ex, seg.ey);
				} else {
					recorder.bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, seg.ex, seg.ey);
				}
			}
		}
	}

	if (started && close) recorder.closePath();
}

/**
 * Builds a single Path2D from a TopoJSON topology and pre-computed bezier arcs.
 * Iterates all polygon and multipolygon geometries across every named object.
 */
export function buildTopoPath(topo: Topology, bezierArcs: BezierArc[]): Path2D {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyTopo = topo as any;
	const path2d = new Path2D();

	for (const objName of Object.keys(anyTopo.objects)) {
		for (const geom of anyTopo.objects[objName].geometries) {
			if (geom.type === 'Polygon') {
				for (const ring of geom.arcs) arcRingToPath(ring, bezierArcs, path2d);
			} else if (geom.type === 'MultiPolygon') {
				for (const poly of geom.arcs) for (const ring of poly) arcRingToPath(ring, bezierArcs, path2d);
			} else if (geom.type === 'LineString') {
				arcRingToPath(geom.arcs, bezierArcs, path2d, false);
			} else if (geom.type === 'MultiLineString') {
				for (const line of geom.arcs) arcRingToPath(line, bezierArcs, path2d, false);
			}
		}
	}

	return path2d;
}
