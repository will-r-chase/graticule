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
	// Set on break segments to distinguish reconstructable crossings from plain moveTos.
	breakType?: 'antimeridian' | 'hemisphere' | 'viewport' | 'clamp';
	// Antimeridian/hemisphere/viewport breaks: exact projected boundary point on the exit side.
	// ex/ey on these breaks is the exact projected entry boundary point.
	exitX?: number;
	exitY?: number;
	// Antimeridian breaks only: crossing latitude (degrees) and exit side (+1 / -1).
	crossLat?: number;
	exitSide?: number;
	// Viewport breaks only: canvas dimensions needed for perimeter parameterisation.
	vpW?: number;
	vpH?: number;
};

export type BezierArc = { sx: number; sy: number; segs: BezierSegment[] };

// Re-exported for convenience — defined in types.ts.
export type { BezierCurveType };

// Wraps a longitude (in degrees) to [−180, 180].
// d3.geoRotation with a lambda-only rotation just adds the delta without
// wrapping, so rotated longitudes can land outside this range.
function normLon(lon: number): number {
	return ((lon % 360) + 540) % 360 - 180;
}

// Returns the geographic latitude (degrees) where the great-circle arc from
// [lon0, lat0] to [lon1, lat1] crosses the antimeridian (±180°).
// Adapted from D3's clipAntimeridianIntersect — inputs and output are in degrees.
function antimeridianCrossLat(lon0: number, lat0: number, lon1: number, lat1: number): number {
	const lam0 = lon0 * Math.PI / 180, phi0 = lat0 * Math.PI / 180;
	const lam1 = lon1 * Math.PI / 180, phi1 = lat1 * Math.PI / 180;
	const sinDL = Math.sin(lam0 - lam1);
	const crossPhi = Math.abs(sinDL) > 1e-6
		? Math.atan(
			(Math.sin(phi0) * Math.cos(phi1) * Math.sin(lam1)
			 - Math.sin(phi1) * Math.cos(phi0) * Math.sin(lam0))
			/ (Math.cos(phi0) * Math.cos(phi1) * sinDL)
		)
		: (phi0 + phi1) / 2;
	return crossPhi * 180 / Math.PI;
}

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
	bias: number,
	canvasWidth: number,
	canvasHeight: number
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
	// rotFn is used after D3 splits an arc to recover crossLat/exitSide from the
	// two geo vertices that straddle the antimeridian crossing.
	const rotFn = d3.geoRotation(rot);
	const clipAngle = typeof proj.clipAngle === 'function' ? proj.clipAngle() : null;
	// Apply the distance check only for true hemisphere-style clips (roughly 45°–91°).
	// This catches orthographic (90.000001°) and gnomonic (~60°) while leaving
	// conic (0°) and wide-angle azimuthal (>91°) projections for MAX_COORD filtering.
	const clipDistRad = (clipAngle !== null && clipAngle > 0 && clipAngle <= 91)
		? clipAngle * Math.PI / 180
		: Infinity;
	// True whenever D3 uses a small-circle preclip for this projection — regardless of
	// the clip angle. Used to classify D3 sub-path splits: if the projection has any
	// small-circle preclip (clipAngle > 0), splits come from that preclip and should be
	// treated as hemisphere breaks. If clipAngle is 0 (conic, antimeridian-only) or null
	// (no clipAngle method), splits are antimeridian or viewport breaks instead.
	// Note: clipDistRad uses a ≤91° threshold for a different reason (point filtering),
	// so these two variables serve separate concerns.
	const hasSmallCircleClip = clipAngle !== null && clipAngle > 0;

	// Diagonal width/height for threshold calculations — uses the larger of the two
	// projection dimensions so the checks are consistent on non-square canvases.
	const projMax = Math.max(projWidth, projHeight);

	// Diagnostic counters — logged once per call, removed after debugging.
	let _totalArcs = 0;
	let _splitArcs = 0;     // arcs split by D3 into 2+ sub-paths
	let _emptyArcs = 0;     // arcs entirely clipped away by D3
	let _antiArcs = 0;      // antimeridian-break segments inserted
	let _hemiArcs = 0;      // hemisphere-break segments inserted
	let _jumpFired = 0;     // times JUMP check replaced prev/next with a ghost

	// Disable resampling for the duration of arc processing. precision(0) tells D3's
	// stream not to insert intermediate points between arc vertices, so the sub-paths
	// we capture contain only the original quantized vertices (plus exact crossing
	// points at clipping boundaries). Catmull-Rom is applied to those original vertices,
	// preserving the full bezier smoothing effect.
	const origPrecision = proj.precision();
	proj.precision(0);

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

		// Feed arc vertices through D3's full pipeline (precision=0 → no resampling,
		// just clipping). D3's preclip (antimeridian or small-circle) splits the arc
		// at clipping boundaries, emitting lineStart/lineEnd pairs for each sub-path.
		// The extra crossing points D3 inserts at split boundaries become the sub-path
		// endpoints, giving us exact exit/entry screen coordinates for free.
		//
		// subPathGeoStarts[r] = index into geo[] of the first ORIGINAL vertex in sub-path r.
		// When D3 fires lineStart() for a new sub-path (due to an antimeridian crossing
		// while processing geo[gi]), pendingGeoStart = gi — so subPathGeoStarts[r] = gi,
		// meaning the crossing is between geo[gi-1] and geo[gi].
		const dSubPaths: [number, number][][] = [];
		let dCurrent: [number, number][] = [];
		const subPathGeoStarts: number[] = [];
		let pendingGeoStart = 0;

		const captureSink: d3.GeoStream = {
			point(x: number, y: number) { dCurrent.push([x, y]); },
			lineStart() { dCurrent = []; subPathGeoStarts.push(pendingGeoStart); },
			lineEnd()   { if (dCurrent.length > 0) dSubPaths.push(dCurrent); },
			polygonStart() {}, polygonEnd() {}, sphere() {},
		};

		const stream = proj.stream(captureSink);
		stream.lineStart();
		for (let gi = 0; gi < geo.length; gi++) {
			pendingGeoStart = gi;
			stream.point(geo[gi][0], geo[gi][1]);
		}
		stream.lineEnd();

		if (dSubPaths.length === 0) { _emptyArcs++; return { sx: 0, sy: 0, segs: [] }; }
		if (dSubPaths.length > 1)   _splitArcs++;

		const sx = dSubPaths[0][0][0];
		const sy = dSubPaths[0][0][1];
		const segs: BezierSegment[] = [];

		for (let r = 0; r < dSubPaths.length; r++) {
			const pts = dSubPaths[r];

			// Insert a break segment before each sub-path after the first.
			// The exit point is the last point of the previous sub-path (added by D3
			// at the clipping boundary); the entry point is the first point of this one.
			if (r > 0) {
				const prevPts = dSubPaths[r - 1];
				const exitX  = prevPts[prevPts.length - 1][0];
				const exitY  = prevPts[prevPts.length - 1][1];
				const entryX = pts[0][0];
				const entryY = pts[0][1];

				if (hasSmallCircleClip) {
					// Small-circle (hemisphere) split — D3's preclip fired.
					// This applies to any projection with clipAngle > 0 (orthographic 90°,
					// gnomonic ~60°, stereographic 142°, azimuthal ~180°, etc.).
					// arcRingReconstructHemisphere derives the boundary circle from the actual
					// exit/entry screen coordinates, so it handles any clip angle correctly.
					_hemiArcs++;
					segs.push({ cp1x: exitX, cp1y: exitY, cp2x: exitX, cp2y: exitY,
						ex: entryX, ey: entryY, isBreak: true, breakType: 'hemisphere', exitX, exitY });
				} else {
					// Potential antimeridian split — verify by checking that the geographic
					// vertices before/after the break actually straddle ±180°. If |rl1 - rl2|
					// ≤ 180 the split was caused by D3's viewport postclip (e.g. Antarctica
					// extending to y=∞ on Mercator), not a true antimeridian crossing.
					const beforeIdx = subPathGeoStarts[r] - 1;
					const afterIdx  = subPathGeoStarts[r];
					let crossLat = 0, exitSide = 1, isAnti = false;
					if (beforeIdx >= 0 && afterIdx < geo.length) {
						const rg1 = rotFn(geo[beforeIdx] as [number, number]) as [number, number];
						const rg2 = rotFn(geo[afterIdx]  as [number, number]) as [number, number];
						const rl1 = normLon(rg1[0]);
						const rl2 = normLon(rg2[0]);
						isAnti = Math.abs(rl1 - rl2) > 180;
						if (isAnti) {
							crossLat = antimeridianCrossLat(rl1, rg1[1], rl2, rg2[1]);
							exitSide = rl1 > 0 ? 1 : -1;
							// Verify this is a true antimeridian split and not a viewport postclip.
							// We project a point 0.1° inside the antimeridian (179.9° not 180°,
							// because proj() clips points exactly on the boundary and returns null).
							// For a real crossing the theoretical point is very close to the actual
							// D3 exit; for a viewport clip (e.g. Antarctica near the south pole,
							// where vertices straddle ±180° but the arc goes over the pole) the
							// theoretical point is off-screen (proj returns null) or far away.
							const theoreticalGeo = rotFn.invert([exitSide * 179.9, crossLat] as [number, number]);
							const theoreticalPx = theoreticalGeo ? proj(theoreticalGeo as [number, number]) : null;
							if (!theoreticalPx || Math.hypot(theoreticalPx[0] - exitX, theoreticalPx[1] - exitY) >= 10) {
								isAnti = false;
							}
						}
					}
					if (isAnti) {
						_antiArcs++;
						segs.push({ cp1x: exitX, cp1y: exitY, cp2x: exitX, cp2y: exitY,
							ex: entryX, ey: entryY, isBreak: true, breakType: 'antimeridian',
							exitX, exitY, crossLat, exitSide });
					} else {
						segs.push({ cp1x: exitX, cp1y: exitY, cp2x: exitX, cp2y: exitY,
							ex: entryX, ey: entryY, isBreak: true, breakType: 'viewport',
							exitX, exitY });
					}
				}
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

				// Guard against large screen-space jumps: if a neighbour is more than
				// 10× the segment length OR 15% of the projection's larger dimension
				// away, fall back to a reflected ghost so the tangent doesn't blow out.
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

				if (curveType === 'bspline') {
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
		} // end sub-path loop

		return { sx, sy, segs };
	});

	proj.precision(origPrecision);

	console.log(
		`[bezier] arcs=${_totalArcs} split=${_splitArcs} empty=${_emptyArcs}` +
		` | antimeridian-breaks=${_antiArcs} hemisphere-breaks=${_hemiArcs} jump-ghosts=${_jumpFired}`
	);

	return _result;
}

