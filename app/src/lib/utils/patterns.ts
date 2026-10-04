import textures from 'textures';
import { select } from 'd3-selection';

// Pattern fills for polygons, built on the `textures` library. Textures emits SVG
// <pattern> elements; we render one into a detached <svg>, then wrap its contents as a
// standalone tile SVG. The same tile string feeds the canvas (as an Image → CanvasPattern)
// and, later, SVG export.

export type FillPatternType = 'lines' | 'circles' | 'paths';

export interface FillPattern {
	type: FillPatternType;
	// Tile size in px.
	size: number;
	// Stroke width for lines/paths, radius for circles.
	weight: number;
	// lines: 'vertical' | 'horizontal' | 'diagonal'; paths: a named shape ('squares', 'waves', ...).
	// Ignored for circles.
	variant: string;
}

export const defaultFillPattern: FillPattern = { type: 'lines', size: 8, weight: 1, variant: 'diagonal' };

const SVG_NS = 'http://www.w3.org/2000/svg';

// The tile's pixel size and inner SVG markup (Textures output) for a spec in a given color.
function patternParts(spec: FillPattern, color: string): { w: string; h: string; inner: string } {
	let t;
	if (spec.type === 'circles') {
		t = textures.circles().size(spec.size).radius(spec.weight).fill(color).strokeWidth(0);
	} else if (spec.type === 'paths') {
		t = textures.paths().d(spec.variant).size(spec.size).strokeWidth(spec.weight).stroke(color);
	} else {
		t = textures.lines().orientation(spec.variant).size(spec.size).strokeWidth(spec.weight).stroke(color);
	}

	const svg = document.createElementNS(SVG_NS, 'svg');
	select(svg).call(t);
	const pattern = svg.querySelector('pattern');
	return {
		w: pattern?.getAttribute('width') ?? String(spec.size),
		h: pattern?.getAttribute('height') ?? String(spec.size),
		inner: pattern?.innerHTML ?? '',
	};
}

// Standalone <svg> markup for one tile of the pattern in the given color. `scale` enlarges
// the rendered pixel size (viewBox unchanged) so canvas tiles stay sharp on hi-dpi screens.
export function buildPatternTileSvg(spec: FillPattern, color: string, scale = 1): string {
	const { w, h, inner } = patternParts(spec, color);
	return `<svg xmlns="${SVG_NS}" width="${Number(w) * scale}" height="${Number(h) * scale}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}

// A <pattern> element for embedding in an exported SVG's <defs>; fill with `url(#id)`.
// `transform` (optional) is applied as patternTransform, e.g. to cancel an outer zoom.
export function buildPatternDef(spec: FillPattern, color: string, id: string, transform?: string): string {
	const { w, h, inner } = patternParts(spec, color);
	const tf = transform ? ` patternTransform="${transform}"` : '';
	return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${w}" height="${h}"${tf}>${inner}</pattern>`;
}

// Canvas patterns are built from an async-decoded Image, so the first lookup returns null
// and `onReady` fires once the pattern is cached (the caller repaints then). The tile image
// is rendered at `scale` (device pixel ratio) × its CSS size; the caller sets the pattern's
// transform to 1 / (scale × map zoom) so the tile stays a fixed size on screen.
const cache = new Map<string, CanvasPattern>();
const pending = new Set<string>();

export function getFillPattern(
	spec: FillPattern,
	color: string,
	ctx: CanvasRenderingContext2D,
	scale = 1,
	onReady?: () => void,
): CanvasPattern | null {
	const key = `${spec.type}|${spec.size}|${spec.weight}|${spec.variant}|${color}|${scale}`;
	const hit = cache.get(key);
	if (hit) return hit;
	if (pending.has(key)) return null;

	pending.add(key);
	const img = new Image();
	img.onload = () => {
		pending.delete(key);
		const pattern = ctx.createPattern(img, 'repeat');
		if (pattern) {
			cache.set(key, pattern);
			onReady?.();
		}
	};
	img.onerror = () => pending.delete(key);
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildPatternTileSvg(spec, color, scale))}`;
	return null;
}

// ---- Picker support ---------------------------------------------------------------------

// Per-type starting tile size / weight, used when the user switches pattern type.
const typeDefaults: Record<FillPatternType, { size: number; weight: number }> = {
	lines: { size: 8, weight: 1 },
	circles: { size: 10, weight: 2 },
	paths: { size: 14, weight: 1 },
};

// Picker options. Ids encode type + variant as "type:variant" ('none' = solid fill) so a
// single string-valued dropdown can carry both.
export const patternOptions: { id: string; label: string; group?: string }[] = [
	{ id: 'none', label: 'None' },
	{ id: 'lines:diagonal', label: 'Diagonal', group: 'Lines' },
	{ id: 'lines:vertical', label: 'Vertical', group: 'Lines' },
	{ id: 'lines:horizontal', label: 'Horizontal', group: 'Lines' },
	{ id: 'circles:', label: 'Dots', group: 'Dots' },
	...['squares', 'crosses', 'waves', 'woven', 'nylon', 'caps', 'hexagons'].map((v) => ({
		id: `paths:${v}`,
		label: v[0].toUpperCase() + v.slice(1),
		group: 'Shapes',
	})),
];

export function patternId(spec: FillPattern | null): string {
	return spec ? `${spec.type}:${spec.type === 'circles' ? '' : spec.variant}` : 'none';
}

// The spec for a picked option id. Switching within a type keeps the current size/weight;
// switching type resets them to that type's defaults.
export function specFromPatternId(id: string, prev: FillPattern | null): FillPattern | null {
	if (id === 'none') return null;
	const [type, variant] = id.split(':') as [FillPatternType, string];
	const keep = prev && prev.type === type ? { size: prev.size, weight: prev.weight } : typeDefaults[type];
	return { type, variant, ...keep };
}
