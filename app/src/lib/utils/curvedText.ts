// Pure screen-space glyph layout for curved labels (docs/labels-plan.md, D3/D9):
// measured glyph widths in, per-glyph placements out. All coordinates are screen
// pixels — layout only makes sense after projection and zoom are applied, since
// font size is zoom-independent. No canvas or store imports; MapCanvas measures
// and paints, step-5 SVG export can reuse the same placements.

export interface MeasuredGlyph {
	glyph: string;
	width: number;
}

export interface GlyphPlacement {
	glyph: string;
	x: number; // glyph center, screen px
	y: number;
	angle: number; // secant direction across the glyph, radians
}

export interface CurvedLayout {
	placements: GlyphPlacement[]; // one per input glyph, same order
	baseline: [number, number][]; // the smoothed path the text follows, screen px
	anchor: [number, number]; // the text's on-path center (D12)
	anchorAngle: number; // path tangent at the anchor, radians — offsets the slide handle
}

// Splits text into user-perceived characters (grapheme clusters) so emoji and
// combining marks travel as one glyph. Array.from is the pre-Segmenter fallback
// (splits by code point).
export function splitGraphemes(text: string): string[] {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		return Array.from(
			new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
			(s) => s.segment
		);
	}
	return Array.from(text);
}

// Places glyphs along a polyline: text centered on the path's arc-length midpoint
// with letterSpacing added between glyphs (D9). The walk reverses when the path
// runs net right-to-left on screen so text reads upright. Glyphs whose distance
// falls before the start or past the end continue straight along the end tangents
// (D9 overflow). Returns [] for degenerate paths.
//
// The text follows a smoothed copy of the path, not the raw one: line data is
// much higher-frequency than a glyph is wide, so raw tangents make adjacent
// letters tumble at unrelated angles — and re-roll on every zoom tick, since
// zooming changes which micro-segment each glyph lands on. Smoothing at the
// scale of the text (fontSize is constant in screen px, so the window is too)
// keeps the label on the line's general sweep and calm across zoom. The cost:
// on a tight meander the baseline cuts the corner by a few px.
export function layoutGlyphsAlongPath(
	path: [number, number][],
	glyphs: MeasuredGlyph[],
	letterSpacing: number,
	fontSize: number,
	offset = 0.5 // text center as a fraction of arc length, reading direction (D12)
): CurvedLayout {
	const empty: CurvedLayout = { placements: [], baseline: [], anchor: [0, 0], anchorAngle: 0 };
	let pts = dedupe(path);
	if (pts.length < 2 || glyphs.length === 0) return empty;
	if (pts[pts.length - 1][0] < pts[0][0]) pts.reverse();

	const step = fontSize / 2;
	pts = dedupe(smoothPath(resamplePath(pts, step), Math.round((fontSize * 1.5) / step)));
	if (pts.length < 2) return empty;

	// Cumulative arc length at each vertex.
	const cum = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	}
	const total = cum[cum.length - 1];

	let advance = -letterSpacing;
	for (const g of glyphs) advance += g.width + letterSpacing;

	// Point at distance d from the start. The segment index clamps to the path but
	// t deliberately uses the unclamped distance: past the ends it runs t < 0 or
	// t > 1 on the end segment, which *is* the straight-tangent extrapolation.
	const pointAt = (d: number): [number, number] => {
		const clamped = Math.min(Math.max(d, 0), total);
		let lo = 0;
		let hi = cum.length - 2;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (cum[mid] <= clamped) lo = mid;
			else hi = mid - 1;
		}
		const t = (d - cum[lo]) / (cum[lo + 1] - cum[lo]);
		return [
			pts[lo][0] + (pts[lo + 1][0] - pts[lo][0]) * t,
			pts[lo][1] + (pts[lo + 1][1] - pts[lo][1]) * t,
		];
	};

	const center = clampedPathCenter(offset, total, advance);
	const out: GlyphPlacement[] = [];
	let s = center - advance / 2;
	for (const g of glyphs) {
		const center = s + g.width / 2;
		// Angle from the secant across the glyph's own width (min 1px so thin
		// glyphs don't degenerate) — damps whatever jitter survives smoothing.
		const half = Math.max(g.width / 2, 1);
		const p = pointAt(center);
		const a = pointAt(center - half);
		const b = pointAt(center + half);
		out.push({ glyph: g.glyph, x: p[0], y: p[1], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });
		s += g.width + letterSpacing;
	}
	const ca = pointAt(center - 1);
	const cb = pointAt(center + 1);
	return {
		placements: out,
		baseline: pts,
		anchor: pointAt(center),
		anchorAngle: Math.atan2(cb[1] - ca[1], cb[0] - ca[0]),
	};
}