export interface PathRecorder {
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, ex: number, ey: number): void;
	closePath(): void;
}

// Debug flag: set to true to use plain closePath() instead of traceAntimeridianBoundary.
// Isolates whether artifacts come from the boundary trace or from the walk/pairing logic.
const DEBUG_CLOSEPATH = false;


// Parameterises a point on the antimeridian boundary for sorting (D3's compareIntersection).
// right side (+1): descends from 0 at +90° to π at −90°   (all t ≥ 0)
// left  side (-1): ascends  from −π at −90° to 0 at +90°  (all t ≤ 0)
// Together they form a continuous ordering around the full antimeridian boundary.
function antimeridianT(side: number, latDeg: number): number {
	const latRad = latDeg * Math.PI / 180;
	return side < 0 ? latRad - Math.PI / 2 : Math.PI / 2 - latRad;
}

// Traces the antimeridian boundary from the current exit point to entryX/entryY
// by sampling the antimeridian in the projection's rotated coordinate frame.
// fromLat/toLat and exitSide/entrySide are in the rotated frame (as stored on
// break segments). rotFn.invert converts each sample back to geographic coords
// for proj(), giving a smooth curve that follows the projected meridian.
// entryX/entryY (exact D3 screen coords) are snapped to at the end.
//
// If any sampled point falls outside the canvas, the entire sweep is abandoned
// and the function falls through to the final lineTo(entryX, entryY). This
// avoids diagonal line artifacts on conic/azimuthal projections where part of
// the antimeridian projects off-canvas — a partial sweep followed by a jump to
// entryX/entryY is worse than a straight chord.
function traceAntimeridianBoundary(
	exitSide: number, entrySide: number,
	fromLat: number, toLat: number,
	proj: d3.GeoProjection, recorder: PathRecorder,
	entryX: number, entryY: number,
	viewport?: [number, number]
): void {
	const EPS    = 0.01; // stay just inside ±180 to avoid boundary instability
	const STEP   = 0.1;  // degrees latitude per sample
	const MARGIN = 4;    // px — allow fractional overhang at the canvas edge
	// geoAlbersUsa and other composite projections have no .rotate method; guard with typeof.
	const rot    = typeof proj.rotate === 'function' ? proj.rotate() : ([0, 0, 0] as [number, number, number]);
	const rotFn  = d3.geoRotation(rot);
	// Use the actual canvas dimensions when available; fall back to the projection's
	// translate as a rough estimate (accurate only for centred projections).
	const [tx, ty] = proj.translate();
	const vpW = viewport ? viewport[0] : tx * 2;
	const vpH = viewport ? viewport[1] : ty * 2;

	// Pre-collect all projected points for a latitude sweep on one side of the
	// antimeridian. Returns the array of screen points if every sample is within
	// the canvas (+margin), or null if any sample is off-canvas.
	const trySweep = (lon: number, latA: number, latB: number): [number, number][] | null => {
		const dir = latB > latA ? 1 : -1;
		const pts: [number, number][] = [];
		for (let lat = latA + dir * STEP; dir * (latB - lat) > STEP / 2; lat += dir * STEP) {
			const geo = rotFn.invert([lon, lat] as [number, number]);
			const pt  = proj(geo as [number, number]);
			if (!pt || !isFinite(pt[0]) || !isFinite(pt[1]) ||
				pt[0] < -MARGIN || pt[0] > vpW + MARGIN ||
				pt[1] < -MARGIN || pt[1] > vpH + MARGIN) {
				return null;
			}
			pts.push([pt[0], pt[1]]);
		}
		return pts;
	};

	console.log(`[traceBoundary] viewport=${vpW.toFixed(0)}x${vpH.toFixed(0)} fromLat=${fromLat.toFixed(2)} toLat=${toLat.toFixed(2)} exitSide=${exitSide} entrySide=${entrySide} entryXY=(${entryX.toFixed(1)},${entryY.toFixed(1)})`);

	if (exitSide === entrySide) {
		// Same side of the antimeridian: sweep directly from fromLat to toLat.
		const lon = exitSide > 0 ? 180 - EPS : -180 + EPS;
		const pts = trySweep(lon, fromLat, toLat);
		console.log(`  same-side lon=${lon.toFixed(2)}: trySweep returned ${pts === null ? 'NULL (aborted)' : `${pts.length} pts`}${pts && pts.length > 0 ? ` first=(${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}) last=(${pts[pts.length-1][0].toFixed(1)},${pts[pts.length-1][1].toFixed(1)})` : ''}`);
		if (pts) for (const [x, y] of pts) recorder.lineTo(x, y);
	} else {
		// Opposite sides: route via the nearer pole in the rotated frame.
		const pole     = ((fromLat + toLat) / 2) >= 0 ? 90 : -90;
		const exitLon  = exitSide  > 0 ? 180 - EPS : -180 + EPS;
		const entryLon = entrySide > 0 ? 180 - EPS : -180 + EPS;
		const pts1 = trySweep(exitLon, fromLat, pole);
		const pts2 = trySweep(entryLon, pole, toLat);
		console.log(`  opp-side pole=${pole} pts1=${pts1 === null ? 'NULL' : pts1.length} pts2=${pts2 === null ? 'NULL' : pts2.length}`);
		if (pts1?.length && pts2?.length) {
			const polePt = proj(rotFn.invert([exitLon, pole] as [number, number]) as [number, number]);
			if (polePt && isFinite(polePt[0]) && isFinite(polePt[1]) &&
				polePt[0] > -MARGIN && polePt[0] < vpW + MARGIN &&
				polePt[1] > -MARGIN && polePt[1] < vpH + MARGIN) {
				for (const [x, y] of pts1) recorder.lineTo(x, y);
				recorder.lineTo(polePt[0], polePt[1]);
				for (const [x, y] of pts2) recorder.lineTo(x, y);
			}
		}
	}

	recorder.lineTo(entryX, entryY);
}

