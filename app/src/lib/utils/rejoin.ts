import * as d3 from 'd3-geo';
import type { BezierArc, BezierSegment, PathRecorder } from './bezier';

/**
 * Generic D3-style ring rejoin for bezier-smoothed polygon rings that cross a
 * clip boundary (antimeridian or hemisphere circle). Ported from the ideas in
 * d3-geo's clipRejoin:
 *
 * 1. Walk the ring's arcs, collecting visible bezier runs and boundary
 *    crossing nodes (exit/entry pairs with a boundary parameter t). For
 *    hemisphere clips this includes seam crossings synthesized from
 *    trimmed/empty arcs — see collectRing.
 * 2. Sort all nodes by t. The boundary stretches between consecutive sorted
 *    nodes alternate between ring-interior and ring-exterior; a single
 *    containment bit fixes the parity. The bit comes from probing the stretch
 *    farthest from every crossing (midpoint of the largest t-gap) with a
 *    spherical point-in-ring test — see the parity section in rejoinRing.
 *    Interior stretches are the portions of the boundary the clip cut the
 *    ring along, i.e. the seams to seal.
 * 3. Emit sub-polygons by alternating walks: from an entry node, follow ring
 *    runs to the structurally-next exit, then trace the exit's interior
 *    boundary stretch to the entry at its far end; repeat until the walk
 *    closes. A sub-polygon may alternate ring/boundary several times (e.g. a
 *    U-shaped ring cut twice by the boundary).
 *
 * Handles any number of crossings (no N≤2 gate), including odd counts —
 * pole-enclosing rings legitimately cross the antimeridian an odd number of
 * times. Rings with NO crossings are handled too: they may enclose the whole
 * clip region (emit the boundary circle), enclose the excluded cap (emit ring
 * + boundary circle, d3's "cleanInside" case), or simply not interact with
 * the boundary (plain closed ring).
 *
 * See docs/bezier-pipeline.md for the full picture of the pipeline, the
 * artifact cases each piece addresses, and the offline verification harness.
 */

// A clip boundary: parameterises crossing points along the boundary loop,
// traces between two parameters, and answers the containment question.
export interface RejoinBoundary {
	// Boundary parameter of a crossing node, in [tMin, tMax). Must increase
	// monotonically around the boundary loop.
	t(brk: RingBreak, isEntry: boolean): number;
	tMin: number;
	tMax: number;
	// Emit lineTo samples strictly between fromT and toT. When throughWrap is
	// false the sweep is monotonic (either direction); when true it passes
	// through the tMax/tMin wrap. Exact endpoints are the caller's job.
	trace(fromT: number, toT: number, throughWrap: boolean, recorder: PathRecorder): void;
	// Geographic point on the boundary at parameter t, nudged slightly inside
	// the clip region. Used as the containment probe that decides stretch parity.
	pointAt(t: number): [number, number] | null;
	// Does the ring (geographic coordinates, degrees) contain the boundary
	// itself? Only consulted for rings with no crossings — where the whole
	// boundary lies on one side of the ring, so probing any boundary point
	// answers for all of them. True means the boundary circle is part of the
	// ring's clipped outline (see the N === 0 branch of rejoinRing).
	ringContainsRef(ringGeo: [number, number][]): boolean;
	// Emits the entire boundary as a closed loop. Used for crossing-free rings
	// that contain the boundary: alone when the ring is invisible (it encloses
	// the whole clip region), together with the ring itself when visible (it
	// encloses the excluded cap and renders "inside-out" under evenodd).
	fullBoundary?(recorder: PathRecorder): void;
}

export interface RingBreak {
	exitX: number; exitY: number;
	entryX: number; entryY: number;
	crossLat: number;   // antimeridian only; 0 otherwise
	exitSide: number;   // antimeridian only; 0 otherwise
}

