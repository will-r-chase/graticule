<script lang="ts">
	import * as d3 from 'd3-geo';
	import * as d3shape from 'd3-shape';
	import * as d3gp from 'd3-geo-projection';
	import { feature } from 'topojson-client';
	import { buildBezierArcs, buildTopoPath } from '$lib/utils/bezier';
	import { buildAdjacencyGraph, buildChunksBFS, buildChunksHilbert } from '$lib/utils/spatial';
	import { layers, workingTopologyData } from '$lib/stores/layers.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { mapState } from '$lib/stores/mapState.svelte';
	import { background } from '$lib/stores/background.svelte';
	import { PROJECTIONS } from '$lib/config';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import BackgroundControl from '$lib/components/map/BackgroundControl.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import { MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut } from 'phosphor-svelte';
	import { debug } from '$lib/stores/debug.svelte';
	import type { LayerChunkStats } from '$lib/stores/debug.svelte';

	const DEBUG_COLORS = [
		'#e63946', '#2a9d8f', '#e9c46a', '#f4a261', '#264653',
		'#6a4c93', '#1982c4', '#8ac926', '#ff595e', '#6a994e',
	];

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
		const [[x0, y0], [x1, y1]] = d3.geoPath(makeClampedProjection(projection) as unknown as d3.GeoProjection).bounds(combined as d3.GeoPermissibleObjects);
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

	// Wraps a projection's stream to clamp lon/lat before the projection math runs.
	// TopoJSON quantization decodes pole coordinates as lat = 90 + ε (floating-point
	// artifact of integer scale/translate arithmetic). Mercator returns NaN for lat > 90°,
	// which causes Canvas 2D to produce triangular fill artifacts. Clamping to exactly
	// [-90, 90] / [-180, 180] is invisible on screen but eliminates all NaN coordinates.
	function makeClampedProjection(proj: d3.GeoProjection): { stream: (sink: d3.GeoStream) => d3.GeoStream } {
		return {
			stream: (sink: d3.GeoStream): d3.GeoStream => {
				const s = proj.stream(sink);
				return {
					point(lon: number, lat: number) {
						s.point(Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat)));
					},
					lineStart()    { s.lineStart(); },
					lineEnd()      { s.lineEnd(); },
					polygonStart() { s.polygonStart(); },
					polygonEnd()   { s.polygonEnd(); },
					sphere()       { s.sphere?.(); },
				};
			}
		};
	}

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

	interface CachedChunk {
		path2d: Path2D;
		bbox: [number, number, number, number]; // xmin, ymin, xmax, ymax in projection space
	}

	// Plain Map — not reactive, so Svelte never re-runs path computation
	// as a side-effect of the paint loop reading from it.
	const pathCache = new Map<string, CachedChunk[]>();

	// Bumped whenever the cache gains new entries. The paint effect reads
	// this so it knows to repaint after a path is computed.
	let cacheVersion = $state(0);

	// The projection object and max-chunk-vertices setting the cache was built for.
	// When either changes we invalidate all entries and recompute from scratch.
	let cachedProjection: d3.GeoProjection | null = null;
	let cachedMaxChunkVertices = debug.maxChunkVertices;
	let cachedNoChunking = debug.noChunking;

	// Compute Path2D only for layers that don't have a cached entry yet.
	// Reads layer.hasTopology (a plain boolean in $state) as the reactive signal —
	// never the topology itself, which lives in the plain workingTopologyData Map and
	// is therefore invisible to Svelte's deep_read mechanism.
	$effect(() => {
		if (!projection) return;

		// Projection or chunk settings changed — all cached paths are now wrong.
		const maxChunkVertices = debug.maxChunkVertices;
		const noChunking = debug.noChunking;
		if (projection !== cachedProjection || maxChunkVertices !== cachedMaxChunkVertices || noChunking !== cachedNoChunking) {
			pathCache.clear();
			cachedProjection = projection;
			cachedMaxChunkVertices = maxChunkVertices;
			cachedNoChunking = noChunking;
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
				pathCache.set(id, [{ path2d: buildTopoPath(topo, bezierArcs), bbox: [-Infinity, -Infinity, Infinity, Infinity] }]);
				updated = true;
			} else {
				// Standard path — convert topology → GeoJSON inline. The result is
				// temporary: used to build the Path2D and then GC'd.
				const data = feature(topo, topo.objects[objectName]) as { type?: string; features?: { geometry?: { type?: string } }[] };

				// Build parallel non-point arrays: GeoJSON features (for rendering) and
				// TopoJSON geometries (for adjacency). Kept in sync by filtering together.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const topoGeoms: { arcs?: unknown }[] = ((topo.objects[objectName] as any).geometries ?? []);
				type GeoFeature = NonNullable<typeof data.features>[number];
				const nonPointGeo: GeoFeature[] = [];
				const nonPointTopo: typeof topoGeoms = [];
				for (let i = 0; i < (data.features?.length ?? 0); i++) {
					const t = data.features![i]?.geometry?.type;
					if (t !== 'Point' && t !== 'MultiPoint') {
						nonPointGeo.push(data.features![i]);
						nonPointTopo.push(topoGeoms[i] ?? {});
					}
				}

				if (nonPointGeo.length > 0) {
					// Use topology-based BFS chunking when shared arcs are present AND the
					// layer contains only polygon features. BFS produces one chunk per
					// connected component, which is compact and correct for polygon borders
					// (countries, counties) but wrong for line networks (roads, rivers,
					// graticules) where many segments are disconnected and would each become
					// their own single-feature chunk — causing thousands of Path2D objects.
					// Line layers use Hilbert sort, which packs many small features correctly.
					const MAX_CHUNK_VERTICES = maxChunkVertices;
					const isPolygonLayer = nonPointGeo.every(f => {
						const t = f?.geometry?.type;
						return t === 'Polygon' || t === 'MultiPolygon';
					});
					const adjacency = isPolygonLayer ? buildAdjacencyGraph(nonPointTopo) : [];
					const hasTopology = isPolygonLayer && adjacency.some(s => s.size > 0);
					const featureGroups = noChunking
						? nonPointGeo.map(f => [f])
						: hasTopology
							? buildChunksBFS(nonPointGeo, adjacency, MAX_CHUNK_VERTICES)
							: buildChunksHilbert(nonPointGeo, MAX_CHUNK_VERTICES);

					// Build Path2D while tracking its bbox in projection space.
					// Bbox is computed for free — we're already visiting every coordinate.
					const chunks: CachedChunk[] = [];
					for (const chunkFeatures of featureGroups) {
						const path2d = new Path2D();
						let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
						const pathCtx = {
							beginPath: () => {},
							moveTo: (x: number, y: number) => {
								path2d.moveTo(x, y);
								if (x < xMin) xMin = x; if (x > xMax) xMax = x;
								if (y < yMin) yMin = y; if (y > yMax) yMax = y;
							},
							lineTo: (x: number, y: number) => {
								path2d.lineTo(x, y);
								if (x < xMin) xMin = x; if (x > xMax) xMax = x;
								if (y < yMin) yMin = y; if (y > yMax) yMax = y;
							},
							closePath: () => { path2d.closePath(); },
							arc: (x: number, y: number, r: number, a1: number, a2: number) => {
								path2d.arc(x, y, r, a1, a2);
							},
						};
						d3.geoPath(makeClampedProjection(projection) as unknown as d3.GeoProjection, pathCtx as any)({ ...data, features: chunkFeatures } as d3.GeoPermissibleObjects);
						chunks.push({ path2d, bbox: [xMin, yMin, xMax, yMax] });
					}

					pathCache.set(id, chunks);
					updated = true;
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

		ctx.globalAlpha = background.alpha;
		ctx.fillStyle = background.hex;
		ctx.fillRect(0, 0, width, height);
		ctx.globalAlpha = 1;

		ctx.translate(tx, ty);
		ctx.scale(mapScale, mapScale);

		const debugStats: LayerChunkStats[] = [];
		let debugChunkOffset = 0;

		for (const layer of [...layers].reverse()) {
			if (!layer.visible) continue;

			const chunks = pathCache.get(layer.id);
			if (chunks === undefined) continue;

			const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
			const hasPoints   = layer.geometryTypes.some((t) => t === 'Point' || t === 'MultiPoint');

			if (hasNonPoint) {
				const vxMin = -tx / mapScale;
				const vxMax = (width - tx) / mapScale;
				const vyMin = -ty / mapScale;
				const vyMax = (height - ty) / mapScale;

				if (!debug.enabled) {
					ctx.strokeStyle = layer.style.stroke;
					ctx.lineWidth = layer.style.strokeWidth / mapScale;
					if (layer.style.strokeDashed) {
						ctx.setLineDash([layer.style.strokeDash / mapScale, layer.style.strokeGap / mapScale]);
					}
				}

				let visibleChunks = 0;
				for (let ci = 0; ci < chunks.length; ci++) {
					const { path2d, bbox } = chunks[ci];
					const [xMin, yMin, xMax, yMax] = bbox;
					if (xMax < vxMin || xMin > vxMax || yMax < vyMin || yMin > vyMax) continue;
					visibleChunks++;

					if (debug.enabled) {
						const color = DEBUG_COLORS[(debugChunkOffset + ci) % DEBUG_COLORS.length];
						ctx.globalAlpha = 0.35;
						ctx.fillStyle = color;
						ctx.fill(path2d, 'evenodd');
						ctx.globalAlpha = 0.85;
						ctx.strokeStyle = color;
						ctx.lineWidth = 1.5 / mapScale;
						ctx.setLineDash([]);
						ctx.stroke(path2d);
					} else {
						if (layer.style.fill !== 'none') {
							ctx.globalAlpha = layer.style.fillOpacity;
							ctx.fillStyle = layer.style.fill;
							ctx.fill(path2d, 'evenodd');
						}
						ctx.globalAlpha = layer.style.strokeOpacity;
						ctx.stroke(path2d);
					}
				}
				debugChunkOffset += chunks.length;
				debugStats.push({ layerId: layer.id, layerName: layer.name, total: chunks.length, visible: visibleChunks });
				ctx.setLineDash([]);
			}

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
								ctx.scale(1 / mapScale, 1 / mapScale);

								if (layer.style.fill !== 'none') {
									ctx.globalAlpha = layer.style.fillOpacity;
									ctx.fillStyle = layer.style.fill;
									ctx.fill(symPath2D);
								}

								if (layer.style.stroke !== 'none') {
									ctx.globalAlpha = layer.style.strokeOpacity;
									ctx.strokeStyle = layer.style.stroke;
									ctx.lineWidth = layer.style.strokeWidth;
									ctx.stroke(symPath2D);
								}

								ctx.restore();
							}
						}
					}
				}
			}

			ctx.globalAlpha = 1;
		}

		if (debug.enabled) debug.chunkStats = debugStats;

		if (debug.enabled && debug.showBboxes) {
			let bboxOffset = 0;
			for (const layer of [...layers].reverse()) {
				if (!layer.visible) continue;
				const chunks = pathCache.get(layer.id);
				if (!chunks) { continue; }
				const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
				if (!hasNonPoint) { bboxOffset += chunks.length; continue; }

				for (let ci = 0; ci < chunks.length; ci++) {
					const { bbox } = chunks[ci];
					const [xMin, yMin, xMax, yMax] = bbox;
					if (!isFinite(xMin)) continue;
					const color = DEBUG_COLORS[(bboxOffset + ci) % DEBUG_COLORS.length];
					ctx.globalAlpha = 0.7;
					ctx.strokeStyle = color;
					ctx.lineWidth = 1.5 / mapScale;
					ctx.setLineDash([5 / mapScale, 5 / mapScale]);
					ctx.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
				}
				bboxOffset += chunks.length;
			}
			ctx.setLineDash([]);
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

	<div class="bottom-right-stack">
		<Toaster />
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

	.bottom-right-stack {
		position: absolute;
		bottom: var(--space-m);
		right: var(--space-m);
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-s);
	}
</style>
