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
	// Approximate canvas width/height from the projection's translate (fitSize sets it to [w/2, h/2]).
	const projWidth  = proj.translate()[0] * 2;
	const projHeight = proj.translate()[1] * 2;
	// Points that project beyond this distance are treated as invalid.
	// Orthographic already returns null for back-hemisphere points; this threshold
	// catches azimuthal and conic projections that return extreme (but non-null)
	// coordinates for out-of-domain points.
	const MAX_COORD = Math.max(projWidth, projHeight) * 3;

	// For projections that have a small-circle preclip (e.g. orthographic at 90°,
	// gnomonic at ~60°), the direct proj(point) call does NOT apply d3's stream-based
	// preclip — it just runs the raw projection math.  For orthographic in particular,
	// back-hemisphere points return valid but wrong screen coordinates that land *inside*
	// the sphere circle, causing ghost features and evenodd fill artifacts.  We manually
	// replicate the preclip by checking geoDistance against the clip angle.
	//
	// Conic projections return clipAngle = 0 (meaning "use antimeridian clip, no small
	// circle") — applying geoDistance at 0° would filter every point.  Wide-angle
	// projections (stereographic 142°, azimuthal equal-area ~180°) are also excluded;
	// their out-of-clip points project to extreme coordinates caught by MAX_COORD.
	// geoAlbersUsa has no clipAngle method at all, so we guard with typeof.
	const rot = typeof proj.rotate === 'function' ? proj.rotate() : ([0, 0, 0] as [number, number, number]);
	const projCenter: [number, number] = [-rot[0], -rot[1]];
	const clipAngle = typeof proj.clipAngle === 'function' ? proj.clipAngle() : null;
	// Apply the distance check only for true hemisphere-style clips (roughly 45°–91°).
	// This catches orthographic (90.000001°) and gnomonic (~60°) while leaving
	// conic (0°) and wide-angle azimuthal (>91°) projections for MAX_COORD filtering.
	const clipDistRad = (clipAngle !== null && clipAngle > 0 && clipAngle <= 91)
		? clipAngle * Math.PI / 180
		: Infinity;

	// Diagonal width/height for threshold calculations — uses the larger of the two
	// projection dimensions so the checks are consistent on non-square canvases.
	const projMax = Math.max(projWidth, projHeight);

	// Diagnostic counters — logged once per call, removed after debugging.
	let _totalArcs = 0;
	let _nullArcs = 0;      // arcs with at least one null projected point
	let _splitArcs = 0;     // arcs whose nulls broke them into >1 run
	let _emptyArcs = 0;     // arcs where every point was null/extreme
	let _antiArcs = 0;      // arcs that hit the antimeridian / screen-dist break
	let _jumpFired = 0;     // times JUMP check replaced prev/next with a ghost

	const _result = (anyTopo.arcs as number[][][]).map((arc: number[][]) => {
		_totalArcs++;
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

		// Project each point. A point is valid if proj() returns non-null AND its
		// coordinates aren't excessively far from the canvas — orthographic returns
		// null for back-hemisphere points, but azimuthal/conic projections return
		// extreme finite coordinates for out-of-domain points instead.
		// Clamp lon/lat before projecting to match the guard in MapCanvas and avoid
		// NaN from quantization artifacts (e.g. lat = 90 + ε from integer arithmetic).
		const projected: ([number, number] | null)[] = geo.map(g => {
			const cg: [number, number] = [
				Math.max(-180, Math.min(180, g[0])),
				Math.max( -90, Math.min( 90, g[1])),
			];
			// Manually apply the clip angle that d3's stream preclip would enforce.
			// For orthographic, clipDistRad = π/2 — points beyond that are back-hemisphere.
			if (clipDistRad < Infinity && d3.geoDistance(cg, projCenter) >= clipDistRad) return null;
			const p = proj(cg) as [number, number] | null;
			if (!p) return null;
			if (Math.abs(p[0]) > MAX_COORD || Math.abs(p[1]) > MAX_COORD) return null;
			return p;
		});

		// Split into consecutive runs of valid projected points, inserting a break
		// between each run. The original filter-and-connect approach caused two bugs:
		// (1) For globe projections, back-hemisphere nulls were silently removed,
		//     leaving front-hemisphere endpoints incorrectly connected across the gap.
		// (2) For conic/azimuthal projections, extreme-coordinate points passed the
		//     null check and corrupted bezier control points for adjacent segments.
		// By splitting into runs, each sub-arc is computed independently and break
		// markers (moveTo) are emitted between runs instead of drawing across the gap.
		const runs: { pts: [number, number][]; geos: [number, number][] }[] = [];
		let runPts:  [number, number][] = [];
		let runGeos: [number, number][] = [];
		for (let k = 0; k < projected.length; k++) {
			const p = projected[k];
			if (p !== null) {
				runPts.push(p);
				runGeos.push(geo[k]);
			} else if (runPts.length > 0) {
				runs.push({ pts: runPts, geos: runGeos });
				runPts  = [];
				runGeos = [];
			}
		}
		if (runPts.length > 0) runs.push({ pts: runPts, geos: runGeos });

		const hasNulls = projected.some(p => p === null);
		if (hasNulls) _nullArcs++;
		if (runs.length === 0) { _emptyArcs++; return { sx: 0, sy: 0, segs: [] }; }
		if (runs.length > 1)  _splitArcs++;

		const sx = runs[0].pts[0][0];
		const sy = runs[0].pts[0][1];
		const segs: BezierSegment[] = [];

		for (let r = 0; r < runs.length; r++) {
			const { pts, geos } = runs[r];

			// Emit a moveTo break at the start of every run after the first.
			if (r > 0) {
				segs.push({ cp1x: pts[0][0], cp1y: pts[0][1], cp2x: pts[0][0], cp2y: pts[0][1], ex: pts[0][0], ey: pts[0][1], isBreak: true });
			}

			const n = pts.length;
			if (n < 2) continue;

		for (let i = 0; i < n - 1; i++) {
			const prev: [number, number] = i === 0
				? [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]]
				: pts[i - 1];
			const p1 = pts[i];
			const p2 = pts[i + 1];
			const next: [number, number] = i === n - 2
				? [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]]
				: pts[i + 2];

			// Guard against antimeridian jumps and polar distortion: if a neighbour is
			// more than 10× the current segment length away in screen space, OR more than
			// 15% of the projection's larger dimension, fall back to the reflected ghost
			// so the tangent doesn't blow out. The 15% threshold (down from 30%) catches
			// cases near conic pole areas where adjacent arc points are 100–200px apart.
			const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
			const JUMP = 10;
			const distPrev = Math.hypot(p1[0] - prev[0], p1[1] - prev[1]);
			const usedGhost = { prev: false, next: false };
			const safePrev: [number, number] = distPrev > JUMP * segLen || distPrev > projMax * 0.15
				? (usedGhost.prev = true, [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]])
				: prev;
			const distNext = Math.hypot(next[0] - p2[0], next[1] - p2[1]);
			const safeNext: [number, number] = distNext > JUMP * segLen || distNext > projMax * 0.15
				? (usedGhost.next = true, [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]])
				: next;
			if (usedGhost.prev || usedGhost.next) _jumpFired++;

			// If p1 and p2 themselves cross +-180 deg longitude, or span more than 20%
			// of the projection's larger dimension in screen space, emit a moveTo break
			// so no bezier is drawn across the gap.
			const screenSegDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
			if (Math.abs(geos[i][0] - geos[i + 1][0]) > 180 || screenSegDist > projMax * 0.2) {
				_antiArcs++;
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
		} // end segment loop
		} // end run loop

		return { sx, sy, segs };
	});

	console.log(
		`[bezier] clipAngle=${clipAngle?.toFixed(2) ?? 'none'} clipDistRad=${clipDistRad < Infinity ? clipDistRad.toFixed(3) : 'Inf'}` +
		` MAX_COORD=${MAX_COORD.toFixed(0)} projMax=${projMax.toFixed(0)} arcs=${_totalArcs}` +
		` | null-point arcs=${_nullArcs} (split-into-runs=${_splitArcs}, all-empty=${_emptyArcs})` +
		` | antimeridian-breaks=${_antiArcs} jump-ghosts=${_jumpFired}`
	);

	return _result;
}