interface SegCmd { cp1x: number; cp1y: number; cp2x: number; cp2y: number; ex: number; ey: number }
interface RingSeg { startX: number; startY: number; cmds: SegCmd[] }

// Collects the ring's visible bezier runs (segs) and boundary crossings
// (breaks) by walking the arc list, honouring the ~idx reversal convention.
// Structure: run i ends at break i's exit; run i+1 starts at break i's entry;
// the final run wraps into run 0 via the ring closure.
//
// For hemisphere boundaries it also SYNTHESIZES seam breaks the per-arc split
// machinery cannot see: when an arc's trimmed end meets the next arc's trimmed
// start (possibly across entirely-clipped arcs), the ring left and re-entered
// the clip region at that arc seam. A wrap seam (ring end ↔ ring start) is
// appended without an extra run — the walk's modulo indexing maps its entry
// (segIdx N ≡ 0) onto run 0 naturally.
function collectRing(
	arcIndices: number[],
	bezierArcs: BezierArc[],
	breakType: BezierSegment['breakType']
): { segs: RingSeg[]; ringBreaks: RingBreak[]; anyVisible: boolean } {
	const segs: RingSeg[] = [];
	const ringBreaks: RingBreak[] = [];
	let curStartX = 0, curStartY = 0, curCmds: SegCmd[] = [];
	let anyVisible = false, gapPending = false, prevEndTrimmed = false, firstStartTrimmed = false;
	let firstX = 0, firstY = 0, lastX = 0, lastY = 0;
	const seams = breakType === 'hemisphere';

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
		if (!arc) continue;
		if (arc.segs.length === 0) {
			if (anyVisible) gapPending = true; else firstStartTrimmed = true;
			continue;
		}
		const startTrim = reversed ? !!arc.trimmedEnd : !!arc.trimmedStart;
		const endTrim   = reversed ? !!arc.trimmedStart : !!arc.trimmedEnd;
		const aFirstX = reversed ? arc.segs[arc.segs.length - 1].ex : arc.sx;
		const aFirstY = reversed ? arc.segs[arc.segs.length - 1].ey : arc.sy;

		if (!anyVisible) {
			anyVisible = true;
			firstX = aFirstX; firstY = aFirstY;
			firstStartTrimmed = firstStartTrimmed || startTrim;
			curStartX = aFirstX; curStartY = aFirstY;
		} else if (seams && (gapPending || prevEndTrimmed || startTrim)) {
			flushSeg({ exitX: lastX, exitY: lastY, entryX: aFirstX, entryY: aFirstY, crossLat: 0, exitSide: 0 });
		}
		gapPending = false;
		prevEndTrimmed = endTrim;
		lastX = reversed ? arc.sx : arc.segs[arc.segs.length - 1].ex;
		lastY = reversed ? arc.sy : arc.segs[arc.segs.length - 1].ey;

		if (reversed) {
			for (let i = arc.segs.length - 1; i >= 0; i--) {
				const seg = arc.segs[i];
				const toX = i === 0 ? arc.sx : arc.segs[i - 1].ex;
				const toY = i === 0 ? arc.sy : arc.segs[i - 1].ey;
				if (seg.isBreak && seg.breakType === breakType) {
					// Reversed traversal: forward exit ↔ reversed entry, and vice-versa.
					flushSeg({
						exitX: seg.ex, exitY: seg.ey,
						entryX: seg.exitX!, entryY: seg.exitY!,
						crossLat: seg.crossLat ?? 0,
						exitSide: -(seg.exitSide ?? 0),
					});
				} else if (!seg.isBreak) {
					curCmds.push({ cp1x: seg.cp2x, cp1y: seg.cp2y, cp2x: seg.cp1x, cp2y: seg.cp1y, ex: toX, ey: toY });
				}
			}
		} else {
			for (const seg of arc.segs) {
				if (seg.isBreak && seg.breakType === breakType) {
					flushSeg({
						exitX: seg.exitX!, exitY: seg.exitY!,
						entryX: seg.ex, entryY: seg.ey,
						crossLat: seg.crossLat ?? 0,
						exitSide: seg.exitSide ?? 0,
					});
				} else if (!seg.isBreak) {
					curCmds.push({ cp1x: seg.cp1x, cp1y: seg.cp1y, cp2x: seg.cp2x, cp2y: seg.cp2y, ex: seg.ex, ey: seg.ey });
				}
			}
		}
	}
	// Last run has no following break — the ring closes back into segs[0].
	segs.push({ startX: curStartX, startY: curStartY, cmds: curCmds });

	// Wrap seam: ring end and ring start are separated by the clip region.
	if (seams && anyVisible && (gapPending || prevEndTrimmed || firstStartTrimmed)) {
		ringBreaks.push({ exitX: lastX, exitY: lastY, entryX: firstX, entryY: firstY, crossLat: 0, exitSide: 0 });
	}

	return { segs, ringBreaks, anyVisible };
}

