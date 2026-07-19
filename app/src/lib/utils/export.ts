import * as d3 from 'd3-geo';
import * as d3gp from 'd3-geo-projection';
import * as d3shape from 'd3-shape';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection } from 'geojson';
import type { Layer } from '$lib/types';
import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
import { projection as projectionStore } from '$lib/stores/projection.svelte';
import { canvasStyles } from '$lib/stores/canvasStyles.svelte';
import { mapState } from '$lib/stores/mapState.svelte';
import { applyTextTransform, LABEL_ANCHOR_DIR, labelFontString, wrapLabelLines } from '$lib/utils/labels';
import { layoutGlyphsAlongPath, splitGraphemes, clampedPathCenter } from '$lib/utils/curvedText';

const allProjections = { ...d3, ...d3gp } as Record<string, unknown>;

// Mirrors the shapeMap in MapCanvas — maps style id → d3-shape SymbolType.
const shapeMap: Record<string, d3shape.SymbolType> = {
	symbolCircle:   d3shape.symbolCircle,
	symbolSquare:   d3shape.symbolSquare,
	symbolDiamond:  d3shape.symbolDiamond,
	symbolTriangle: d3shape.symbolTriangle,
	symbolCross:    d3shape.symbolCross,
	symbolStar:     d3shape.symbolStar,
	symbolWye:      d3shape.symbolWye,
};

function sanitizeId(str: string): string {
	return str.trim().replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^([^a-zA-Z_])/, '_$1');
}

function escapeXml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NAME_KEYS = ['name', 'NAME', 'Name', 'label', 'LABEL', 'Label'];

function getFeatureName(properties: Record<string, unknown> | null | undefined, fallbackIndex: number): string {
	if (properties) {
		for (const key of NAME_KEYS) {
			const val = properties[key];
			if (typeof val === 'string' && val.trim()) return sanitizeId(val);
			if (typeof val === 'number') return sanitizeId(String(val));
		}
	}
	return `feature_${fallbackIndex}`;
}

function getCombinedGeoJSON(): FeatureCollection {
	const features: Feature[] = [];
	for (const layer of layers) {
		if (!layer.visible || !layer.hasTopology) continue;
		const topo = workingTopologyData.get(layer.id);
		if (!topo) continue;
		const objectName = Object.keys(topo.objects)[0];
		const fc = feature(topo, topo.objects[objectName]) as FeatureCollection;
		if (fc?.features) features.push(...fc.features);
	}
	return { type: 'FeatureCollection', features };
}

function buildProjection(width: number, height: number): d3.GeoProjection {
	const fn = allProjections[projectionStore.id] as (() => d3.GeoProjection) | undefined;
	if (!fn) throw new Error(`Unknown projection: ${projectionStore.id}`);
	return fn().fitSize([width, height], { type: 'Sphere' });
}

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

// ── Label layers (docs/labels-plan.md, D11) ────────────────────────────────
// Emitted as real SVG text, mirroring the canvas renderer's math (paintLabel /
// setLabelContext in MapCanvas). Wrap widths and baseline offsets are measured
// on an offscreen 2D context so the export matches the app. Halos are stacked
// text copies (stroked under filled) rather than paint-order, for vector-editor
// compatibility. LineString (curved) labels arrive with the 5b/5c slices.

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
	if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
	return measureCtx;
}

function fmt(n: number): string {
	return String(Math.round(n * 1000) / 1000);
}

// Which half of a label the emitters produce, mirroring the canvas painter:
// 'both' interleaves halo+fill per feature (no blur); with blur the layer runs
// a 'halo' pass wrapped in one blur-filtered group — children composite before
// the filter applies, so overlapping halos merge instead of stacking their soft
// edges — then a 'fill' pass on top.
type LabelPass = 'both' | 'halo' | 'fill';

// left/center/right → how far along a width an alignment edge sits.
const ALIGN_FACTOR = { left: 0, center: 0.5, right: 1 } as const;

