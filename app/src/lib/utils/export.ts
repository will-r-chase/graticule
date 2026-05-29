import * as d3 from 'd3-geo';
import * as d3gp from 'd3-geo-projection';
import * as d3shape from 'd3-shape';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection } from 'geojson';
import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
import { projection as projectionStore } from '$lib/stores/projection.svelte';
import { background } from '$lib/stores/background.svelte';
import { mapState } from '$lib/stores/mapState.svelte';

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

export function exportPNG(clip: boolean, includeBackground: boolean): void {
	const svgString = buildSVGString({ clip, includeBackground });
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
	includeBackground: boolean;
}

function buildSVGString(options: SVGOptions): string | null {
	const { width, height, tx, ty, mapScale } = mapState;
	const bgColor = background.hex;
	if (!width || !height) return null;

	const combined = getCombinedGeoJSON();
	if (combined.features.length === 0) return null;

	const proj = buildProjection(width, height);
	const pathGenerator = d3.geoPath(proj);

	const parts: string[] = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden">`,
	];

	if (options.includeBackground) {
		parts.push(`  <rect width="${width}" height="${height}" fill="${bgColor}" />`);
	}

	if (options.clip) {
		parts.push(`  <g transform="translate(${tx},${ty}) scale(${mapScale})">`);
	}

	// When clip is active there's an outer <g transform="scale(mapScale)"> wrapping
	// everything, so geometry paths are scaled automatically. For point symbols we
	// need to counteract that scale so they stay constant size in screen pixels.
	const pointCounterScale = options.clip ? 1 / mapScale : 1;

	for (const layer of layers) {
		if (!layer.visible || !layer.hasTopology) continue;
		const topo = workingTopologyData.get(layer.id);
		if (!topo) continue;
		const objectName = Object.keys(topo.objects)[0];
		const data = feature(topo, topo.objects[objectName]) as FeatureCollection;
		if (!data) continue;

		const { fill, fillOpacity, stroke, strokeOpacity, strokeWidth, strokeDashed, strokeDash, strokeGap } = layer.style;
		const effectiveStrokeWidth = options.clip ? strokeWidth / mapScale : strokeWidth;
		const dashAttr = strokeDashed ? ` stroke-dasharray="${strokeDash} ${strokeGap}"` : '';

		const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
		const hasPoints   = layer.geometryTypes.some((t) => t === 'Point' || t === 'MultiPoint');

		// ── Polygon / line geometry ────────────────────────────────────────────
		if (hasNonPoint) {
			const nonPointData: FeatureCollection = {
				...data,
				features: data.features.filter((f) => {
					const t = f?.geometry?.type;
					return t !== 'Point' && t !== 'MultiPoint';
				}),
			};
			const d = pathGenerator(nonPointData);
			if (d) {
				parts.push(
					`  <path d="${d}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${effectiveStrokeWidth}"${dashAttr} />`
				);
			}
		}

		// ── Point geometry — d3-shape symbols ─────────────────────────────────
		if (hasPoints) {
			const sym = shapeMap[layer.style.pointShape] ?? d3shape.symbolCircle;
			const area = Math.PI * layer.style.pointRadius * layer.style.pointRadius;
			const symD = d3shape.symbol(sym, area)();
			if (!symD) continue;

			for (const f of data.features) {
				const geom = f?.geometry as { type?: string; coordinates?: unknown } | null | undefined;
				if (!geom) continue;

				const coordsList: [number, number][] =
					geom.type === 'Point'
						? [geom.coordinates as [number, number]]
						: geom.type === 'MultiPoint'
							? (geom.coordinates as [number, number][])
							: [];

				for (const coord of coordsList) {
					const pt = proj(coord);
					if (!pt) continue;
					const [px, py] = pt;
					const transform = `translate(${px},${py})${pointCounterScale !== 1 ? ` scale(${pointCounterScale})` : ''}`;
					const strokeAttrs = stroke !== 'none'
						? ` stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"`
						: ` stroke="none"`;
					parts.push(
						`  <path d="${symD}" transform="${transform}" fill="${fill}" fill-opacity="${fillOpacity}"${strokeAttrs} />`
					);
				}
			}
		}
	}

	if (options.clip) parts.push(`  </g>`);
	parts.push('</svg>');
	return parts.join('\n');
}

export function exportSVG(includeBackground: boolean): void {
	const svgString = buildSVGString({ clip: false, includeBackground });
	if (!svgString) return;
	const blob = new Blob([svgString], { type: 'image/svg+xml' });
	triggerDownload(blob, 'map.svg');
}
