<script lang="ts">
	import * as d3 from 'd3-geo';
	import * as d3gp from 'd3-geo-projection';
	import { layers, layerData } from '$lib/stores/layers.svelte';
	import { PROJECTIONS } from '$lib/config';
	import Combobox from '$lib/components/ui/Combobox.svelte';

	// Merge core and extended projection namespaces so we can look up any
	// projection by its function name regardless of which package it comes from.
	const allProjections = { ...d3, ...d3gp } as Record<string, unknown>;

	let containerEl = $state<HTMLDivElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let width = $state(0);
	let height = $state(0);

	let selectedProjectionId = $state('geoMercator');

	let projection = $derived.by(() => {
		const fn = allProjections[selectedProjectionId] as (() => d3.GeoProjection) | undefined;
		if (!fn || !width || !height) return null;
		return fn().fitSize([width, height], { type: 'Sphere' });
	});

	// Plain Map — not reactive, so Svelte never re-runs path computation
	// as a side-effect of the paint loop reading from it.
	const pathCache = new Map<string, Path2D>();

	// Bumped whenever the cache gains new entries. The paint effect reads
	// this so it knows to repaint after a path is computed.
	let cacheVersion = $state(0);

	// The projection object the cache was built for. When this changes
	// we invalidate all entries and recompute from scratch.
	let cachedProjection: d3.GeoProjection | null = null;

	// Compute Path2D only for layers that don't have a cached entry yet.
	// Reads layer.hasData (a plain boolean in $state) as the reactive signal —
	// never the GeoJSON itself, which lives in the plain layerData Map and is
	// therefore invisible to Svelte's deep_read mechanism.
	$effect(() => {
		if (!projection) return;

		// Projection changed — all cached paths are now wrong.
		if (projection !== cachedProjection) {
			pathCache.clear();
			cachedProjection = projection;
		}

		let updated = false;

		for (const layer of layers) {
			const { id, hasData } = layer;
			if (!hasData || pathCache.has(id)) continue; // already cached, skip

			const data = layerData.get(id); // plain Map — no reactive tracking
			if (!data) continue;

			const svgPath = d3.geoPath(projection)(data as d3.GeoPermissibleObjects);
			if (svgPath) {
				pathCache.set(id, new Path2D(svgPath));
				updated = true;
			}
		}

		// Remove entries for layers that no longer exist.
		const activeIds = new Set(layers.map((l) => l.id));
		for (const id of pathCache.keys()) {
			if (!activeIds.has(id)) pathCache.delete(id);
		}

		if (updated) cacheVersion++;
	});

	// Observe container size and update width/height.
	$effect(() => {
		if (!containerEl) return;
		const observer = new ResizeObserver((entries) => {
			const rect = entries[0].contentRect;
			width = rect.width;
			height = rect.height;
		});
		observer.observe(containerEl);
		return () => observer.disconnect();
	});

	// Repaint the canvas whenever styles, visibility, layer order, or the
	// path cache changes. No geometry computation happens here — just
	// stamping pre-built Path2D objects onto the canvas with current styles.
	$effect(() => {
		void cacheVersion; // re-run whenever a new path is cached
		if (!canvasEl || !width || !height) return;

		const dpr = window.devicePixelRatio || 1;
		const bitmapW = Math.round(width * dpr);
		const bitmapH = Math.round(height * dpr);

		// Only reallocate the canvas bitmap when the size actually changes.
		// Assigning canvasEl.width/height — even to the same value — destroys
		// and recreates the entire pixel buffer, which is very expensive.
		if (canvasEl.width !== bitmapW || canvasEl.height !== bitmapH) {
			canvasEl.width = bitmapW;
			canvasEl.height = bitmapH;
			canvasEl.style.width = `${width}px`;
			canvasEl.style.height = `${height}px`;
		}

		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);

		for (const layer of layers) {
			if (!layer.visible) continue;

			// Don't read layer.data here — Svelte would deep_read the entire
			// GeoJSON tree to establish reactive tracking, which takes seconds
			// for large datasets. The pathCache check is sufficient: if there's
			// no cached path, the data hasn't loaded yet.
			const path2d = pathCache.get(layer.id);
			if (!path2d) continue;

			if (layer.style.fill !== 'none') {
				ctx.globalAlpha = layer.style.fillOpacity;
				ctx.fillStyle = layer.style.fill;
				ctx.fill(path2d);
			}

			ctx.globalAlpha = layer.style.strokeOpacity;
			ctx.strokeStyle = layer.style.stroke;
			ctx.lineWidth = layer.style.strokeWidth;
			ctx.stroke(path2d);

			// Reset alpha so layers don't bleed into each other.
			ctx.globalAlpha = 1;
		}
	});
</script>

<div class="map-canvas" bind:this={containerEl}>
	<div class="projection-selector">
		<Combobox options={PROJECTIONS} bind:value={selectedProjectionId} placeholder="Search projections…" />
	</div>

	<canvas bind:this={canvasEl}></canvas>
</div>

<style>
	.map-canvas {
		position: relative;
		flex: 1;
		height: 100%;
		background-color: var(--color-surface-secondary);
		overflow: hidden;
	}

	canvas {
		display: block;
	}

	.projection-selector {
		position: absolute;
		top: var(--space-m);
		right: var(--space-m);
		z-index: 10;
		width: 220px;
	}
</style>