// Per-line x offsets for a multiline label, mirroring the canvas's
// lineAlignOffsets: the anchor places the block, textAlign aligns narrower
// lines within it. The ctx must carry the layer's font + letter spacing.
function lineAlignOffsets(ctx: CanvasRenderingContext2D | null, ls: Layer['labelStyle'], lines: string[]): number[] {
	if (!ctx || lines.length < 2) return lines.map(() => 0);
	const dir = LABEL_ANCHOR_DIR[ls.anchor];
	const anchorEdge = dir.x === -1 ? 'right' : dir.x === 1 ? 'left' : 'center';
	const shift = ALIGN_FACTOR[ls.textAlign] - ALIGN_FACTOR[anchorEdge];
	if (shift === 0) return lines.map(() => 0);
	const widths = lines.map((line) => ctx.measureText(line).width);
	const blockW = Math.max(...widths);
	return widths.map((w) => shift * (blockW - w));
}

// scale compensates for a wrapping zoom transform when the element can't carry
// its own counter-scale (the textPath variant); withSpacing is off for per-glyph
// output, where spacing is baked into the positions.
function labelTextAttrs(ls: Layer['labelStyle'], scale = 1, withSpacing = true): string {
	let s = ` font-family="${escapeXml(ls.fontFamily)}" font-size="${fmt(ls.fontSize * scale)}px"`;
	if (ls.fontWeight !== 400) s += ` font-weight="${ls.fontWeight}"`;
	if (ls.italic) s += ' font-style="italic"';
	if (withSpacing && ls.letterSpacing) s += ` letter-spacing="${fmt(ls.letterSpacing * scale)}px"`;
	return s;
}