// Binary-searches the great-circle arc from `inside` (valid) to `outside` (hemisphere)
// for the exact geographic point where geoDistance(pt, center) = clipRad.
// Uses linear interpolation in geographic degrees — accurate enough for adjacent points.
function findHorizonCrossing(
	inside: [number, number], outside: [number, number],
	center: [number, number], clipRad: number
): [number, number] {
	let lo = 0, hi = 1;
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) / 2;
		const pt: [number, number] = [
			inside[0] + (outside[0] - inside[0]) * mid,
			inside[1] + (outside[1] - inside[1]) * mid,
		];
		if (d3.geoDistance(pt, center) < clipRad) lo = mid; else hi = mid;
	}
	const t = (lo + hi) / 2;
	return [inside[0] + (outside[0] - inside[0]) * t, inside[1] + (outside[1] - inside[1]) * t];
}

// Traces a circular arc in screen space from fromAngle to toAngle (in radians, atan2
// convention) at the given centre and radius, sampling every 2°. Chooses the shorter
// arc direction automatically.
function traceHorizonBoundary(
	cx: number, cy: number, radius: number,
	fromAngle: number, toAngle: number,
	recorder: PathRecorder
): void {
	let delta = toAngle - fromAngle;
	while (delta >  Math.PI) delta -= 2 * Math.PI;
	while (delta < -Math.PI) delta += 2 * Math.PI;
	const step = delta > 0 ? 2 * Math.PI / 180 : -2 * Math.PI / 180;
	const n = Math.abs(delta / step);
	let angle = fromAngle;
	for (let i = 0; i < n - 0.5; i++) {
		angle += step;
		recorder.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
	}
	recorder.lineTo(cx + radius * Math.cos(toAngle), cy + radius * Math.sin(toAngle));
}