// Assembles a ring's geographic coordinates from geoArcs, honouring reversal.
// Used only for the containment test.
export function ringGeoCoords(arcIndices: number[], geoArcs: [number, number][][]): [number, number][] {
	const ring: [number, number][] = [];
	for (const idx of arcIndices) {
		const reversed = idx < 0;
		const geo = geoArcs[reversed ? ~idx : idx];
		if (!geo || geo.length === 0) continue;
		if (reversed) {
			for (let i = geo.length - 1; i >= 0; i--) ring.push(geo[i]);
		} else {
			for (const pt of geo) ring.push(pt);
		}
	}
	if (ring.length > 0) {
		const first = ring[0], last = ring[ring.length - 1];
		if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
	}
	// Winding normalization: hole rings are wound opposite to exteriors, and
	// d3's spherical containment interprets an opposite-wound ring as the
	// complement of the sphere (it "contains" nearly everything). Under
	// per-ring evenodd rendering the small-patch interpretation is always the
	// correct one, so reverse any ring d3 measures as covering more than a
	// hemisphere.
	if (ring.length >= 4 && d3.geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI) ring.reverse();
	return ring;
}

/**
 * Reconstructs properly-closed sub-polygons for one ring against one boundary.
 * See module docs for the algorithm.
 */
export function rejoinRing(
	arcIndices: number[],
	bezierArcs: BezierArc[],
	geoArcs: [number, number][][],
	recorder: PathRecorder,
	boundary: RejoinBoundary,
	breakType: BezierSegment['breakType']
): void {
	const { segs, ringBreaks, anyVisible } = collectRing(arcIndices, bezierArcs, breakType);
	const N = ringBreaks.length;
	const ringGeo = ringGeoCoords(arcIndices, geoArcs);

	if (N === 0) {
		// A crossing-free ring lies entirely on one side of the boundary. If it
		// CONTAINS the boundary (with no crossings, the whole boundary is on one
		// side of the ring), the boundary circle is part of the ring's clipped
		// outline: alone for an invisible ring enclosing the clip region, in
		// addition to the ring itself for a visible ring enclosing the excluded
		// cap (d3's cleanInside rule).
		const containsBoundary = boundary.fullBoundary ? boundary.ringContainsRef(ringGeo) : false;
		if (anyVisible) {
			recorder.moveTo(segs[0].startX, segs[0].startY);
			for (const sg of segs) for (const c of sg.cmds) recorder.bezierCurveTo(c.cp1x, c.cp1y, c.cp2x, c.cp2y, c.ex, c.ey);
			recorder.closePath();
			if (containsBoundary && boundary.fullBoundary) boundary.fullBoundary(recorder);
		} else if (containsBoundary && boundary.fullBoundary) {
			boundary.fullBoundary(recorder);
		}
		return;
	}

	interface BNode {
		t: number;
		isEntry: boolean;
		breakIdx: number;         // which RingBreak this node belongs to
		segIdx: number;           // run that ends (exit) / starts (entry) here
		projX: number; projY: number;
		partner: BNode | null;    // far end of this node's interior boundary stretch
		partnerThroughWrap: boolean;
		visited: boolean;
	}
	const nodes: BNode[] = [];
	for (let i = 0; i < N; i++) {
		const b = ringBreaks[i];
		nodes.push({ t: boundary.t(b, false), isEntry: false, breakIdx: i, segIdx: i, projX: b.exitX, projY: b.exitY, partner: null, partnerThroughWrap: false, visited: false });
		nodes.push({ t: boundary.t(b, true), isEntry: true, breakIdx: i, segIdx: i + 1, projX: b.entryX, projY: b.entryY, partner: null, partnerThroughWrap: false, visited: false });
	}
	const sorted = [...nodes].sort((a, b) => a.t - b.t);
	const M = sorted.length;

	// Exit/entry must alternate along the boundary (interior/exterior stretches
	// alternate). Numerical noise in near-tied crossing parameters can swap two
	// near-coincident nodes and violate this — repair by swapping adjacent
	// near-tied pairs when doing so restores alternation.
	for (let i = 1; i < M; i++) {
		if (sorted[i].isEntry === sorted[i - 1].isEntry && i + 1 < M &&
			Math.abs(sorted[i + 1].t - sorted[i].t) < 0.02 &&
			sorted[i + 1].isEntry !== sorted[i].isEntry) {
			const tmp = sorted[i]; sorted[i] = sorted[i + 1]; sorted[i + 1] = tmp;
		}
	}

	// Interior/exterior stretches alternate along the boundary; a single
	// containment bit fixes the parity. Probe the stretch farthest from every
	// crossing (midpoint of the largest gap in t) — a fixed reference at the
	// t-wrap is fragile when a ring's crossings cluster around the wrap, as
	// they do for rings hugging the boundary there.
	let gi = M - 1, bestGap = sorted[0].t + 2 * Math.PI - sorted[M - 1].t;
	for (let i = 0; i + 1 < M; i++) {
		const gap = sorted[i + 1].t - sorted[i].t;
		if (gap > bestGap) { bestGap = gap; gi = i; }
	}
	let tProbe = sorted[gi].t + bestGap / 2;
	if (tProbe > Math.PI) tProbe -= 2 * Math.PI;
	const probeGeo = boundary.pointAt(tProbe);
	const probeInside = probeGeo && ringGeo.length >= 4
		? d3.geoContains({ type: 'Polygon', coordinates: [ringGeo] }, probeGeo)
		: false;
	// The stretch starting at sorted[gi] is interior iff the probe is inside.
	const offset = ((probeInside ? gi : gi + 1) % 2 + 2) % 2;
	for (let m = 0; m < M; m += 2) {
		const ai = (m + offset) % M;
		const bi = (m + offset + 1) % M;
		const a = sorted[ai], b = sorted[bi];
		const throughWrap = bi < ai; // only possible for the last stretch when offset=1
		a.partner = b; a.partnerThroughWrap = throughWrap;
		b.partner = a; b.partnerThroughWrap = throughWrap;
	}

	// Structural ring successor: the run starting at entry(i) ends at the exit
	// of break (i+1 mod N) — possibly via the wrap through the closure run.
	const exitOfBreak: BNode[] = [];
	for (const n of nodes) if (!n.isEntry) exitOfBreak[n.breakIdx] = n;

	// segs.length is N+1 for internal breaks only; when a wrap seam was appended
	// it equals N — the modulo indexing below handles both shapes.
	const totalSegs = segs.length;

	// Walks ring runs from an entry node to an exit node, emitting bezier
	// commands. Bridges run boundaries (only the closure wrap) with a snap
	// lineTo to the next run's exact start.
	const walkRing = (from: BNode, to: BNode) => {
		let si = from.segIdx;
		let steps = 0;
		while (true) {
			const seg = segs[si % totalSegs];
			if (steps > 0) recorder.lineTo(seg.startX, seg.startY);
			for (const cmd of seg.cmds) recorder.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.ex, cmd.ey);
			if (si % totalSegs === to.segIdx % totalSegs) break;
			si++;
			if (++steps > totalSegs) break; // safety guard against malformed data
		}
	};

	// Emit sub-polygons: start at each unvisited entry, alternate ring walks
	// and boundary traces until the walk returns to the start.
	for (const start of nodes) {
		if (start.isEntry === false || start.visited) continue;
		recorder.moveTo(start.projX, start.projY);
		let cur = start;
		let guard = 0;
		do {
			cur.visited = true;
			const exit = exitOfBreak[(cur.breakIdx + 1) % N];
			walkRing(cur, exit);
			recorder.lineTo(exit.projX, exit.projY); // snap to exact boundary exit
			exit.visited = true;
			const next = exit.partner;
			if (!next || !next.isEntry) break; // malformed pairing — bail without closing
			boundary.trace(exit.t, next.t, exit.partnerThroughWrap, recorder);
			recorder.lineTo(next.projX, next.projY); // snap to exact boundary entry
			cur = next;
		} while (cur !== start && ++guard <= N);
		recorder.closePath();
	}
}

