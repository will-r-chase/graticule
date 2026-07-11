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
	fontSize: number
): CurvedLayout {
	let pts = dedupe(path);
	if (pts.length < 2 || glyphs.length === 0) return { placements: [], baseline: [] };
	if (pts[pts.length - 1][0] < pts[0][0]) pts.reverse();

	const step = fontSize / 2;
	pts = dedupe(smoothPath(resamplePath(pts, step), Math.round((fontSize * 1.5) / step)));
	if (pts.length < 2) return { placements: [], baseline: [] };

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

	const out: GlyphPlacement[] = [];
	let s = total / 2 - advance / 2;
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
	return { placements: out, baseline: pts };
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