// Reconstructs properly-closed sub-polygons for a polygon ring that has hemisphere
// crossings. Same D3-style rejoin approach as arcRingReconstructAntimeridian but the
// boundary is the small circle (horizon circle), parameterised by screen-space angle.
function arcRingReconstructHemisphere(
	arcIndices: number[],
	bezierArcs: BezierArc[],
	recorder: PathRecorder,
	proj: d3.GeoProjection
): void {
	interface SegCmd { cp1x: number; cp1y: number; cp2x: number; cp2y: number; ex: number; ey: number }
	interface RingSeg { startX: number; startY: number; cmds: SegCmd[] }
	interface RingBreak { exitX: number; exitY: number; entryX: number; entryY: number }

	const segs: RingSeg[] = [];
	const ringBreaks: RingBreak[] = [];
	let curStartX = 0, curStartY = 0, curCmds: SegCmd[] = [];
	let started = false;

	const flushSeg = (brk: RingBreak) => {
		segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });
		ringBreaks.push(brk);
		curCmds = [];
		curStartX = brk.entryX;
		curStartY = brk.entryY;
	};

	for (const idx of arcIndices) {
		const reversed = idx < 0;
		const arc = bezierArcs[reversed ? ~idx : idx];
		if (!arc || arc.segs.length === 0) continue;

		if (reversed) {
			if (!started) {
				const last = arc.segs[arc.segs.length - 1];
				curStartX = last.ex; curStartY = last.ey;
				started = true;
			}
			for (let i = arc.segs.length - 1; i >= 0; i--) {
				const seg = arc.segs[i];
				const toX = i === 0 ? arc.sx : arc.segs[i - 1].ex;
				const toY = i === 0 ? arc.sy : arc.segs[i - 1].ey;
				if (seg.isBreak && seg.breakType === 'hemisphere') {
					// Reversed traversal: exit ↔ entry swap
					flushSeg({ exitX: seg.ex, exitY: seg.ey, entryX: seg.exitX!, entryY: seg.exitY! });
				} else if (!seg.isBreak) {
					curCmds.push({ cp1x: seg.cp2x, cp1y: seg.cp2y, cp2x: seg.cp1x, cp2y: seg.cp1y, ex: toX, ey: toY });
				}
			}
		} else {
			if (!started) { curStartX = arc.sx; curStartY = arc.sy; started = true; }
			for (const seg of arc.segs) {
				if (seg.isBreak && seg.breakType === 'hemisphere') {
					flushSeg({ exitX: seg.exitX!, exitY: seg.exitY!, entryX: seg.ex, entryY: seg.ey });
				} else if (!seg.isBreak) {
					curCmds.push({ cp1x: seg.cp1x, cp1y: seg.cp1y, cp2x: seg.cp2x, cp2y: seg.cp2y, ex: seg.ex, ey: seg.ey });
				}
			}
		}
	}
	segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });

	const N = ringBreaks.length;
	if (N === 0 || segs.length === 0) return;

	// Boundary circle: center = projection of the geographic projection center,
	// radius = distance from center to any crossing point.
	// geoAlbersUsa and other composite projections have no .rotate method; guard with typeof.
	const rot = typeof proj.rotate === 'function' ? proj.rotate() : ([0, 0, 0] as [number, number, number]);
	const projCenter: [number, number] = [-rot[0], -rot[1]];
	const centerPt = proj(projCenter) as [number, number] | null;
	if (!centerPt) return;
	const [cx, cy] = centerPt;
	const radius = Math.hypot(ringBreaks[0].exitX - cx, ringBreaks[0].exitY - cy);
	if (radius < 1) return;

	interface BNode { angle: number; isEntry: boolean; segIdx: number; projX: number; projY: number }
	const nodes: BNode[] = [];
	for (let i = 0; i < N; i++) {
		const b = ringBreaks[i];
		nodes.push({ angle: Math.atan2(b.exitY  - cy, b.exitX  - cx), isEntry: false, segIdx: i,   projX: b.exitX,  projY: b.exitY  });
		nodes.push({ angle: Math.atan2(b.entryY - cy, b.entryX - cx), isEntry: true,  segIdx: i+1, projX: b.entryX, projY: b.entryY });
	}
	nodes.sort((a, b) => a.angle - b.angle);

	const totalSegs = segs.length;
	for (let k = 0; k + 1 < nodes.length; k += 2) {
		const a = nodes[k], b = nodes[k + 1];
		const X = a.isEntry ? b : a; // exit node
		const Y = a.isEntry ? a : b; // entry node

		recorder.moveTo(Y.projX, Y.projY);

		let si = Y.segIdx;
		let steps = 0;
		while (true) {
			const seg = segs[si % totalSegs];
			if (steps > 0) recorder.lineTo(seg.startX, seg.startY);
			for (const cmd of seg.cmds) recorder.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.ex, cmd.ey);
			if (si % totalSegs === X.segIdx) break;
			si++;
			if (++steps > totalSegs) break;
		}

		recorder.lineTo(X.projX, X.projY);
		traceHorizonBoundary(cx, cy, radius, X.angle, Y.angle, recorder);
		recorder.closePath();
	}
}