// ---------------------------------------------------------------------------
// Antimeridian boundary
// ---------------------------------------------------------------------------

// Parameterisation of the antimeridian boundary loop (matches antimeridianT in
// bezier.ts so sorting behaviour is unchanged):
//   left  side (-1): t ascends from −π at −90° to 0 at +90°
//   right side (+1): t descends from 0 at +90° to π at −90°
// The NORTH pole sits at t=0 and the SOUTH pole at the ±π wrap — which is also
// where the containment reference point lives (D3's clipAntimeridian start
// point is [-180°, -90°]).
function antimeridianT(side: number, latDeg: number): number {
	const latRad = latDeg * Math.PI / 180;
	return side < 0 ? latRad - Math.PI / 2 : Math.PI / 2 - latRad;
}

// Converts a boundary parameter back to (side, latitude in degrees).
function antimeridianFromT(t: number): { side: number; latDeg: number } {
	return t < 0
		? { side: -1, latDeg: (t + Math.PI / 2) * 180 / Math.PI }
		: { side: 1, latDeg: (Math.PI / 2 - t) * 180 / Math.PI };
}

/**
 * Builds a RejoinBoundary for the antimeridian of a rotated projection.
 * Tracing samples the antimeridian in the rotated frame and projects each
 * sample — points may fall off-canvas (the canvas clips natively); only
 * non-finite projections are skipped.
 */
