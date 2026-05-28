<script lang="ts">
	import * as d3 from 'd3-geo';
	import * as d3shape from 'd3-shape';
	import * as d3gp from 'd3-geo-projection';
	import { feature } from 'topojson-client';
	import { buildBezierArcs, buildTopoPath } from '$lib/utils/bezier';
	import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { mapState } from '$lib/stores/mapState.svelte';
	import { background } from '$lib/stores/background.svelte';
	import { PROJECTIONS } from '$lib/config';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import BackgroundControl from '$lib/components/map/BackgroundControl.svelte';
	import { MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut } from 'phosphor-svelte';

	// Merge core and extended projection namespaces so we can look up any
	// projection by its function name regardless of which package it comes from.
	const allProjections = { ...d3, ...d3gp } as Record<string, unknown>;

	// Map from shape id string to d3-shape SymbolType
	const shapeMap: Record<string, d3shape.SymbolType> = {
		symbolCircle:   d3shape.symbolCircle,
		symbolSquare:   d3shape.symbolSquare,
		symbolDiamond:  d3shape.symbolDiamond,
		symbolTriangle: d3shape.symbolTriangle,
		symbolCross:    d3shape.symbolCross,
		symbolStar:     d3shape.symbolStar,
		symbolWye:      d3shape.symbolWye,
	};

	let containerEl = $state<HTMLDivElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	$effect(() => {
		mapState.canvas = canvasEl;
		mapState.width = width;
		mapState.height = height;
		mapState.bgColor = background.hex;
		mapState.tx = tx;
		mapState.ty = ty;
		mapState.mapScale = mapScale;
	});
	let width = $state(0);
	let height = $state(0);

	// Pan/zoom transform. tx/ty are canvas-pixel offsets; mapScale is a
	// multiplier on top of the projection's fitSize baseline.
	const MIN_SCALE = 0.25;
	let tx = $state(0);
	let ty = $state(0);
	let mapScale = $state(1);

	// Drag tracking — plain vars, no reactivity needed.
	let isDragging = $state(false); // $state so canvas cursor class updates
	let lastPointerX = 0;
	let lastPointerY = 0;

	// Zoom toward an arbitrary canvas point (cx, cy).
	function zoomAt(cx: number, cy: number, factor: number) {
		const newScale = Math.max(MIN_SCALE, mapScale * factor);
		const actualFactor = newScale / mapScale;
		tx = cx - (cx - tx) * actualFactor;
		ty = cy - (cy - ty) * actualFactor;
		mapScale = newScale;
	}

	function zoomIn()  { zoomAt(width / 2, height / 2, 1.5); }
	function zoomOut() { zoomAt(width / 2, height / 2, 1 / 1.5); }
	function fitToExtent() {
		const visibleLayers = layers.filter((l) => l.visible && l.hasTopology);
		if (!projection || visibleLayers.length === 0) {
			tx = 0; ty = 0; mapScale = 1;
			return;
		}

		// Combine all visible layer features into one collection
		const features = visibleLayers.flatMap((l) => {
			const topo = workingTopologyData.get(l.id);
			if (!topo) return [];
			const objectName = Object.keys(topo.objects)[0];
			const fc = feature(topo, topo.objects[objectName]) as { features?: unknown[] };
			return fc?.features ?? [];
		});
		const combined = { type: 'FeatureCollection' as const, features };

		// Get bounding box in projected (canvas) coordinates
		const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds(combined as d3.GeoPermissibleObjects);
		if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) {
			tx = 0; ty = 0; mapScale = 1;
			return;
		}

		const padding = 40;
		const scale = Math.min(
			(width - padding * 2) / (x1 - x0),
			(height - padding * 2) / (y1 - y0)
		);
		tx = width / 2 - ((x0 + x1) / 2) * scale;
		ty = height / 2 - ((y0 + y1) / 2) * scale;
		mapScale = scale;
	}

	function handlePointerDown(e: PointerEvent) {
		isDragging = true;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
		(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		tx += e.clientX - lastPointerX;
		ty += e.clientY - lastPointerY;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
	}

	function handlePointerUp() {
		isDragging = false;
	}

	let projection = $derived.by(() => {
		const fn = allProjections[projectionStore.id] as (() => d3.GeoProjection) | undefined;
		if (!fn || !width || !height) return null;
		return fn().fitSize([width, height], { type: 'Sphere' });
	});

	// Push a history snapshot whenever the projection changes.
	// We skip the initial run by comparing against the value at component creation.
	let _lastProjectionId = projectionStore.id;
	$effect(() => {
		const id = projectionStore.id;
		if (id !== _lastProjectionId) {
			_lastProjectionId = id;
			pushSnapshot();
		}
	});

	// Plain Map — not reactive, so Svelte never re-runs path computation
	// as a side-effect of the paint loop reading from it.
	const pathCache = new Map<string, Path2D[]>();

	// Bumped whenever the cache gains new entries. The paint effect reads
	// this so it knows to repaint after a path is computed.
	let cacheVersion = $state(0);

	// The projection object the cache was built for. When this changes
	// we invalidate all entries and recompute from scratch.
	let cachedProjection: d3.GeoProjection | null = null;

	// Compute Path2D only for layers that don't have a cached entry yet.
	// Reads layer.hasTopology (a plain boolean in $state) as the reactive signal —
	// never the topology itself, which lives in the plain workingTopologyData Map and
	// is therefore invisible to Svelte's deep_read mechanism.
	$effect(() => {
		if (!projection) return;

		// Projection changed — all cached paths are now wrong.
		if (projection !== cachedProjection) {
			pathCache.clear();
			cachedProjection = projection;
		}

		let updated = false;

		for (const layer of layers) {
			const { id, hasTopology } = layer;
			if (!hasTopology) { pathCache.delete(id); continue; } // stale — clear and wait for pipeline
			if (pathCache.has(id)) continue; // already cached, skip

			const topo = workingTopologyData.get(id);
			if (!topo) continue;
			const objectName = Object.keys(topo.objects)[0];

			if (layer.processing.bezierEnabled) {
				// Bezier path — built directly in screen space from topology arcs,
				// bypassing the GeoJSON conversion. Covers Polygon, MultiPolygon,
				// LineString, and MultiLineString; points are handled separately below.
				const { bezierCurveType, bezierTension, bezierAlpha, bezierContinuity, bezierBias } = layer.processing;
				const bezierArcs = buildBezierArcs(topo, projection, bezierCurveType, bezierTension, bezierAlpha, bezierContinuity, bezierBias);
				pathCache.set(id, [buildTopoPath(topo, bezierArcs)]);
				updated = true;
			} else {
				// Standard path — convert topology → GeoJSON inline. The result is
				// temporary: used to build the Path2D and then GC'd.
				const data = feature(topo, topo.objects[objectName]) as { type?: string; features?: { geometry?: { type?: string } }[] };

				// Filter out Point / MultiPoint — drawn separately with d3-shape symbols.
				const nonPointFeatures = data.features?.filter((f) => {
					const t = f?.geometry?.type;
					return t !== 'Point' && t !== 'MultiPoint';
				}) ?? [];

				if (nonPointFeatures.length > 0) {
					// Chunk features into groups of 200 before building Path2D objects.
					// A single Path2D built from all features of a large dataset (e.g. US
					// Counties) can exceed ~100 MB of SVG path data, which Chrome's Skia
					// renderer silently drops. Smaller chunks stay well within that limit.
					const CHUNK = 200;
					const chunks: Path2D[] = [];
					for (let i = 0; i < nonPointFeatures.length; i += CHUNK) {
						const chunkData = { ...data, features: nonPointFeatures.slice(i, i + CHUNK) };
						const svgPath = d3.geoPath(projection)(chunkData as d3.GeoPermissibleObjects);
						if (svgPath) chunks.push(new Path2D(svgPath));
					}
					if (chunks.length > 0) {
						pathCache.set(id, chunks);
						updated = true;
					}
				} else {
					// Pure point layer — store an empty array so the paint loop knows
					// data has arrived and cacheVersion bumps to trigger a repaint.
					pathCache.set(id, []);
					updated = true;
				}
			}
		}

		// Remove entries for layers that no longer exist.
		const activeIds = new Set(layers.map((l) => l.id));
		for (const id of pathCache.keys()) {
			if (!activeIds.has(id)) pathCache.delete(id);
		}

		if (updated) cacheVersion++;
	});

	// Wheel zoom — must be non-passive to call preventDefault().
	$effect(() => {
		if (!canvasEl) return;
		function handleWheel(e: WheelEvent) {
			e.preventDefault();
			const rect = canvasEl!.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			// exp gives smooth logarithmic zoom on both trackpad and mouse wheel.
			const factor = Math.exp(-e.deltaY * 0.007);
			zoomAt(cx, cy, factor);
		}
		canvasEl.addEventListener('wheel', handleWheel, { passive: false });
		return () => canvasEl!.removeEventListener('wheel', handleWheel);
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

		// Background fill — drawn before layers so it sits behind everything.
		// The container is white, so alpha=0 simply reveals white.
		ctx.globalAlpha = background.alpha;
		ctx.fillStyle = background.hex;
		ctx.fillRect(0, 0, width, height);
		ctx.globalAlpha = 1;

		// Apply pan/zoom on top of the DPR scale. Layers are drawn in world
		// space (0..width, 0..height) so this shifts + scales the whole map.
		ctx.translate(tx, ty);
		ctx.scale(mapScale, mapScale);

		for (const layer of [...layers].reverse()) {
			if (!layer.visible) continue;

			// Don't read layer.data here — Svelte would deep_read the entire
			// GeoJSON tree to establish reactive tracking, which takes seconds
			// for large datasets. The pathCache check is sufficient: if there's
			// no cached path, the data hasn't loaded yet.
			// paths===undefined means not yet loaded; paths===[] means point-only layer.
			const paths = pathCache.get(layer.id);
			if (paths === undefined) continue;

			const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
			const hasPoints   = layer.geometryTypes.some((t) => t === 'Point' || t === 'MultiPoint');

			// ── Polygon / line geometry ────────────────────────────────────────
			if (hasNonPoint) {
				ctx.strokeStyle = layer.style.stroke;
				ctx.lineWidth = layer.style.strokeWidth / mapScale;
				if (layer.style.strokeDashed) {
					ctx.setLineDash([layer.style.strokeDash / mapScale, layer.style.strokeGap / mapScale]);
				}
				for (const path2d of paths) {
					if (layer.style.fill !== 'none') {
						ctx.globalAlpha = layer.style.fillOpacity;
						ctx.fillStyle = layer.style.fill;
						ctx.fill(path2d);
					}
					ctx.globalAlpha = layer.style.strokeOpacity;
					ctx.stroke(path2d);
				}
				ctx.setLineDash([]);
			}

			// ── Point geometry — d3-shape symbols ─────────────────────────────
			// We read workingTopologyData directly (plain Map — no Svelte tracking) and
			// project each coordinate manually so we can stamp the chosen symbol.
			if (hasPoints && projection) {
				const sym = shapeMap[layer.style.pointShape] ?? d3shape.symbolCircle;
				const area = Math.PI * layer.style.pointRadius * layer.style.pointRadius;
				const symPathStr = d3shape.symbol(sym, area)();

				if (symPathStr) {
					const symPath2D = new Path2D(symPathStr);
					const topo = workingTopologyData.get(layer.id);
					const objectName = topo ? Object.keys(topo.objects)[0] : null;
					const data = topo && objectName
						? feature(topo, topo.objects[objectName]) as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] }
						: undefined;

					if (data?.features) {
						for (const f of data.features) {
							const geom = f?.geometry;
							if (!geom) continue;

							const coordsList: [number, number][] =
								geom.type === 'Point'
									? [geom.coordinates as [number, number]]
									: geom.type === 'MultiPoint'
										? (geom.coordinates as [number, number][])
										: [];

							for (const coord of coordsList) {
								const pt = projection(coord);
								if (!pt) continue;
								const [px, py] = pt;

								ctx.save();
								ctx.translate(px, py);
								// Cancel mapScale so symbols stay constant size in screen pixels,
								// mirroring how strokeWidth is divided by mapScale above.
								ctx.scale(1 / mapScale, 1 / mapScale);

								if (layer.style.fill !== 'none') {
									ctx.globalAlpha = layer.style.fillOpacity;
									ctx.fillStyle = layer.style.fill;
									ctx.fill(symPath2D);
								}

								if (layer.style.stroke !== 'none') {
									ctx.globalAlpha = layer.style.strokeOpacity;
									ctx.strokeStyle = layer.style.stroke;
									ctx.lineWidth = layer.style.strokeWidth; // already in screen-px after scale
									ctx.stroke(symPath2D);
								}

								ctx.restore();
							}
						}
					}
				}
			}

			// Reset alpha so layers don't bleed into each other.
			ctx.globalAlpha = 1;
		}
	});