// One curved label (D11): glyph layout runs in FINAL rendered pixels — the same
// space the canvas uses — then positions convert back to the local (pre-zoom-
// transform) frame for emission, mirroring paintCurvedLabel's inverse-scale trick.
function curvedLabelSVG(
	ls: Layer['labelStyle'],
	ctx: CanvasRenderingContext2D | null,
	text: string,
	coords: [number, number][],
	proj: d3.GeoProjection,
	options: SVGOptions,
	pathId: string,
	baselineShift: number,
	pathOffset: number,
	pass: LabelPass,
): string[] {
	if (!ctx) return [];
	const { tx, ty, mapScale } = mapState;
	const cs = options.clip ? 1 / mapScale : 1;
	const toFinal = (p: [number, number]): [number, number] =>
		options.clip ? [p[0] * mapScale + tx, p[1] * mapScale + ty] : p;
	const toLocal = (p: [number, number]): [number, number] =>
		options.clip ? [(p[0] - tx) / mapScale, (p[1] - ty) / mapScale] : p;

	const path: [number, number][] = [];
	for (const c of coords) {
		const pt = proj(c);
		if (pt) path.push(toFinal(pt as [number, number]));
	}
	if (path.length < 2) return [];

	// Measure with zero context letter spacing, like the canvas — spacing is the
	// layout's job. (The straight-label caller restores its own spacing after.)
	(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
	const single = text.split('\n').join(' ');
	const glyphs = splitGraphemes(single).map((glyph) => ({ glyph, width: ctx.measureText(glyph).width }));
	const { placements, baseline, anchor } = layoutGlyphsAlongPath(path, glyphs, ls.letterSpacing, ls.fontSize, pathOffset);
	if (placements.length === 0) return [];

	const out: string[] = [];
	// Split passes sit inside the layer-level opacity group; 'both' carries its
	// own per-feature opacity, as always.
	if (pass === 'both') out.push(`    <g opacity="${ls.colorOpacity}">`);

	if (options.curvedText === 'flat') {
		// One straight, fully editable text run: at the text's on-path center
		// (honors the D12 slide offset), rotated to the middle glyph's direction
		// (the baseline is already flipped to read left-to-right, so it's upright).
		const mid = toLocal(anchor);
		const deg = (placements[Math.floor(placements.length / 2)].angle * 180) / Math.PI;
		const transform =
			`translate(${fmt(mid[0])},${fmt(mid[1])})` +
			(cs !== 1 ? ` scale(${fmt(cs)})` : '') +
			(deg ? ` rotate(${fmt(deg)})` : '');
		const attrs = ` transform="${transform}" text-anchor="middle"${labelTextAttrs(ls)}`;
		const content = `<tspan x="0" y="${fmt(baselineShift)}">${escapeXml(single)}</tspan>`;
		if (pass !== 'fill' && ls.haloWidth > 0) {
			out.push(`      <text${attrs} fill="none" stroke="${ls.haloColor}" stroke-width="${fmt(ls.haloWidth * 2)}" stroke-linejoin="round">${content}</text>`);
		}
		if (pass !== 'halo') out.push(`      <text${attrs} fill="${ls.color}">${content}</text>`);
	} else if (options.curvedText === 'textpath') {
		const d = 'M' + baseline.map((p) => toLocal(p).map(fmt).join(',')).join('L');
		// The path def is shared by both passes' textPaths — emit it once (the
		// halo pass runs first when split).
		if (pass !== 'fill') out.push(`      <path id="${pathId}" d="${d}" fill="none" stroke="none" />`);
		const attrs = labelTextAttrs(ls, cs);
		// startOffset carries the D12 slide position, clamped the way the canvas
		// clamps (text ends stay on the path).
		let total = 0;
		for (let i = 1; i < baseline.length; i++) {
			total += Math.hypot(baseline[i][0] - baseline[i - 1][0], baseline[i][1] - baseline[i - 1][1]);
		}
		let advance = -ls.letterSpacing;
		for (const g of glyphs) advance += g.width + ls.letterSpacing;
		const centerPct = total > 0 ? (clampedPathCenter(pathOffset, total, advance) / total) * 100 : 50;
		// dy inside a textPath offsets perpendicular to the path — same job as the
		// canvas's middle baseline.
		const content =
			`<textPath href="#${pathId}" xlink:href="#${pathId}" startOffset="${fmt(centerPct)}%" text-anchor="middle">` +
			`<tspan dy="${fmt(baselineShift * cs)}">${escapeXml(single)}</tspan></textPath>`;
		if (pass !== 'fill' && ls.haloWidth > 0) {
			out.push(`      <text${attrs} fill="none" stroke="${ls.haloColor}" stroke-width="${fmt(ls.haloWidth * 2 * cs)}" stroke-linejoin="round">${content}</text>`);
		}
		if (pass !== 'halo') out.push(`      <text${attrs} fill="${ls.color}">${content}</text>`);
	} else {
		const attrs = labelTextAttrs(ls, 1, false);
		const glyphEl = (p: { glyph: string; x: number; y: number; angle: number }, paint: string): string => {
			const [lx, ly] = toLocal([p.x, p.y]);
			const deg = (p.angle * 180) / Math.PI;
			const transform =
				`translate(${fmt(lx)},${fmt(ly)})` +
				(cs !== 1 ? ` scale(${fmt(cs)})` : '') +
				(deg ? ` rotate(${fmt(deg)})` : '');
			return `      <text transform="${transform}" text-anchor="middle"${attrs} ${paint}><tspan y="${fmt(baselineShift)}">${escapeXml(p.glyph)}</tspan></text>`;
		};
		const visible = placements.filter((p) => p.glyph.trim() !== '');
		// All halos under all fills, mirroring the canvas's two passes.
		if (pass !== 'fill' && ls.haloWidth > 0) {
			for (const p of visible) {
				out.push(glyphEl(p, `fill="none" stroke="${ls.haloColor}" stroke-width="${fmt(ls.haloWidth * 2)}" stroke-linejoin="round"`));
			}
		}
		if (pass !== 'halo') {
			for (const p of visible) out.push(glyphEl(p, `fill="${ls.color}"`));
		}
	}

	if (pass === 'both') out.push('    </g>');
	return out;
}

function buildLabelLayerSVG(
	layer: Layer,
	data: FeatureCollection,
	proj: d3.GeoProjection,
	options: SVGOptions,
): string[] {
	const attr = layer.labelAttribute;
	if (!attr) return [];
	const ls = layer.labelStyle;
	const ctx = getMeasureCtx();
	if (ctx) {
		ctx.font = labelFontString(ls);
		(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${ls.letterSpacing}px`;
	}

	// Canvas draws with a middle baseline; SVG text sits on the alphabetic one.
	// Measure the difference (fallback: the classic 0.35em approximation) instead
	// of using dominant-baseline, which vector editors handle inconsistently.
	let baselineShift = ls.fontSize * 0.35;
	if (ctx) {
		const m = ctx.measureText('x');
		if (m.fontBoundingBoxAscent !== undefined && m.fontBoundingBoxDescent !== undefined) {
			baselineShift = (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
		}
	}

	const dir = LABEL_ANCHOR_DIR[ls.anchor];
	const anchorAttr = dir.x === -1 ? 'end' : dir.x === 1 ? 'start' : 'middle';
	const gap = dir.x === 0 && dir.y === 0 ? 0 : ls.fontSize * 0.3 + ls.haloWidth;
	const lineH = ls.fontSize * ls.lineHeight;
	const counterScale = options.clip ? 1 / mapState.mapScale : 1;

	const runPass = (pass: LabelPass): string[] => {
		const out: string[] = [];
		for (let fi = 0; fi < data.features.length; fi++) {
			const f = data.features[fi];
			const geom = f?.geometry as { type?: string; coordinates?: unknown } | null;
			const props = f.properties as Record<string, unknown> | null;
			const raw = props?.[attr];
			if (raw === null || raw === undefined || raw === '') continue;
			if (geom?.type === 'LineString') {
				const rawOffset = props?.__pathOffset;
				out.push(...curvedLabelSVG(
					ls, ctx,
					applyTextTransform(String(raw), ls.textTransform),
					geom.coordinates as [number, number][],
					proj, options,
					`label_${sanitizeId(layer.id)}_${fi}`,
					baselineShift,
					typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? rawOffset : 0.5,
					pass,
				));
				// curvedLabelSVG measures with zero spacing; put ours back for wraps.
				if (ctx) (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${ls.letterSpacing}px`;
				continue;
			}
			if (!geom || geom.type !== 'Point') continue;
			const pt = proj(geom.coordinates as [number, number]);
			if (!pt) continue;
			const rot = typeof props?.__rotation === 'number' && Number.isFinite(props.__rotation) ? props.__rotation : 0;
			const wrapW = typeof props?.__wrapWidth === 'number' && Number.isFinite(props.__wrapWidth) ? props.__wrapWidth : null;
			const transformed = applyTextTransform(String(raw), ls.textTransform);
			const lines = wrapW !== null && ctx ? wrapLabelLines(ctx, transformed, wrapW) : transformed.split('\n');

			// Same placement math as paintLabel: coordinates in the label's local
			// (unscaled, unrotated) frame, middle baselines throughout.
			const x = dir.x * gap;
			const y0 =
				dir.y === 0 ? -((lines.length - 1) / 2) * lineH
				: dir.y === -1 ? -gap - ls.fontSize / 2 - (lines.length - 1) * lineH
				: gap + ls.fontSize / 2;

			const dx = lineAlignOffsets(ctx, ls, lines);
			const tspans = lines
				.map((line, i) => `<tspan x="${fmt(x + dx[i])}" y="${fmt(y0 + i * lineH + baselineShift)}">${escapeXml(line)}</tspan>`)
				.join('');
			const transform =
				`translate(${fmt(pt[0])},${fmt(pt[1])})` +
				(counterScale !== 1 ? ` scale(${fmt(counterScale)})` : '') +
				(rot ? ` rotate(${fmt(rot)})` : '');
			const common = `text-anchor="${anchorAttr}"${labelTextAttrs(ls)}`;
			out.push(pass === 'both'
				? `    <g transform="${transform}" opacity="${ls.colorOpacity}">`
				: `    <g transform="${transform}">`);
			if (pass !== 'fill' && ls.haloWidth > 0) {
				out.push(`      <text ${common} fill="none" stroke="${ls.haloColor}" stroke-width="${fmt(ls.haloWidth * 2)}" stroke-linejoin="round">${tspans}</text>`);
			}
			if (pass !== 'halo') out.push(`      <text ${common} fill="${ls.color}">${tspans}</text>`);
			out.push('    </g>');
		}
		return out;
	};

	// Plain opaque halo: one interleaved pass, structured exactly as before.
	// Blurred and/or translucent halos: all halo elements go in one group that
	// carries the blur filter and/or the halo opacity — children composite
	// crisp and opaque first, so the effect hits the union once (matching the
	// canvas buffer) — then fills on top, colorOpacity hoisted to the layer
	// level. The filter's deviation lives in the layer group's user space,
	// which under clip carries the zoom scale — the same counter-scale the
	// stroke-widths use.
	if (!(ls.haloWidth > 0 && (ls.haloBlur > 0 || ls.haloOpacity < 1))) return runPass('both');

	const out: string[] = [];
	let haloGroupAttrs = '';
	if (ls.haloBlur > 0) {
		const blurId = `haloblur_${sanitizeId(layer.id)}`;
		out.push(
			`    <filter id="${blurId}" x="-50%" y="-50%" width="200%" height="200%">` +
			`<feGaussianBlur stdDeviation="${fmt(ls.haloBlur * counterScale)}" /></filter>`
		);
		haloGroupAttrs += ` filter="url(#${blurId})"`;
	}
	if (ls.haloOpacity < 1) haloGroupAttrs += ` opacity="${fmt(ls.haloOpacity)}"`;
	out.push(
		`    <g opacity="${ls.colorOpacity}">`,
		`    <g${haloGroupAttrs}>`,
		...runPass('halo'),
		'    </g>',
		...runPass('fill'),
		'    </g>',
	);
	return out;
}

