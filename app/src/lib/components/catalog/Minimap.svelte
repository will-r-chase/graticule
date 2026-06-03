<script lang="ts">
	import * as d3 from 'd3-geo';
	import { feature } from 'topojson-client';
	import type { Topology } from 'topojson-specification';
	import { onMount } from 'svelte';
	import { catalog } from '$lib/stores/catalog.svelte';
	import { mapView } from '$lib/stores/mapView.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { PROJECTIONS } from '$lib/config';

	// Internal coordinate space for the SVG. The element is width:100% in CSS
	// so the actual rendered size scales automatically via the viewBox.
	const VW = 240;
	const VH = 126;
	const MERC_MAX_LAT = 85.05;

	// Mercator projection fitted to the internal coordinate space. Fixed — never changes.
	const miniProj = d3.geoMercator().fitSize([VW, VH], { type: 'Sphere' });
	const miniPath = d3.geoPath(miniProj);

	// World outline path string — fetched once on mount.
	let worldPath = $state<string | null>(null);

	onMount(async () => {
		const dataset = catalog.datasets.find(
			(d) => d.tags.includes('countries') && d.name.includes('110m')
		);
		if (!dataset || !catalog.baseURL) return;
		try {
			const topo = await fetch(`${catalog.baseURL}/${dataset.filePath}`).then((r) =>
				r.json()
			) as Topology;
			const objectName = Object.keys(topo.objects)[0];
			const geo = feature(topo, topo.objects[objectName]);
			worldPath = miniPath(geo as d3.GeoPermissibleObjects) ?? null;
		} catch {
			// silently fail — minimap renders without land outlines
		}
	});

	const projEntry = $derived(PROJECTIONS.find((p) => p.id === projectionStore.id) ?? PROJECTIONS[0]);
	const isRotate = $derived(projEntry.interactionMode === 'rotate');

	function clampLat(lat: number): number {
		return Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, lat));
	}

	// Pan mode: single rect showing the clamped viewport extent.
	// MapCanvas clamps extent to [−180, 180] so no antimeridian split is needed.
	const viewportRect = $derived.by(() => {
		if (isRotate || !mapView.extent) return null;
		const [west, south, east, north] = mapView.extent;
		const tl = miniProj([west, clampLat(north)]);
		const br = miniProj([east, clampLat(south)]);
		if (!tl || !br) return null;
		const x  = Math.max(0, tl[0]);
		const y  = Math.max(0, tl[1]);
		const x2 = Math.min(VW, br[0]);
		const y2 = Math.min(VH, br[1]);
		if (x2 <= x || y2 <= y) return null;
		return { x, y, width: x2 - x, height: y2 - y };
	});

	// Globe mode: filled cap circle + dot at the rotation center.
	// The cap radius shrinks as you zoom in: at mapScale=1 you see the full
	// hemisphere (90°); at mapScale=2 you see a 30° cap, etc.
	const globeIndicator = $derived.by(() => {
		if (!isRotate) return null;
		const [λ, φ] = projectionStore.rotate;
		const centerLon = -λ;
		const centerLat = clampLat(-φ);
		const pt = miniProj([centerLon, centerLat]);
		if (!pt) return null;
		const visRadius = mapView.mapScale <= 1
			? 90
			: Math.asin(1 / mapView.mapScale) * (180 / Math.PI);
		const circle = d3.geoCircle().center([centerLon, centerLat]).radius(visRadius)();
		const circlePath = miniPath(circle as d3.GeoPermissibleObjects) ?? null;
		return { cx: pt[0], cy: pt[1], circlePath };
	});
</script>

<div class="minimap">
	<svg viewBox={`0 0 ${VW} ${VH}`} width="100%" aria-label="Map extent overview">
		<!-- Background -->
		<rect width={VW} height={VH} fill="var(--grey-50)" />

		<!-- World outline -->
		{#if worldPath}
			<path d={worldPath} fill="var(--color-border)" stroke="none" />
		{/if}

		<!-- Pan mode: viewport box -->
		{#if viewportRect}
			<rect
				x={viewportRect.x}
				y={viewportRect.y}
				width={viewportRect.width}
				height={viewportRect.height}
				fill="var(--grey-500)"
				fill-opacity="0.12"
				stroke="var(--grey-500)"
				stroke-width="1.5"
			/>
		{/if}

		<!-- Globe mode: visible hemisphere + center dot -->
		{#if globeIndicator}
			{#if globeIndicator.circlePath}
				<path
					d={globeIndicator.circlePath}
					fill="var(--grey-500)"
					fill-opacity="0.15"
					stroke="var(--grey-500)"
					stroke-width="1"
				/>
			{/if}
			<circle cx={globeIndicator.cx} cy={globeIndicator.cy} r="3" fill="var(--grey-500)" />
		{/if}
	</svg>
</div>

<style>
	.minimap {
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}
</style>