// Binary-searches the line from `inside` (in viewport) to `outside` (out of viewport)
// for the exact screen-space point where the segment crosses the canvas rectangle edge.
function findViewportCrossing(
	inside: [number, number], outside: [number, number],
	W: number, H: number
): [number, number] {
	let lo = 0, hi = 1;
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) / 2;
		const x = inside[0] + (outside[0] - inside[0]) * mid;
		const y = inside[1] + (outside[1] - inside[1]) * mid;
		if (x >= 0 && x <= W && y >= 0 && y <= H) lo = mid; else hi = mid;
	}
	const t = (lo + hi) / 2;
	return [inside[0] + (outside[0] - inside[0]) * t, inside[1] + (outside[1] - inside[1]) * t];
}

// Returns the perimeter parameter of a canvas-edge crossing point.
// Parameterisation: top L→R (0..W), right T→B (W..W+H), bottom R→L (W+H..2W+H),
// left B→T (2W+H..2W+2H). This gives a consistent ordering for sort-and-pair.
function viewportCrossingT(x: number, y: number, W: number, H: number): number {
	const dTop    = y;
	const dRight  = W - x;
	const dBottom = H - y;
	const dLeft   = x;
	const minD = Math.min(dTop, dRight, dBottom, dLeft);
	if (minD === dTop)    return x;
	if (minD === dRight)  return W + y;
	if (minD === dBottom) return W + H + (W - x);
	return 2 * W + H + (H - y);
}

// Returns the screen-space point at perimeter position t around the canvas rectangle.
function perimeterPoint(t: number, W: number, H: number): [number, number] {
	if (t < W)       return [t, 0];
	t -= W;
	if (t < H)       return [W, t];
	t -= H;
	if (t < W)       return [W - t, H];
	t -= W;
	return [0, H - t];
}