export function exportPNG(clip: boolean): void {
	const svgString = buildSVGString({ clip, curvedText: 'glyphs' });
	if (!svgString) return;

	const { width, height } = mapState;
	const offscreen = document.createElement('canvas');
	offscreen.width = width;
	offscreen.height = height;
	const ctx = offscreen.getContext('2d');
	if (!ctx) return;

	const img = new Image();
	const blob = new Blob([svgString], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);
	img.onload = () => {
		ctx.drawImage(img, 0, 0);
		URL.revokeObjectURL(url);
		offscreen.toBlob((pngBlob) => {
			if (!pngBlob) return;
			triggerDownload(pngBlob, 'map.png');
		});
	};
	img.src = url;
}

interface SVGOptions {
	clip: boolean;
	// How curved labels serialize (D11): 'glyphs' = per-glyph rotated <text>,
	// pixel-faithful to the canvas; 'textpath' = <textPath> over the smoothed
	// baseline, editable type-on-path in Illustrator/Inkscape (Figma's importer
	// drops textPath); 'flat' = one straight editable <text> per label at the
	// curve's midpoint, rotated to the overall direction — the curve is discarded
	// but every tool including Figma can retype it. PNG always uses 'glyphs'
	// (it rasterizes, so fidelity is all that matters).
	curvedText: 'glyphs' | 'textpath' | 'flat';
}

