// Pure helpers for deriving label layers (docs/labels-plan.md, D2): one anchor point
// per source feature plus a best-guess text attribute. No store imports — plain data
// in, plain data out. All math runs on lon/lat coordinates; good enough for anchor
// placement (labels get repositioned by hand in text edit mode anyway).
import type { Topology } from 'topojson-specification';
import type { Feature, Geometry, Position } from 'geojson';
import type { LabelAnchor as LabelAnchorPosition, LabelStyle, LabelTextTransform } from '$lib/types';
import { feature } from 'topojson-client';
import polylabel from 'polylabel';

export interface LabelGeometry {
	geometry:
		| { type: 'Point'; coordinates: [number, number] }
		| { type: 'LineString'; coordinates: [number, number][] };
	properties: Record<string, unknown>;
}

// One label geometry per feature across all objects in the topology: an anchor
// point for point/polygon sources, a copied line for line sources (curved
// placement, D9). Features whose geometry yields nothing (null/empty) are skipped.
export function computeLabelGeometries(topo: Topology): LabelGeometry[] {
	const out: LabelGeometry[] = [];
	for (const key of Object.keys(topo.objects)) {
		const result = feature(topo, topo.objects[key]);
		const features: Feature[] = result.type === 'FeatureCollection' ? result.features : [result];
		for (const f of features) {
			if (!f.geometry) continue;
			const geometry = labelGeometryFor(f.geometry);
			if (!geometry) continue;
			out.push({ geometry, properties: { ...(f.properties ?? {}) } });
		}
	}
	return out;
}

// Best-guess which property supplies the label text: prefer name-like keys, then
// label/title, then any key that holds a non-empty string in at least one feature.
export function guessLabelAttribute(propsList: Record<string, unknown>[]): string | null {
	const stringKeys: string[] = [];
	const seen = new Set<string>();
	for (const props of propsList) {
		for (const [k, v] of Object.entries(props)) {
			if (!seen.has(k) && typeof v === 'string' && v.trim() !== '') {
				seen.add(k);
				stringKeys.push(k);
			}
		}
	}
	return (
		stringKeys.find((k) => /name/i.test(k)) ??
		stringKeys.find((k) => /label|title/i.test(k)) ??
		stringKeys[0] ??
		null
	);
}

function labelGeometryFor(geom: Geometry): LabelGeometry['geometry'] | null {
	switch (geom.type) {
		case 'Point':
			return point(geom.coordinates[0], geom.coordinates[1]);
		case 'MultiPoint':
			return geom.coordinates.length > 0 ? point(geom.coordinates[0][0], geom.coordinates[0][1]) : null;
		case 'LineString':
			return line(geom.coordinates);
		case 'MultiLineString': {
			// Longest part by arc length — labels the main channel, not a side branch.
			const longest = maxBy(geom.coordinates, lineLength);
			return longest ? line(longest) : null;
		}
		case 'Polygon': {
			const p = poleOfInaccessibility(geom.coordinates);
			return p ? point(p[0], p[1]) : null;
		}
		case 'MultiPolygon': {
			// Largest part by outer-ring area — labels the mainland, not an islet.
			const largest = maxBy(geom.coordinates, (poly) => Math.abs(ringArea(poly[0] ?? [])));
			const p = largest ? poleOfInaccessibility(largest) : null;
			return p ? point(p[0], p[1]) : null;
		}
		case 'GeometryCollection': {
			for (const g of geom.geometries) {
				const result = labelGeometryFor(g);
				if (result) return result;
			}
			return null;
		}
	}
}

function point(x: number, y: number): LabelGeometry['geometry'] {
	return { type: 'Point', coordinates: [x, y] };
}

function line(coords: Position[]): LabelGeometry['geometry'] | null {
	if (coords.length < 2) return null;
	return { type: 'LineString', coordinates: coords.map((c) => [c[0], c[1]]) };
}

function poleOfInaccessibility(rings: Position[][]): [number, number] | null {
	const outer = rings[0];
	if (!outer || outer.length === 0) return null;
	// polylabel's precision is in coordinate units — scale it to the polygon so small
	// features don't pay for a full search and large ones aren't placed coarsely.
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const [x, y] of outer) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	const precision = Math.max(maxX - minX, maxY - minY) / 200 || 0.01;
	const p = polylabel(rings as Array<Array<[number, number]>>, precision);
	return [p[0], p[1]];
}

function lineLength(coords: Position[]): number {
	let total = 0;
	for (let i = 1; i < coords.length; i++) total += segLength(coords[i - 1], coords[i]);
	return total;
}

function segLength(a: Position, b: Position): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function ringArea(ring: Position[]): number {
	// Shoelace formula — planar, sign indicates winding; callers take Math.abs.
	let sum = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
	}
	return sum / 2;
}

// --- Rendering helpers (pure; used by MapCanvas and later SVG export) ------

export function applyTextTransform(text: string, transform: LabelTextTransform): string {
	switch (transform) {
		case 'uppercase':
			return text.toUpperCase();
		case 'lowercase':
			return text.toLowerCase();
		case 'sentence':
			return text.length > 0 ? text[0].toUpperCase() + text.slice(1).toLowerCase() : text;
		case 'capitalize':
			// CSS text-transform:capitalize semantics — uppercase each word's first
			// letter, leave the rest of the word as written.
			return text.replace(/(^|\s)(\S)/g, (_, ws: string, ch: string) => ws + ch.toUpperCase());
		default:
			return text;
	}
}

// Which side of the anchor point the text block sits on: -1 = before (left/above),
// +1 = after (right/below), 0 = centered on that axis.
export const LABEL_ANCHOR_DIR: Record<LabelAnchorPosition, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
	center: { x: 0, y: 0 },
	top: { x: 0, y: -1 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	'top-left': { x: -1, y: -1 },
	'top-right': { x: 1, y: -1 },
	'bottom-left': { x: -1, y: 1 },
	'bottom-right': { x: 1, y: 1 },
};

// Greedy word-wrap against measured widths. Manual \n breaks are preserved; each
// resulting paragraph wraps to maxWidth. Expects ctx.font already set (widths are
// measured in the same units the label paints at).
export function wrapLabelLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const out: string[] = [];
	for (const paragraph of text.split('\n')) {
		const words = paragraph.split(' ');
		let line = '';
		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(candidate).width > maxWidth) {
				out.push(line);
				line = word;
			} else {
				line = candidate;
			}
		}
		out.push(line);
	}
	return out;
}

// CSS font shorthand for a LabelStyle. Quotes the family when it needs it
// (spaces, no comma-separated fallback list).
export function labelFontString(style: LabelStyle): string {
	const family =
		style.fontFamily.includes(' ') && !style.fontFamily.includes(',') && !style.fontFamily.includes('"')
			? `"${style.fontFamily}"`
			: style.fontFamily;
	return `${style.italic ? 'italic ' : ''}${style.fontWeight === 'bold' ? 'bold ' : ''}${style.fontSize}px ${family}`;
}

function maxBy<T>(items: T[], measure: (item: T) => number): T | null {
	let best: T | null = null;
	let bestValue = -Infinity;
	for (const item of items) {
		const value = measure(item);
		if (value > bestValue) {
			bestValue = value;
			best = item;
		}
	}
	return best;
}