// Traces the canvas rectangle boundary from exitT to entryT (by perimeter parameter)
// in the forward direction (increasing t, wrapping), sampling at ~2px intervals.
function traceViewportBoundary(
	exitX: number, exitY: number,
	entryX: number, entryY: number,
	W: number, H: number,
	recorder: PathRecorder
): void {
	const perimeter = 2 * W + 2 * H;
	const exitT  = viewportCrossingT(exitX,  exitY,  W, H);
	const entryT = viewportCrossingT(entryX, entryY, W, H);
	let dist = entryT - exitT;
	if (dist <= 0) dist += perimeter;
	const step = 2; // ~2px steps
	let t = exitT;
	const steps = Math.floor(dist / step);
	for (let i = 0; i < steps - 1; i++) {
		t += step;
		if (t >= perimeter) t -= perimeter;
		const [px, py] = perimeterPoint(t, W, H);
		recorder.lineTo(px, py);
	}
	recorder.lineTo(entryX, entryY);
}

// Reconstructs properly-closed sub-polygons for a polygon ring that crosses the canvas
// viewport edge. Same D3-style rejoin as the antimeridian and hemisphere variants, but
// the boundary is the canvas rectangle parameterised by perimeter position.
function arcRingReconstructViewport(
	arcIndices: number[],
	bezierArcs: BezierArc[],
	recorder: PathRecorder,
	vpW: number,
	vpH: number
): void {
	interface SegCmd { cp1x: number; cp1y: number; cp2x: number; cp2y: number; ex: number; ey: number }
	interface RingSeg { startX: number; startY: number; cmds: SegCmd[] }
	interface RingBreak { exitX: number; exitY: number; entryX: number; entryY: number }

	const segs: RingSeg[] = [];
	const ringBreaks: RingBreak[] = [];
	let curStartX = 0, curStartY = 0, curCmds: SegCmd[] = [];
	let started = false;

	const flushSeg = (brk: RingBreak) => {
		segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });
		ringBreaks.push(brk);
		curCmds = [];
		curStartX = brk.entryX;
		curStartY = brk.entryY;
	};

	for (const idx of arcIndices) {
		const reversed = idx < 0;
		const arc = bezierArcs[reversed ? ~idx : idx];
		if (!arc || arc.segs.length === 0) continue;

		if (reversed) {
			if (!started) {
				const last = arc.segs[arc.segs.length - 1];
				curStartX = last.ex; curStartY = last.ey;
				started = true;
			}
			for (let i = arc.segs.length - 1; i >= 0; i--) {
				const seg = arc.segs[i];
				const toX = i === 0 ? arc.sx : arc.segs[i - 1].ex;
				const toY = i === 0 ? arc.sy : arc.segs[i - 1].ey;
				if (seg.isBreak && seg.breakType === 'viewport') {
					flushSeg({ exitX: seg.ex, exitY: seg.ey, entryX: seg.exitX!, entryY: seg.exitY! });
				} else if (!seg.isBreak) {
					curCmds.push({ cp1x: seg.cp2x, cp1y: seg.cp2y, cp2x: seg.cp1x, cp2y: seg.cp1y, ex: toX, ey: toY });
				}
			}
		} else {
			if (!started) { curStartX = arc.sx; curStartY = arc.sy; started = true; }
			for (const seg of arc.segs) {
				if (seg.isBreak && seg.breakType === 'viewport') {
					flushSeg({ exitX: seg.exitX!, exitY: seg.exitY!, entryX: seg.ex, entryY: seg.ey });
				} else if (!seg.isBreak) {
					curCmds.push({ cp1x: seg.cp1x, cp1y: seg.cp1y, cp2x: seg.cp2x, cp2y: seg.cp2y, ex: seg.ex, ey: seg.ey });
				}
			}
		}
	}
	segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });

	const N = ringBreaks.length;
	if (N === 0 || segs.length === 0) return;

	interface BNode { t: number; isEntry: boolean; segIdx: number; projX: number; projY: number }
	const nodes: BNode[] = [];
	for (let i = 0; i < N; i++) {
		const b = ringBreaks[i];
		nodes.push({ t: viewportCrossingT(b.exitX,  b.exitY,  vpW, vpH), isEntry: false, segIdx: i,   projX: b.exitX,  projY: b.exitY  });
		nodes.push({ t: viewportCrossingT(b.entryX, b.entryY, vpW, vpH), isEntry: true,  segIdx: i+1, projX: b.entryX, projY: b.entryY });
	}
	nodes.sort((a, b) => a.t - b.t);

	const totalSegs = segs.length;
	for (let k = 0; k + 1 < nodes.length; k += 2) {
		const a = nodes[k], b = nodes[k + 1];
		const X = a.isEntry ? b : a; // exit node
		const Y = a.isEntry ? a : b; // entry node

		recorder.moveTo(Y.projX, Y.projY);

		let si = Y.segIdx;
		let steps = 0;
		while (true) {
			const seg = segs[si % totalSegs];
			if (steps > 0) recorder.lineTo(seg.startX, seg.startY);
			for (const cmd of seg.cmds) recorder.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.ex, cmd.ey);
			if (si % totalSegs === X.segIdx) break;
			si++;
			if (++steps > totalSegs) break;
		}

		recorder.lineTo(X.projX, X.projY);
		traceViewportBoundary(X.projX, X.projY, Y.projX, Y.projY, vpW, vpH, recorder);
		recorder.closePath();
	}
}