export function makeAntimeridianBoundary(proj: d3.GeoProjection): RejoinBoundary {
	const EPS = 0.01;      // stay just inside ±180° to avoid boundary instability
	const STEP_RAD = 0.1 * Math.PI / 180; // boundary-parameter step per sample (≈0.1° latitude)
	const rot = typeof proj.rotate === 'function' ? proj.rotate() : ([0, 0, 0] as [number, number, number]);
	const rotFn = d3.geoRotation(rot);

	// Reference point for ringContainsRef (N=0 rings only — in practice nearly
	// unreachable for the antimeridian, since any ring containing it crosses it):
	// the south pole in the rotated frame, mapped back to geographic coordinates
	// so containment runs on the ring's original coords (spherical containment
	// is rotation-invariant). Nudged off the exact pole and seam for stability.
	const refGeo = rotFn.invert([-180 + EPS, -90 + EPS] as [number, number]) as [number, number];

	// Monotonic sweep from t0 to t1 (either direction), endpoints exclusive.
	const sweepMono = (t0: number, t1: number, recorder: PathRecorder) => {
		const total = t1 - t0;
		const steps = Math.floor(Math.abs(total) / STEP_RAD);
		for (let i = 1; i <= steps; i++) {
			const { side, latDeg } = antimeridianFromT(t0 + (total * i) / (steps + 1));
			const lon = side > 0 ? 180 - EPS : -180 + EPS;
			const geo = rotFn.invert([lon, latDeg] as [number, number]);
			if (!geo) continue;
			const pt = proj(geo as [number, number]);
			if (!pt || !isFinite(pt[0]) || !isFinite(pt[1])) continue;
			recorder.lineTo(pt[0], pt[1]);
		}
	};

	// On many projections a pole is not a point but an arc (e.g. the top rim of
	// a conic wedge). When a trace passes a pole it must sweep longitude at
	// constant pole latitude from one side of the antimeridian to the other —
	// this draws the rim on conics and degenerates to a single point elsewhere.
	// (D3 does the same in clipAntimeridianInterpolate via its three points at
	// pole latitude, relying on resampling to fill the rim in.)
	const TINY = 1e-6;
	const polarArc = (pole: number, fromSide: number, toSide: number, recorder: PathRecorder) => {
		const lat = pole > 0 ? 90 - TINY : -90 + TINY;
		const lonFrom = fromSide * (180 - EPS);
		const lonTo = toSide * (180 - EPS);
		const steps = Math.max(2, Math.ceil(Math.abs(lonTo - lonFrom) / 2)); // ~2° lon per sample
		for (let i = 0; i <= steps; i++) {
			const lon = lonFrom + ((lonTo - lonFrom) * i) / steps;
			const geo = rotFn.invert([lon, lat] as [number, number]);
			if (!geo) continue;
			const pt = proj(geo as [number, number]);
			if (pt && isFinite(pt[0]) && isFinite(pt[1])) recorder.lineTo(pt[0], pt[1]);
		}
	};

	// Monotonic sweep that inserts the north-pole arc when passing t=0.
	const sweepSmart = (t0: number, t1: number, recorder: PathRecorder) => {
		if (t0 === t1) return;
		const crossesPole = (t0 < 0 && t1 > 0) || (t0 > 0 && t1 < 0);
		if (crossesPole) {
			sweepMono(t0, 0, recorder);
			polarArc(1, t0 < 0 ? -1 : 1, t1 > 0 ? 1 : -1, recorder);
			sweepMono(0, t1, recorder);
		} else {
			sweepMono(t0, t1, recorder);
		}
	};

	return {
		tMin: -Math.PI,
		tMax: Math.PI,
		t(brk, isEntry) {
			// The entry lies on the opposite side of the exit at the same latitude.
			const side = isEntry ? -brk.exitSide : brk.exitSide;
			return antimeridianT(side, brk.crossLat);
		},
		trace(fromT, toT, throughWrap, recorder) {
			if (!throughWrap) {
				sweepSmart(fromT, toT, recorder);
			} else if (fromT >= toT) {
				// Increasing through the wrap — via the south pole's arc.
				sweepSmart(fromT, Math.PI, recorder);
				polarArc(-1, 1, -1, recorder);
				sweepSmart(-Math.PI, toT, recorder);
			} else {
				// Decreasing through the wrap.
				sweepSmart(fromT, -Math.PI, recorder);
				polarArc(-1, -1, 1, recorder);
				sweepSmart(Math.PI, toT, recorder);
			}
		},
		pointAt(t) {
			const { side, latDeg } = antimeridianFromT(t);
			return rotFn.invert([side * (180 - 0.5), latDeg] as [number, number]) as [number, number] | null;
		},
		ringContainsRef(ringGeo) {
			if (ringGeo.length < 4) return false;
			return d3.geoContains({ type: 'Polygon', coordinates: [ringGeo] }, refGeo);
		},
	};
}

