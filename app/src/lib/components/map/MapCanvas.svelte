<script lang="ts">
	import { untrack } from 'svelte';
	import * as d3 from 'd3-geo';
	import * as d3shape from 'd3-shape';
	import * as d3gp from 'd3-geo-projection';
	import { feature } from 'topojson-client';
	import { workerBuildPaths } from '$lib/workers/geoWorker';
	import type { PathCommand } from '$lib/workers/types';
	import { layers, workingTopologyData, layerDrag } from '$lib/stores/layers.svelte';
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

	// Rotation drag tracking (rotate-mode projections only).
	let localRotate: [number, number, number] = [0, 0, 0];
	let rotateThrottleActive = false;

	// Derived projection metadata from the PROJECTIONS config.
	const projectionEntry = $derived(PROJECTIONS.find(p => p.id === projectionStore.id) ?? PROJECTIONS[0]);
	const interactionMode = $derived(projectionEntry.interactionMode);
	const isGlobe = $derived(projectionEntry.isGlobe === true);

	// Resize debounce — true while the container is actively being resized.
	// The cache effect bails out while this is set, deferring path recomputation
	// until the resize settles. Works for both window resize and future panel drags
	// since the ResizeObserver watches containerEl directly.
	let isResizing = $state(false);
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;

	// Zoom toward an arbitrary canvas point (cx, cy).
	function zoomAt(cx: number, cy: number, factor: number) {
		const newScale = Math.max(MIN_SCALE, mapScale * factor);
		const actualFactor = newScale / mapScale;
		tx = cx - (cx - tx) * actualFactor;
		ty = cy - (cy - ty) * actualFactor;
		mapScale = newScale;
		mapState.tx = tx;
		mapState.ty = ty;
		mapState.mapScale = mapScale;
	}

	function zoomIn()  { zoomAt(width / 2, height / 2, 1.5); }
	function zoomOut() { zoomAt(width / 2, height / 2, 1 / 1.5); }
	function fitToExtent() {
		const visibleLayers = layers.filter((l) => l.visible && l.hasTopology);
		if (!projection || visibleLayers.length === 0) {
			tx = 0; ty = 0; mapScale = 1;
			mapState.tx = 0; mapState.ty = 0; mapState.mapScale = 1;
			return;
		}

		// In rotate mode, fitting means pointing the globe at the data's centroid.
		// tx/ty/mapScale are left unchanged — zoom level is preserved.
		if (interactionMode === 'rotate') {
			const features = visibleLayers.flatMap((l) => {
				const topo = workingTopologyData.get(l.id);
				if (!topo) return [];
				const objectName = Object.keys(topo.objects)[0];
				const fc = feature(topo, topo.objects[objectName]) as { features?: unknown[] };
				return fc?.features ?? [];
			});
			if (features.length === 0) return;

			const combined = { type: 'FeatureCollection' as const, features };
			const [cLon, cLat] = d3.geoCentroid(combined as d3.GeoPermissibleObjects);
			if (!isFinite(cLon) || !isFinite(cLat)) return;

			projectionStore.rotate = [-cLon, -cLat, 0];
			tx = 0; ty = 0; mapScale = 1;
			mapState.tx = 0; mapState.ty = 0; mapState.mapScale = 1;
			return;
		}

		// Fast path: union the cached chunk bboxes (already in projection space,
		// computed for free during path building — no coordinate traversal needed).
		// Bezier chunks carry [-Infinity, ...] bboxes and are skipped.
		// Point layers have empty chunk arrays and are skipped.
		// If no finite bbox is found, fall back to the full bounds computation below.
		let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
		let hasCachedBounds = false;
		for (const layer of visibleLayers) {
			const chunks = pathCache.get(layer.id);
			if (!chunks) continue;
			for (const { bbox } of chunks) {
				const [cxMin, cyMin, cxMax, cyMax] = bbox;
				if (!isFinite(cxMin)) continue; // bezier chunk — skip
				if (cxMin < bx0) bx0 = cxMin;
				if (cyMin < by0) by0 = cyMin;
				if (cxMax > bx1) bx1 = cxMax;
				if (cyMax > by1) by1 = cyMax;
				hasCachedBounds = true;
			}
		}

		if (hasCachedBounds) {
			const padding = 40;
			const scale = Math.min(
				(width - padding * 2) / (bx1 - bx0),
				(height - padding * 2) / (by1 - by0)
			);
			tx = width / 2 - ((bx0 + bx1) / 2) * scale;
			ty = height / 2 - ((by0 + by1) / 2) * scale;
			mapScale = scale;
			mapState.tx = tx;
			mapState.ty = ty;
			mapState.mapScale = mapScale;
			return;
		}

		// Fallback: compute bounds from GeoJSON (point-only layers, bezier-only,
		// or pathCache not yet populated).
		const features = visibleLayers.flatMap((l) => {
			const topo = workingTopologyData.get(l.id);
			if (!topo) return [];
			const objectName = Object.keys(topo.objects)[0];
			const fc = feature(topo, topo.objects[objectName]) as { features?: unknown[] };
			return fc?.features ?? [];
		});
		const combined = { type: 'FeatureCollection' as const, features };

		const [[x0, y0], [x1, y1]] = d3.geoPath(makeClampedProjection(projection) as unknown as d3.GeoProjection).bounds(combined as d3.GeoPermissibleObjects);
		if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) {
			tx = 0; ty = 0; mapScale = 1;
			mapState.tx = 0; mapState.ty = 0; mapState.mapScale = 1;
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
		mapState.tx = tx;
		mapState.ty = ty;
		mapState.mapScale = mapScale;
	}

	function handlePointerDown(e: PointerEvent) {
		isDragging = true;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
		if (interactionMode === 'rotate') {
			localRotate = [...projectionStore.rotate];
		}
		(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;

		if (interactionMode === 'rotate' && projection) {
			const scale = projection.scale();
			const dλ = (e.clientX - lastPointerX) / scale * (180 / Math.PI);
			const dφ = -(e.clientY - lastPointerY) / scale * (180 / Math.PI);
			localRotate = [
				localRotate[0] + dλ,
				Math.max(-90, Math.min(90, localRotate[1] + dφ)),
				0,
			];
			if (!rotateThrottleActive) {
				projectionStore.rotate = [...localRotate];
				rotateThrottleActive = true;
				setTimeout(() => { rotateThrottleActive = false; }, 50);
			}
		} else {
			tx += e.clientX - lastPointerX;
			ty += e.clientY - lastPointerY;
			mapState.tx = tx;
			mapState.ty = ty;
		}

		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
	}

	function handlePointerUp() {
		isDragging = false;
		if (interactionMode === 'rotate') {
			rotateThrottleActive = false;
			projectionStore.rotate = [...localRotate];
		}
	}

	let projection = $derived.by(() => {
		const resolvedId = projectionStore.id === 'geoGlobe' ? 'geoOrthographic' : projectionStore.id;
		const fn = allProjections[resolvedId] as (() => d3.GeoProjection) | undefined;
		if (!fn || !width || !height) return null;
		const rot = projectionEntry.interactionMode === 'rotate' ? projectionStore.rotate : [0, 0, 0] as [number, number, number];
		return fn().fitSize([width, height], { type: 'Sphere' }).rotate(rot);
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

	// Reset tx/ty to center when switching into rotate mode so the view starts centered.
	let _lastInteractionMode = interactionMode;
	$effect(() => {
		const mode = interactionMode;
		if (mode === 'rotate' && _lastInteractionMode !== 'rotate') {
			tx = 0; ty = 0;
			mapState.tx = 0; mapState.ty = 0;
		}
		_lastInteractionMode = mode;
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

	// Per-layer bezierCacheKey values at the time the path cache entry was built.
	// When layer.bezierCacheKey changes (bezier settings updated), the entry is
	// cleared and rebuilt without re-running the topology pipeline.
	const cachedBezierKeys = new Map<string, number>();

	// Incremented on every full cache invalidation (projection/settings change).
	// Worker callbacks capture their launch epoch and discard results if it has advanced.
	let pathBuildEpoch = 0;
	// Layers currently waiting on a worker response — prevents duplicate in-flight builds.
	const inFlightBuilds = new Set<string>();
	// Layers whose cached path is stale (topology changed) but kept visible until a fresh
	// path arrives, so the layer never flashes invisible during a rebuild.
	const stalePaths = new Set<string>();
	// Projection ID the cache was last built for — tracks type changes independently of
	// the d3 projection object so rotation-only changes can skip clearing inFlightBuilds.
	let cachedProjectionId = '';
	// Bumped when a stale build completes, re-triggering the cache effect so the next
	// build fires immediately rather than waiting for another reactive change.
	let staleBuildVersion = $state(0);

	function commandsToPath2D(commands: PathCommand[]): Path2D {
		const path2d = new Path2D();
		for (const cmd of commands) {
			if (cmd.op === 'M') path2d.moveTo(cmd.x, cmd.y);
			else if (cmd.op === 'L') path2d.lineTo(cmd.x, cmd.y);
			else if (cmd.op === 'Z') path2d.closePath();
			else if (cmd.op === 'C') path2d.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.ex, cmd.ey);
		}
		return path2d;
	}

	// Fingerprint that changes when layers are added/removed or when hasTopology/bezierCacheKey
	// changes on any layer — but NOT when layers are merely reordered. The sort() ensures
	// order is irrelevant. Because this is a string, Svelte uses === to compare the previous
	// and new values; an identical string means no downstream effects are triggered.
	const cacheSignal = $derived.by(() =>
		layers.map(l => `${l.id}:${l.hasTopology ? 1 : 0}:${l.bezierCacheKey}`).sort().join('|')
	);

	// Dispatch path builds to the worker for layers that don't have a cached entry yet.
	// Subscribes via cacheSignal (not layers directly) so that layer reordering — which
	// produces an identical sorted fingerprint — does not trigger path recomputation.
	// layers is read inside untrack() since cacheSignal already captures what matters.
	$effect(() => {
		if (layerDrag.active) return; // bail out during drag — all paths already cached, no computation needed
		if (isResizing) return;       // defer during resize — recompute once after container settles
		void cacheSignal; // re-run when layers change meaningfully; stable across reorders
		void staleBuildVersion; // re-run when a stale build completes, to fire the next one
		if (!projection) return;

		// Projection or chunk settings changed — mark all cached paths as stale so
		// old paths stay visible during rebuild rather than flashing invisible.
		const maxChunkVertices = debug.maxChunkVertices;
		const noChunking = debug.noChunking;
		const currentProjId = projectionStore.id;
		if (projection !== cachedProjection || maxChunkVertices !== cachedMaxChunkVertices || noChunking !== cachedNoChunking) {
			for (const id of pathCache.keys()) stalePaths.add(id);
			// For rotation-only changes keep inFlightBuilds intact — at most one build
			// per layer in-flight at a time, preventing worker queue buildup during drag.
			const rotationOnly = projection !== cachedProjection && currentProjId === cachedProjectionId;
			if (!rotationOnly) inFlightBuilds.clear();
			pathBuildEpoch++;
			cachedProjection = projection;
			cachedProjectionId = currentProjId;
			cachedMaxChunkVertices = maxChunkVertices;
			cachedNoChunking = noChunking;
		}

		// Read layers without subscribing — cacheSignal already tracks what matters.
		const currentLayers = untrack(() => layers.slice());

		// Synchronous housekeeping: mark stale entries so their old paths stay visible
		// while the worker rebuilds them, rather than flashing invisible.
		for (const layer of currentLayers) {
			const { id, hasTopology } = layer;
			if (!hasTopology) {
				stalePaths.add(id);
				cachedBezierKeys.delete(id);
				inFlightBuilds.delete(id);
				continue;
			}
			const stored = cachedBezierKeys.get(id);
			const current = layer.bezierCacheKey;
			if (stored !== current) {
				stalePaths.add(id);
				inFlightBuilds.delete(id);
				cachedBezierKeys.set(id, current);
			}
		}

		// Remove entries for layers that no longer exist.
		const activeIds = new Set(currentLayers.map((l) => l.id));
		for (const id of pathCache.keys()) {
			if (!activeIds.has(id)) pathCache.delete(id);
		}
		for (const id of inFlightBuilds) {
			if (!activeIds.has(id)) inFlightBuilds.delete(id);
		}
		for (const id of stalePaths) {
			if (!activeIds.has(id)) stalePaths.delete(id);
		}

		// Fire async builds for layers that need paths. Each resolves independently,
		// writing to the cache and bumping cacheVersion when the worker responds.
		const projId = projectionStore.id;
		const rotate = (projectionEntry.interactionMode === 'rotate' ? [...projectionStore.rotate] : [0, 0, 0]) as [number, number, number];
		const w = width;
		const h = height;
		const epoch = pathBuildEpoch;

		for (const layer of currentLayers) {
			const { id } = layer;
			if (!layer.hasTopology) continue;
			if (pathCache.has(id) && !stalePaths.has(id)) continue; // fresh path, skip
			if (inFlightBuilds.has(id)) continue; // already building, avoid duplicate requests

			const topo = workingTopologyData.get(id);
			if (!topo) continue;

			inFlightBuilds.add(id);
			workerBuildPaths(id, topo, projId, w, h, rotate, { ...layer.processing }, maxChunkVertices, noChunking)
				.then((chunks) => {
					inFlightBuilds.delete(id); // always unblock, regardless of epoch
					if (epoch !== pathBuildEpoch) {
						staleBuildVersion++; // re-trigger the effect to fire the next build
						return;
					}
					stalePaths.delete(id);
					pathCache.set(id, chunks.map(c => ({
						path2d: commandsToPath2D(c.commands),
						bbox: c.bbox,
					})));
					cacheVersion++;
				});
		}
	});

	// Clear layer.loading once its paths are in the cache. Runs after each
	// cacheVersion bump (i.e. right after the cache effect adds new entries).
	// Kept separate from the cache effect so we're not writing reactive state
	// from inside the same effect that builds the cache — cleaner dependency graph.
	$effect(() => {
		void cacheVersion;
		untrack(() => {
			for (const layer of layers) {
				if (layer.loading && layer.hasTopology && pathCache.has(layer.id)) {
					layer.loading = false;
				}
			}
		});
	});

	// Wheel zoom — must be non-passive to call preventDefault().
	$effect(() => {
		if (!canvasEl) return;
		function handleWheel(e: WheelEvent) {
			e.preventDefault();
			const factor = Math.exp(-e.deltaY * 0.007);
			// In rotate mode, zoom toward screen center to keep the projection centered.
			if (interactionMode === 'rotate') {
				zoomAt(width / 2, height / 2, factor);
			} else {
				const rect = canvasEl!.getBoundingClientRect();
				const cx = e.clientX - rect.left;
				const cy = e.clientY - rect.top;
				zoomAt(cx, cy, factor);
			}
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
			mapState.width = rect.width;
			mapState.height = rect.height;
			isResizing = true;
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => { isResizing = false; }, 150);
		});
		observer.observe(containerEl);
		return () => {
			observer.disconnect();
			if (resizeTimer !== null) { clearTimeout(resizeTimer); resizeTimer = null; }
		};
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

		// Draw the globe disk outline when in globe mode.
		if (isGlobe && projection) {
			const spherePathStr = d3.geoPath(projection)({ type: 'Sphere' });
			if (spherePathStr) {
				ctx.strokeStyle = '#888';
				ctx.lineWidth = 2 / mapScale;
				ctx.stroke(new Path2D(spherePathStr));
			}
		}

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
		background-color: var(--grey-50);
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