// Reconstructs properly-closed sub-polygons for a polygon ring that has antimeridian
// crossings. Adapted from D3's clipRejoin: collects visible segments, builds boundary
// nodes sorted along the antimeridian, then pairs consecutive nodes to emit N/2 closed
// sub-polygons each sealed with a projected boundary trace.
function arcRingReconstructAntimeridian(
	arcIndices: number[],
	bezierArcs: BezierArc[],
	recorder: PathRecorder,
	proj: d3.GeoProjection,
	viewport?: [number, number]
): void {
	interface SegCmd { cp1x: number; cp1y: number; cp2x: number; cp2y: number; ex: number; ey: number }
	interface RingSeg { startX: number; startY: number; cmds: SegCmd[] }
	interface RingBreak { exitX: number; exitY: number; entryX: number; entryY: number; crossLat: number; exitSide: number }

	const segs: RingSeg[] = [];
	const ringBreaks: RingBreak[] = [];
	let curStartX = 0, curStartY = 0, curCmds: SegCmd[] = [];
	let started = false;

	const flushSeg = (brk: RingBreak) => {
		segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });
		ringBreaks.push(brk);
		curCmds = [];
		curStartX = brk.entryX;
		curStartY = brk.entryY;
	};

	for (const idx of arcIndices) {
		const reversed = idx < 0;
		const arc = bezierArcs[reversed ? ~idx : idx];
		if (!arc || arc.segs.length === 0) continue;

		if (reversed) {
			if (!started) {
				const last = arc.segs[arc.segs.length - 1];
				curStartX = last.ex; curStartY = last.ey;
				started = true;
			}
			for (let i = arc.segs.length - 1; i >= 0; i--) {
				const seg = arc.segs[i];
				const toX = i === 0 ? arc.sx : arc.segs[i - 1].ex;
				const toY = i === 0 ? arc.sy : arc.segs[i - 1].ey;
				if (seg.isBreak && seg.breakType === 'antimeridian') {
					// Reversed traversal: forward exit ↔ reversed entry, and vice-versa.
					flushSeg({ exitX: seg.ex, exitY: seg.ey, entryX: seg.exitX!, entryY: seg.exitY!, crossLat: seg.crossLat!, exitSide: -(seg.exitSide!) });
				} else if (seg.isBreak) {
					console.log(`[reconstruct] skipping non-antimeridian break (reversed): ${seg.breakType}`);
				} else {
					curCmds.push({ cp1x: seg.cp2x, cp1y: seg.cp2y, cp2x: seg.cp1x, cp2y: seg.cp1y, ex: toX, ey: toY });
				}
			}
		} else {
			if (!started) { curStartX = arc.sx; curStartY = arc.sy; started = true; }
			for (const seg of arc.segs) {
				if (seg.isBreak && seg.breakType === 'antimeridian') {
					flushSeg({ exitX: seg.exitX!, exitY: seg.exitY!, entryX: seg.ex, entryY: seg.ey, crossLat: seg.crossLat!, exitSide: seg.exitSide! });
				} else if (seg.isBreak) {
					console.log(`[reconstruct] skipping non-antimeridian break (forward): ${seg.breakType}`);
				} else {
					curCmds.push({ cp1x: seg.cp1x, cp1y: seg.cp1y, cp2x: seg.cp2x, cp2y: seg.cp2y, ex: seg.ex, ey: seg.ey });
				}
			}
		}
	}
	// Last segment has no following break — ring closes back to segs[0].start.
	segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });

	const N = ringBreaks.length;
	if (N === 0 || segs.length === 0) return;

	// Build one exit node and one entry node per antimeridian break.
	// Sorting by antimeridianT groups left-side nodes (t < 0) before right-side (t > 0),
	// and within each side orders by latitude. For a simple closed polygon, the sorted
	// list strictly alternates exit/entry; consecutive pairs define each sub-polygon's
	// boundary edge.
	interface BNode { t: number; isEntry: boolean; segIdx: number; crossLat: number; side: number; projX: number; projY: number }
	const nodes: BNode[] = [];
	for (let i = 0; i < N; i++) {
		const b = ringBreaks[i];
		nodes.push({ t: antimeridianT(b.exitSide,  b.crossLat), isEntry: false, segIdx: i,   crossLat: b.crossLat, side:  b.exitSide,  projX: b.exitX,  projY: b.exitY  });
		nodes.push({ t: antimeridianT(-b.exitSide, b.crossLat), isEntry: true,  segIdx: i+1, crossLat: b.crossLat, side: -b.exitSide, projX: b.entryX, projY: b.entryY });
	}
	nodes.sort((a, b) => a.t - b.t);

	console.log(`[antimeridian] N=${N} breaks, ${segs.length} segs`);
	ringBreaks.forEach((b, i) => console.log(`  break[${i}] exitSide=${b.exitSide} crossLat=${b.crossLat.toFixed(2)} exit=(${b.exitX.toFixed(1)},${b.exitY.toFixed(1)}) entry=(${b.entryX.toFixed(1)},${b.entryY.toFixed(1)})`));
	console.log('  sorted nodes:');
	nodes.forEach((n, i) => console.log(`    [${i}] t=${n.t.toFixed(3)} ${n.isEntry ? 'ENTRY' : 'EXIT '} side=${n.side} segIdx=${n.segIdx} crossLat=${n.crossLat.toFixed(2)} proj=(${n.projX.toFixed(1)},${n.projY.toFixed(1)})`));

	// Emit one closed sub-polygon per consecutive pair.
	const totalSegs = segs.length; // = N + 1 raw segments
	for (let k = 0; k + 1 < nodes.length; k += 2) {
		const a = nodes[k], b = nodes[k + 1];
		// X = exit end of boundary trace, Y = entry end (= moveTo start).
		const X = a.isEntry ? b : a;
		const Y = a.isEntry ? a : b;

		console.log(`  pair k=${k}: Y=${Y.isEntry?'ENTRY':'EXIT'} segIdx=${Y.segIdx} proj=(${Y.projX.toFixed(1)},${Y.projY.toFixed(1)}) → X=${X.isEntry?'ENTRY':'EXIT'} segIdx=${X.segIdx} proj=(${X.projX.toFixed(1)},${X.projY.toFixed(1)})`);

		recorder.moveTo(Y.projX, Y.projY);

		// Walk segments forward from Y.segIdx to X.segIdx (inclusive), wrapping around
		// the ring closure (segs[N] → segs[0]) when X.segIdx < Y.segIdx.
		let si = Y.segIdx;
		let steps = 0;
		while (true) {
			const seg = segs[si % totalSegs];
			if (steps > 0) recorder.lineTo(seg.startX, seg.startY); // snap to exact boundary entry
			for (const cmd of seg.cmds) recorder.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.ex, cmd.ey);
			if (si % totalSegs === X.segIdx) break;
			si++;
			if (++steps > totalSegs) break; // safety guard
		}

		// Snap to exact exit boundary, then trace along the antimeridian back to Y.
		recorder.lineTo(X.projX, X.projY);
		if (!DEBUG_CLOSEPATH) {
			traceAntimeridianBoundary(X.side, Y.side, X.crossLat, Y.crossLat, proj, recorder, Y.projX, Y.projY, viewport);
		}
		recorder.closePath();
	}
}