function buildSVGString(options: SVGOptions): string | null {
	const { width, height, tx, ty, mapScale } = mapState;
	if (!width || !height) return null;

	const combined = getCombinedGeoJSON();
	if (combined.features.length === 0) return null;

	const proj = buildProjection(width, height);
	const pathGenerator = d3.geoPath(proj);

	const parts: string[] = [
		// xmlns:xlink for the textPath href fallback older vector editors expect.
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden">`,
	];

	// Background rect — included only when the user has it enabled in the Canvas panel.
	if (canvasStyles.background.enabled) {
		parts.push(`  <rect width="${width}" height="${height}" fill="${canvasStyles.background.hex}" fill-opacity="${canvasStyles.background.alpha}" />`);
	}

	if (options.clip) {
		parts.push(`  <g transform="translate(${tx},${ty}) scale(${mapScale})">`);
	}

	// When clip is active there's an outer <g transform="scale(mapScale)"> wrapping
	// everything, so geometry paths are scaled automatically. For point symbols we
	// need to counteract that scale so they stay constant size in screen pixels.
	const pointCounterScale = options.clip ? 1 / mapScale : 1;

	for (const layer of [...layers].reverse()) {
		if (!layer.visible || !layer.hasTopology) continue;
		const topo = workingTopologyData.get(layer.id);
		if (!topo) continue;
		const objectName = Object.keys(topo.objects)[0];
		const data = feature(topo, topo.objects[objectName]) as FeatureCollection;
		if (!data) continue;

		// Label layers export as text, never as geometry (D11).
		if (layer.kind === 'label') {
			parts.push(`  <g id="${sanitizeId(layer.name)}">`);
			parts.push(...buildLabelLayerSVG(layer, data, proj, options));
			parts.push(`  </g>`);
			continue;
		}

		const { fill, fillOpacity, stroke, strokeOpacity, strokeWidth, strokeDashed, strokeDash, strokeGap } = layer.style;
		const effectiveStrokeWidth = options.clip ? strokeWidth / mapScale : strokeWidth;
		const dashAttr = strokeDashed ? ` stroke-dasharray="${strokeDash} ${strokeGap}"` : '';

		const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
		const hasPoints   = layer.geometryTypes.some((t) => t === 'Point' || t === 'MultiPoint');

		parts.push(`  <g id="${sanitizeId(layer.name)}">`);

		// ── Polygon / line geometry — one path per feature ────────────────────
		if (hasNonPoint) {
			const nonPointFeatures = data.features.filter((f) => {
				const t = f?.geometry?.type;
				return t !== 'Point' && t !== 'MultiPoint';
			});
			for (let i = 0; i < nonPointFeatures.length; i++) {
				const f = nonPointFeatures[i];
				const d = pathGenerator(f);
				if (!d) continue;
				const featureId = getFeatureName(f.properties as Record<string, unknown> | null, i);
				parts.push(
					`    <path id="${featureId}" d="${d}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${effectiveStrokeWidth}"${dashAttr} />`
				);
			}
		}

		// ── Point geometry — d3-shape symbols, one path per feature ──────────
		if (hasPoints) {
			const sym = shapeMap[layer.style.pointShape] ?? d3shape.symbolCircle;
			const area = Math.PI * layer.style.pointRadius * layer.style.pointRadius;
			const symD = d3shape.symbol(sym, area)();
			if (symD) {
				const pointFeatures = data.features.filter((f) => {
					const t = f?.geometry?.type;
					return t === 'Point' || t === 'MultiPoint';
				});
				for (let i = 0; i < pointFeatures.length; i++) {
					const f = pointFeatures[i];
					const geom = f?.geometry as { type?: string; coordinates?: unknown } | null | undefined;
					if (!geom) continue;

					const coordsList: [number, number][] =
						geom.type === 'Point'
							? [geom.coordinates as [number, number]]
							: geom.type === 'MultiPoint'
								? (geom.coordinates as [number, number][])
								: [];

					const featureId = getFeatureName(f.properties as Record<string, unknown> | null, i);
					for (const coord of coordsList) {
						const pt = proj(coord);
						if (!pt) continue;
						const [px, py] = pt;
						const transform = `translate(${px},${py})${pointCounterScale !== 1 ? ` scale(${pointCounterScale})` : ''}`;
						const strokeAttrs = stroke !== 'none'
							? ` stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"`
							: ` stroke="none"`;
						parts.push(
							`    <path id="${featureId}" d="${symD}" transform="${transform}" fill="${fill}" fill-opacity="${fillOpacity}"${strokeAttrs} />`
						);
					}
				}
			}
		}

		parts.push(`  </g>`);
	}

	if (options.clip) parts.push(`  </g>`);
	parts.push('</svg>');
	return parts.join('\n');
}

export function exportSVG(clip: boolean, curvedText: SVGOptions['curvedText'] = 'glyphs'): void {
	const svgString = buildSVGString({ clip, curvedText });
	if (!svgString) return;
	const blob = new Blob([svgString], { type: 'image/svg+xml' });
	triggerDownload(blob, 'map.svg');
}