export interface PathRecorder {
	moveTo(x: number, y: number): void;
	bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number): void;
	closePath(): void;
}

/**
 * Writes one ring of arc indices into a PathRecorder, honouring forward/reversed
 * arcs via the ~idx convention. Break segments emit moveTo rather than
 * bezierCurveTo to avoid drawing across the antimeridian or projection boundary.
 *
 * For polygon rings (close=true) with NO breaks, a final closePath() is emitted so
 * the stroke traces the closing edge. For rings that DID have breaks, closePath() is
 * intentionally skipped — emitting it would draw a straight chord between two
 * non-adjacent ring points, which is the source of the visible diagonal artifacts on
 * conic and azimuthal projections. Canvas fill() implicitly closes each subpath for
 * fill purposes, so the polygon fill is correct either way.
 *
 * For LineStrings (close=false), breaks are plain moveTo with no close.
 * Path2D satisfies PathRecorder, so existing callers are unaffected.
 */
export function arcRingToPath(arcIndices: number[], bezierArcs: BezierArc[], recorder: PathRecorder, close = true): void {
	let started = false;
	let hadBreak = false;

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
					hadBreak = true;
					recorder.moveTo(toX, toY);
				} else {
					recorder.bezierCurveTo(seg.cp2x, seg.cp2y, seg.cp1x, seg.cp1y, toX, toY);
				}
			}
		} else {
			if (!started) { recorder.moveTo(arc.sx, arc.sy); started = true; }
			for (const seg of arc.segs) {
				if (seg.isBreak) {
					hadBreak = true;
					recorder.moveTo(seg.ex, seg.ey);
				} else {
					recorder.bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, seg.ex, seg.ey);
				}
			}
		}
	}

	// Only close unbroken rings. For rings that had breaks (antimeridian crossings,
	// hemisphere edges), emitting closePath() would draw a straight chord between
	// non-adjacent ring points — the visible diagonal artifact. Canvas fill()
	// implicitly closes each subpath for fill purposes, so the fill is still correct.
	// Stroke() does not implicitly close, so no chord line is drawn.
	if (started && close && !hadBreak) recorder.closePath();
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