// ---------------------------------------------------------------------------
// Hemisphere (horizon-circle) boundary
// ---------------------------------------------------------------------------

/**
 * Builds a RejoinBoundary for the horizon circle of a projection with a
 * small-circle preclip (orthographic, gnomonic, stereographic, azimuthal —
 * the azimuthal family, for which the projected horizon is a screen circle).
 * t = screen angle about the circle centre.
 *
 * Note: pointAt assumes gamma rotation is 0 (screen angle ↔ spherical bearing
 * mapping); mappy's rotations are [lambda, phi, 0].
 */
export function makeHemisphereBoundary(proj: d3.GeoProjection, clipAngle: number): RejoinBoundary {
	const rot = typeof proj.rotate === 'function' ? proj.rotate() : ([0, 0, 0] as [number, number, number]);
	const rotFn = d3.geoRotation(rot);
	const centerPt = proj(rotFn.invert([0, 0] as [number, number]) as [number, number]) as [number, number];
	const edgePt = proj(rotFn.invert([-(clipAngle - 1e-3), 0] as [number, number]) as [number, number]) as [number, number];
	const cx = centerPt[0], cy = centerPt[1];
	const R = Math.hypot(edgePt[0] - cx, edgePt[1] - cy);
	const STEP = 2 * Math.PI / 360; // ~1° of arc per sample

	const sweep = (a0: number, a1: number, recorder: PathRecorder) => {
		const total = a1 - a0;
		const steps = Math.floor(Math.abs(total) / STEP);
		for (let i = 1; i <= steps; i++) {
			const a = a0 + (total * i) / (steps + 1);
			recorder.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
		}
	};

	return {
		tMin: -Math.PI,
		tMax: Math.PI,
		t(brk, isEntry) {
			const x = isEntry ? brk.entryX : brk.exitX;
			const y = isEntry ? brk.entryY : brk.exitY;
			return Math.atan2(y - cy, x - cx);
		},
		trace(fromT, toT, throughWrap, recorder) {
			if (!throughWrap) sweep(fromT, toT, recorder);
			else if (fromT >= toT) { sweep(fromT, Math.PI, recorder); sweep(-Math.PI, toT, recorder); }
			else { sweep(fromT, -Math.PI, recorder); sweep(Math.PI, toT, recorder); }
		},
		pointAt(t) {
			// Spherical point at screen angle t on the horizon, nudged 0.5° into
			// the cap. Screen angle → bearing: β = t + π/2 (y-down canvas, north
			// up, gamma=0). Rotated coords from bearing/distance, then unrotate.
			const beta = t + Math.PI / 2;
			const d = (clipAngle - 0.5) * Math.PI / 180;
			const lat = Math.asin(Math.sin(d) * Math.cos(beta)) * 180 / Math.PI;
			const lon = Math.atan2(Math.sin(beta) * Math.sin(d), Math.cos(d)) * 180 / Math.PI;
			return rotFn.invert([lon, lat] as [number, number]) as [number, number] | null;
		},
		ringContainsRef(ringGeo) {
			// N=0 only: does the ring contain the boundary circle? With no
			// crossings the whole boundary is on one side of the ring, so any
			// boundary point answers for all of them. Majority-of-3 well-separated
			// probes guards against one landing on the ring's edge.
			if (ringGeo.length < 4) return false;
			const poly = { type: 'Polygon' as const, coordinates: [ringGeo] };
			let votes = 0;
			for (const t of [0, 2 * Math.PI / 3, -2 * Math.PI / 3]) {
				const p = this.pointAt(t);
				if (p && d3.geoContains(poly, p)) votes++;
			}
			return votes >= 2;
		},
		fullBoundary(recorder) {
			recorder.moveTo(cx + R, cy);
			for (let a = 1; a <= 360; a++) {
				const r = (a * Math.PI) / 180;
				recorder.lineTo(cx + R * Math.cos(r), cy + R * Math.sin(r));
			}
			recorder.closePath();
		},
	};
}