</script>

<div class="map-canvas" bind:this={containerEl}>
	<div class="projection-selector">
		<Combobox options={PROJECTIONS} bind:value={projectionStore.id} placeholder="Search projections…" direction="up" />
	</div>

	<div class="zoom-controls">
		<button class="zoom-btn" aria-label="Zoom in" onclick={zoomIn}>
			<MagnifyingGlassPlus size={16} />
		</button>
		<button class="zoom-btn" aria-label="Zoom out" onclick={zoomOut}>
			<MagnifyingGlassMinus size={16} />
		</button>
		<div class="zoom-divider"></div>
		<button class="zoom-btn" aria-label="Fit to extent" onclick={fitToExtent}>
			<CornersOut size={16} />
		</button>
	</div>

	<div class="background-selector">
		<BackgroundControl />
	</div>

	<canvas
		bind:this={canvasEl}
		class:dragging={isDragging}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
	></canvas>
</div>

<style>
	.map-canvas {
		position: relative;
		flex: 1;
		height: 100%;
		background-color: white;
		overflow: hidden;
	}

	canvas {
		display: block;
		cursor: grab;
	}

	canvas.dragging {
		cursor: grabbing;
	}

	.projection-selector {
		position: absolute;
		bottom: var(--space-m);
		left: var(--space-m);
		z-index: 10;
		width: 220px;
	}

	.zoom-controls {
		position: absolute;
		top: var(--space-m);
		right: var(--space-m);
		z-index: 10;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		overflow: hidden;
	}

	.zoom-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		background: transparent;
		color: var(--color-icon-primary);
		cursor: pointer;
		padding: 0;
	}

	.zoom-btn:hover {
		background: var(--color-surface-secondary);
	}

	.zoom-divider {
		height: 1px;
		background: var(--color-border);
	}

	.background-selector {
		position: absolute;
		bottom: var(--space-m);
		right: var(--space-m);
		z-index: 10;
	}
</style>