// The clamped text-center distance for a path offset (D12): the text's ends stay
// on the path, so the usable range shrinks as the text grows; text longer than
// the whole path pins to the middle (D9 overflow splits evenly). Clamping happens
// at render time — zoom changes text-vs-path proportions, so a stored fraction
// can need re-clamping every frame.
export function clampedPathCenter(offset: number, total: number, advance: number): number {
	if (advance >= total) return total / 2;
	return Math.min(Math.max(offset * total, advance / 2), total - advance / 2);
}

// Arc-length fraction of the polyline point nearest to a screen point — how a
// slide-handle drag turns a cursor position into a path offset. Assumes the
// (short) baselines this serves; a plain per-segment scan.
export function nearestPathFraction(path: [number, number][], p: [number, number]): number {
	let best = Infinity;
	let bestDist = 0;
	let walked = 0;
	let total = 0;
	for (let i = 1; i < path.length; i++) {
		const ax = path[i - 1][0];
		const ay = path[i - 1][1];
		const dx = path[i][0] - ax;
		const dy = path[i][1] - ay;
		const len = Math.hypot(dx, dy);
		if (len > 0) {
			const t = Math.min(Math.max(((p[0] - ax) * dx + (p[1] - ay) * dy) / (len * len), 0), 1);
			const qx = ax + dx * t;
			const qy = ay + dy * t;
			const d = Math.hypot(p[0] - qx, p[1] - qy);
			if (d < best) {
				best = d;
				bestDist = walked + len * t;
			}
			walked += len;
		}
		total = walked;
	}
	return total > 0 ? bestDist / total : 0.5;
}

// Uniform arc-length resample so the box filter below has a predictable window
// regardless of source vertex density. Keeps both endpoints.
function resamplePath(pts: [number, number][], step: number): [number, number][] {
	const out: [number, number][] = [pts[0]];
	let need = step;
	for (let i = 1; i < pts.length; i++) {
		let ax = pts[i - 1][0];
		let ay = pts[i - 1][1];
		const bx = pts[i][0];
		const by = pts[i][1];
		let len = Math.hypot(bx - ax, by - ay);
		while (len >= need) {
			const t = need / len;
			ax += (bx - ax) * t;
			ay += (by - ay) * t;
			out.push([ax, ay]);
			len -= need;
			need = step;
		}
		need -= len;
	}
	const last = pts[pts.length - 1];
	const tail = out[out.length - 1];
	if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
	return out;
}

// Two box-filter passes (≈ triangular kernel) with half-width k points. The
// window shrinks symmetrically near the ends, so endpoints stay anchored and
// the overflow extrapolation still leaves from the true line ends.
function smoothPath(pts: [number, number][], k: number): [number, number][] {
	if (k <= 0 || pts.length < 3) return pts;
	let cur = pts;
	for (let pass = 0; pass < 2; pass++) {
		const next: [number, number][] = [];
		for (let i = 0; i < cur.length; i++) {
			const r = Math.min(k, i, cur.length - 1 - i);
			let sx = 0;
			let sy = 0;
			for (let j = i - r; j <= i + r; j++) {
				sx += cur[j][0];
				sy += cur[j][1];
			}
			next.push([sx / (2 * r + 1), sy / (2 * r + 1)]);
		}
		cur = next;
	}
	return cur;
}

// --- Cubic bezier text paths (docs/labels-plan.md, D10) ------------------------
// The EDITING representation of a curved label's path: two anchors + two tangent
// handles. Pure math over whatever space the caller works in (the editor fits and
// evaluates in screen px; the session stores control points in lon/lat).

export interface CubicBezier {
	p0: [number, number]; // start anchor
	p1: [number, number]; // start handle
	p2: [number, number]; // end handle
	p3: [number, number]; // end anchor
}

// Evaluates the cubic at n uniform t-steps → an (n+1)-point polyline. Uniform t is
// fine here: layoutGlyphsAlongPath re-parameterizes by arc length anyway.
export function sampleCubic(c: CubicBezier, n: number): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const s = 1 - t;
		const b0 = s * s * s;
		const b1 = 3 * t * s * s;
		const b2 = 3 * t * t * s;
		const b3 = t * t * t;
		out.push([
			b0 * c.p0[0] + b1 * c.p1[0] + b2 * c.p2[0] + b3 * c.p3[0],
			b0 * c.p0[1] + b1 * c.p1[1] + b2 * c.p2[1] + b3 * c.p3[1],
		]);
	}
	return out;
}