/**
 * Writes one ring of arc indices into a PathRecorder, honouring forward/reversed
 * arcs via the ~idx convention.
 *
 * When close=true and a projection is supplied, rings with antimeridian breaks are
 * reconstructed into properly-closed sub-polygons with boundary-traced edges (the
 * rejoin algorithm). Rings with only clamp/hemisphere breaks fall back to the
 * streaming path — those are handled separately.
 *
 * For LineStrings (close=false), breaks are plain moveTo with no close.
 * Path2D satisfies PathRecorder, so existing callers are unaffected.
 */
export function arcRingToPath(arcIndices: number[], bezierArcs: BezierArc[], recorder: PathRecorder, close = true, proj: d3.GeoProjection | null = null, viewport?: [number, number]): void {
	// Composite projections (e.g. geoAlbersUsa) have no single rotation/clip geometry,
	// so the boundary-reconstruction algorithms don't apply — they assume a globe-wide
	// projection with a meaningful rotate()/clip circle. Detect them via the missing
	// .rotate method and fall through to the plain streaming path instead.
	const isComposite = !!proj && typeof proj.rotate !== 'function';

	// Quick scan: route to the appropriate reconstruction function when the ring has
	// a single reconstructable break type and no plain clamp breaks mixed in.
	if (close && !isComposite) {
		let hasAnti = false, hasHemi = false, hasVp = false, hasOther = false;
		let antiBreakCount = 0;
		outer: for (const idx of arcIndices) {
			const arc = bezierArcs[idx < 0 ? ~idx : idx];
			if (!arc) continue;
			for (const seg of arc.segs) {
				if (!seg.isBreak) continue;
				if      (seg.breakType === 'antimeridian') { hasAnti = true; antiBreakCount++; }
				else if (seg.breakType === 'hemisphere')   hasHemi = true;
				else if (seg.breakType === 'viewport')     hasVp   = true;
				else                                       hasOther = true;
				if (hasOther) break outer;
			}
		}
		// Only reconstruct rings with ≤2 antimeridian crossings. Rings with more crossings
		// have internal boundary re-crossings that the walk algorithm can't handle cleanly —
		// they fall back to the moveTo-break path instead.
		if (proj && hasAnti && !hasHemi && !hasOther && antiBreakCount <= 2) {
			arcRingReconstructAntimeridian(arcIndices, bezierArcs, recorder, proj!, viewport);
			return;
		}
		if (proj && hasHemi && !hasAnti && !hasVp && !hasOther) {
			arcRingReconstructHemisphere(arcIndices, bezierArcs, recorder, proj);
			return;
		}
		if (viewport && hasVp && !hasAnti && !hasHemi && !hasOther) {
			arcRingReconstructViewport(arcIndices, bezierArcs, recorder, viewport[0], viewport[1]);
			return;
		}
	}

	// Original streaming path — unchanged for rings without antimeridian breaks.
	let started = false;
	let hadBreak = false;

	for (const idx of arcIndices) {
		const reversed = idx < 0;
		const arc = bezierArcs[reversed ? ~idx : idx];
		if (!arc || arc.segs.length === 0) continue;

		if (reversed) {
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

	// Only close unbroken rings — closing a broken ring draws a chord across the gap.
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