// Fits a display cubic to a polyline: anchors pinned to the ends, tangent
// directions from a short window at each end (3% of arc length), handle LENGTHS
// solved by least squares against chord-length-parameterized points (Schneider's
// method with fixed anchors/tangents). Expects a reasonably smooth polyline —
// feed it the render baseline, not raw river data. The fit is a starting shape
// for hand-sculpting, not a faithful reproduction (~2-4% max deviation on
// arcs/S-curves). Returns null for degenerate input.
export function fitCubicToPolyline(path: [number, number][]): CubicBezier | null {
	const pts = dedupe(path);
	if (pts.length < 2) return null;
	const p0 = pts[0];
	const p3 = pts[pts.length - 1];

	const cum = [0];
	for (let i = 1; i < pts.length; i++) {
		cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	}
	const total = cum[cum.length - 1];
	if (total === 0) return null;

	const t0 = unitTowards(pts, cum, total * 0.03, true);
	const t3 = unitTowards(pts, cum, total * 0.03, false);
	const fallback = (): CubicBezier => ({
		p0,
		p1: [p0[0] + (t0[0] * total) / 3, p0[1] + (t0[1] * total) / 3],
		p2: [p3[0] + (t3[0] * total) / 3, p3[1] + (t3[1] * total) / 3],
		p3,
	});
	if (pts.length === 2) return fallback();

	// Least squares over the interior points for the two handle lengths α0, α1:
	// curve(u) = p0·B0 + (p0+α0·t0)·B1 + (p3+α1·t3)·B2 + p3·B3, u = chord param.
	let c00 = 0;
	let c01 = 0;
	let c11 = 0;
	let x0 = 0;
	let x1 = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const u = cum[i] / total;
		const s = 1 - u;
		const b0 = s * s * s;
		const b1 = 3 * u * s * s;
		const b2 = 3 * u * u * s;
		const b3 = u * u * u;
		const a0: [number, number] = [t0[0] * b1, t0[1] * b1];
		const a1: [number, number] = [t3[0] * b2, t3[1] * b2];
		const rx = pts[i][0] - (b0 + b1) * p0[0] - (b2 + b3) * p3[0];
		const ry = pts[i][1] - (b0 + b1) * p0[1] - (b2 + b3) * p3[1];
		c00 += a0[0] * a0[0] + a0[1] * a0[1];
		c01 += a0[0] * a1[0] + a0[1] * a1[1];
		c11 += a1[0] * a1[0] + a1[1] * a1[1];
		x0 += a0[0] * rx + a0[1] * ry;
		x1 += a1[0] * rx + a1[1] * ry;
	}
	const det = c00 * c11 - c01 * c01;
	if (Math.abs(det) < 1e-12) return fallback();
	const alpha0 = (x0 * c11 - x1 * c01) / det;
	const alpha1 = (c00 * x1 - c01 * x0) / det;
	// Non-positive or wild handle lengths mean the solve degenerated (near-straight
	// or self-crossing data) — the ⅓-length heuristic is more trustworthy.
	if (alpha0 <= 0 || alpha1 <= 0 || alpha0 > total * 2 || alpha1 > total * 2) return fallback();
	return {
		p0,
		p1: [p0[0] + t0[0] * alpha0, p0[1] + t0[1] * alpha0],
		p2: [p3[0] + t3[0] * alpha1, p3[1] + t3[1] * alpha1],
		p3,
	};
}

// Unit vector pointing INTO the path from one end: from the first point towards
// the point at arc distance d (fromStart), or from the last point backwards.
function unitTowards(
	pts: [number, number][],
	cum: number[],
	d: number,
	fromStart: boolean
): [number, number] {
	const total = cum[cum.length - 1];
	const target = fromStart ? Math.min(d, total) : Math.max(total - d, 0);
	let i = 0;
	while (i < cum.length - 2 && cum[i + 1] < target) i++;
	const t = (target - cum[i]) / (cum[i + 1] - cum[i] || 1);
	const px = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
	const py = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
	const end = fromStart ? pts[0] : pts[pts.length - 1];
	const dx = px - end[0];
	const dy = py - end[1];
	const len = Math.hypot(dx, dy) || 1;
	return [dx / len, dy / len];
}

// Consecutive duplicate points would make zero-length segments (and NaN tangents);
// also copies, so the caller's array survives the flip-reverse.
function dedupe(path: [number, number][]): [number, number][] {
	const out: [number, number][] = [];
	for (const p of path) {
		const last = out[out.length - 1];
		if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
	}
	return out;
}
