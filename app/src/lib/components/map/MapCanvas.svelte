<script lang="ts">
	import { untrack } from 'svelte';
	import * as d3 from 'd3-geo';
	import * as d3shape from 'd3-shape';
	import * as d3gp from 'd3-geo-projection';
	import { feature } from 'topojson-client';
	import { workerBuildPaths, workerStoreTopology, workerRemoveTopology } from '$lib/workers/geoWorker';
	import type { PathCommand } from '$lib/workers/types';
	import { layers, workingTopologyData, layerDrag, deleteSelectedFeatures, extractSelectedFeatures, mergeSelectedFeatures } from '$lib/stores/layers.svelte';
	import { toolState } from '$lib/stores/tool.svelte';
	import { selection, selectFeature, clearSelection } from '$lib/stores/selection.svelte';
	import { hoveredFeature } from '$lib/stores/hoveredFeature.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { mapState } from '$lib/stores/mapState.svelte';
	import { mapView } from '$lib/stores/mapView.svelte';
	import { canvasStyles } from '$lib/stores/canvasStyles.svelte';
	import { PROJECTIONS } from '$lib/config';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import MapToolbar from '$lib/components/map/MapToolbar.svelte';
	import SelectionBar from '$lib/components/map/SelectionBar.svelte';
	import { MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut } from 'phosphor-svelte';
	import { computeFeatureBboxes } from '$lib/utils/featureBbox';

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

	// Marquee selection state.
	const MARQUEE_THRESHOLD = 4; // px before a pointerdown becomes a marquee rather than a click
	let isMarqueeDragging = $state(false);
	let marqueeStart = $state<{ x: number; y: number } | null>(null);
	let marqueeCurrent = $state<{ x: number; y: number } | null>(null);
	let marqueePtrStartX = 0; // raw clientX at pointerdown, for threshold check
	let marqueePtrStartY = 0;
	let suppressNextClick = false;
	let preDragSelection = new Map<string, Set<number>>();
	let cachedBboxes = new Map<string, Array<[number, number, number, number] | null>>();


	// Rotation drag tracking (rotate-mode projections only).
	let localRotate: [number, number, number] = [0, 0, 0];
	let rotateThrottleActive = false;
	// Rotation at the time of the last dispatched worker build. Used to skip builds
	// where the globe has barely moved — the first tiny pointer wiggle doesn't warrant
	// a full 950ms rebuild; wait until the rotation has changed by at least this many degrees.
	const ROTATE_BUILD_THRESHOLD = 2;
	let lastBuiltRotate: [number, number, number] = [0, 0, 0];

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

		// Fast path: union per-feature bboxes from the path cache (already in projection
		// space, computed for free during path building — no coordinate traversal needed).
		// Bezier layers emit a single entry with [-Infinity, ...] bbox and are skipped.
		// Point layers have empty cache arrays and are skipped.
		// If no finite bbox is found, fall back to the full bounds computation below.
		let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
		let hasCachedBounds = false;
		for (const layer of visibleLayers) {
			const chunks = pathCache.get(layer.id);
			if (!chunks) continue;
			for (const { bbox } of chunks) {
				const [cxMin, cyMin, cxMax, cyMax] = bbox;
				if (!isFinite(cxMin)) continue; // bezier layer — skip
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

	// Draw a highlight overlay for a single feature — handles path-cached
	// (non-point) and direct-projected (point) geometry.
	// fillOpacity applies to polygon fills only; points always render at full opacity.
	// useLayerStyle: when true, stroke/point colors come from the layer's own style
	// (used for hover — preserves original colors, only weight/size change).
	function drawFeatureHighlight(
		ctx: CanvasRenderingContext2D,
		layerId: string,
		featureIndex: number,
		fillHex: string,
		strokeHex: string,
		fillOpacity: number,
		lineWidth: number,
		extraRadius = 0,
		useLayerStyle = false,
	) {
		const chunks = pathCache.get(layerId);
		if (chunks === undefined) return;

		const layer = layers.find((l) => l.id === layerId);

		const chunk = chunks[featureIndex];
		if (chunk) {
			const hasPolygons = layer?.geometryTypes.some(
				(t) => t === 'Polygon' || t === 'MultiPolygon'
			) ?? false;
			const strokeColor = useLayerStyle ? (layer?.style.stroke ?? strokeHex) : strokeHex;
			ctx.strokeStyle = strokeColor;
			ctx.lineWidth   = lineWidth;
			if (hasPolygons) {
				ctx.globalAlpha = fillOpacity;
				ctx.fillStyle   = fillHex;
				ctx.fill(chunk.path2d, 'evenodd');
				ctx.globalAlpha = 1;
			}
			ctx.stroke(chunk.path2d);
			return;
		}

		// Point feature — project directly from topology.
		if (!projection || !layer) return;
		const topo = workingTopologyData.get(layerId);
		if (!topo) return;
		const objectName = Object.keys(topo.objects)[0];
		const data = feature(topo, topo.objects[objectName]) as {
			features?: { geometry?: { type?: string; coordinates?: unknown } }[]
		};
		const geom = data?.features?.[featureIndex]?.geometry;
		if (!geom) return;

		const coordsList: [number, number][] =
			geom.type === 'Point'        ? [geom.coordinates as [number, number]]
			: geom.type === 'MultiPoint' ? (geom.coordinates as [number, number][])
			: [];

		const projCenter: [number, number] | null = interactionMode === 'rotate'
			? [-projectionStore.rotate[0], -projectionStore.rotate[1]]
			: null;

		const pointFill   = useLayerStyle ? layer.style.fill   : fillHex;
		const pointStroke = useLayerStyle ? layer.style.stroke : strokeHex;

		const r = layer.style.pointRadius + extraRadius;
		const sym = shapeMap[layer.style.pointShape] ?? d3shape.symbolCircle;
		const symPath2D = new Path2D(d3shape.symbol(sym, Math.PI * r * r)() ?? '');

		for (const coord of coordsList) {
			if (projCenter && d3.geoDistance(coord, projCenter) >= Math.PI / 2) continue;
			const pt = projection(coord);
			if (!pt) continue;
			ctx.save();
			ctx.translate(pt[0], pt[1]);
			ctx.scale(1 / mapScale, 1 / mapScale);
			ctx.globalAlpha = 1;
			ctx.fillStyle   = pointFill;
			ctx.strokeStyle = pointStroke;
			ctx.lineWidth   = lineWidth * mapScale;
			ctx.fill(symPath2D);
			ctx.stroke(symPath2D);
			ctx.restore();
		}
	}

	function handleClick(e: MouseEvent) {
		if (suppressNextClick) { suppressNextClick = false; return; }
		if (toolState.active !== 'select') return;
		if (!hitCanvas || !canvasEl) return;

		const rect = canvasEl.getBoundingClientRect();
		const cx = Math.round(e.clientX - rect.left);
		const cy = Math.round(e.clientY - rect.top);

		const hctx = hitCanvas.getContext('2d');
		if (!hctx) return;

		// Sample a 5×5 area centered on the click to handle sub-pixel misses on thin
		// lines and small points, then pick the most common non-background color.
		const radius = 2;
		const size = radius * 2 + 1;
		const imageData = hctx.getImageData(cx - radius, cy - radius, size, size);

		const counts = new Map<number, number>();
		for (let i = 0; i < imageData.data.length; i += 4) {
			const key = (imageData.data[i] << 16) | (imageData.data[i + 1] << 8) | imageData.data[i + 2];
			if (key === 0) continue; // background
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}

		if (counts.size === 0) {
			clearSelection();
			return;
		}

		let bestKey = 0, bestCount = 0;
		for (const [key, count] of counts) {
			if (count > bestCount) { bestCount = count; bestKey = key; }
		}

		const hit = hitDecodeMap.get(bestKey);
		if (!hit) return;
		selectFeature(hit.layerId, hit.featureIndex, e.shiftKey);
	}

	function updateMarqueeSelection(addToExisting: boolean) {
		if (!marqueeStart || !marqueeCurrent || !projection) return;

		// Marquee bounds in canvas pixel coords.
		const x1 = Math.min(marqueeStart.x, marqueeCurrent.x);
		const y1 = Math.min(marqueeStart.y, marqueeCurrent.y);
		const x2 = Math.max(marqueeStart.x, marqueeCurrent.x);
		const y2 = Math.max(marqueeStart.y, marqueeCurrent.y);

		// Convert corners to geographic coordinates via the projection inverse.
		// Null is returned for points outside the projection domain (e.g. back of globe).
		const corners = (
			[[x1, y1], [x2, y1], [x1, y2], [x2, y2]] as [number, number][]
		).map((p) => projection!.invert!(p)).filter((c): c is [number, number] => c !== null);

		if (corners.length === 0) return;

		const geoX1 = Math.min(...corners.map((c) => c[0]));
		const geoX2 = Math.max(...corners.map((c) => c[0]));
		const geoY1 = Math.min(...corners.map((c) => c[1]));
		const geoY2 = Math.max(...corners.map((c) => c[1]));

		const newSelection = new Map<string, Set<number>>();

		for (const layer of layers) {
			if (!layer.visible || !layer.hasTopology) continue;
			const bboxes = cachedBboxes.get(layer.id);
			if (!bboxes) continue;

			const hits = new Set<number>();
			for (let i = 0; i < bboxes.length; i++) {
				const bbox = bboxes[i];
				if (!bbox) continue;
				const [minLon, minLat, maxLon, maxLat] = bbox;
				// Overlap: not separated on either axis.
				if (maxLon >= geoX1 && minLon <= geoX2 && maxLat >= geoY1 && minLat <= geoY2) {
					hits.add(i);
				}
			}
			if (hits.size > 0) newSelection.set(layer.id, hits);
		}

		if (addToExisting) {
			for (const [layerId, indices] of preDragSelection) {
				const existing = newSelection.get(layerId) ?? new Set<number>();
				for (const idx of indices) existing.add(idx);
				newSelection.set(layerId, existing);
			}
		}

		selection.features = newSelection;
	}

	function handlePointerDown(e: PointerEvent) {
		if (toolState.active === 'pan') {
			isDragging = true;
			lastPointerX = e.clientX;
			lastPointerY = e.clientY;
			if (interactionMode === 'rotate') {
				localRotate = [...projectionStore.rotate];
				lastBuiltRotate = [...projectionStore.rotate]; // reset so delta is measured from drag start
			}
			(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
		} else if (toolState.active === 'select' && containerEl) {
			const containerRect = containerEl.getBoundingClientRect();
			marqueePtrStartX = e.clientX;
			marqueePtrStartY = e.clientY;
			marqueeStart = { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };
			marqueeCurrent = { ...marqueeStart };
			preDragSelection = new Map([...selection.features.entries()].map(([k, v]) => [k, new Set(v)]));
			// Cache bboxes for all visible layers up front.
			cachedBboxes = new Map();
			for (const layer of layers) {
				if (!layer.visible || !layer.hasTopology) continue;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const topo = workingTopologyData.get(layer.id) as any;
				if (topo) cachedBboxes.set(layer.id, computeFeatureBboxes(topo));
			}
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		}
	}

	function handlePointerMove(e: PointerEvent) {
		// Promote pointerdown to marquee once the threshold is exceeded.
		if (marqueeStart && !isMarqueeDragging && !isDragging) {
			const dx = e.clientX - marqueePtrStartX;
			const dy = e.clientY - marqueePtrStartY;
			if (dx * dx + dy * dy > MARQUEE_THRESHOLD * MARQUEE_THRESHOLD) {
				isMarqueeDragging = true;
				hoveredFeature.value = null;
			}
		}

		// Update marquee rect and live selection.
		if (isMarqueeDragging && containerEl) {
			const containerRect = containerEl.getBoundingClientRect();
			marqueeCurrent = { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };
			updateMarqueeSelection(e.shiftKey);
			return;
		}

		if (toolState.active === 'select' && !isDragging && !isMarqueeDragging && hitCanvas && canvasEl) {
			const rect = canvasEl.getBoundingClientRect();
			const cx = Math.round(e.clientX - rect.left);
			const cy = Math.round(e.clientY - rect.top);
			const hctx = hitCanvas.getContext('2d');
			if (hctx) {
				// 5×5 sample with most-common-color, same as click — reduces
				// flickering on small features when zoomed out.
				const radius = 2;
				const size = radius * 2 + 1;
				const data = hctx.getImageData(cx - radius, cy - radius, size, size).data;
				const counts = new Map<number, number>();
				for (let i = 0; i < data.length; i += 4) {
					const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
					if (key === 0) continue;
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
				let bestKey = 0, bestCount = 0;
				for (const [key, count] of counts) {
					if (count > bestCount) { bestCount = count; bestKey = key; }
				}
				hoveredFeature.value = bestKey !== 0 ? (hitDecodeMap.get(bestKey) ?? null) : null;
			}
		}

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
		if (isMarqueeDragging) {
			isMarqueeDragging = false;
			suppressNextClick = true;
		}
		// Always reset marquee start, whether the drag exceeded the threshold or not.
		marqueeStart = null;
		marqueeCurrent = null;
		cachedBboxes = new Map();
		preDragSelection = new Map();

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

	// Parse a 6-digit hex string to [r, g, b], or null on failure.
	function hexToRgb(hex: string): [number, number, number] | null {
		const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
		return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
	}

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

	// Offscreen canvas for hit detection. Never mounted to the DOM.
	// Drawn in CSS pixels (no DPR scaling) so click coordinates map 1:1.
	let hitCanvas: HTMLCanvasElement | null = null;
	// Maps a packed RGB integer back to the layer/feature that owns that color.
	const hitDecodeMap = new Map<number, { layerId: string; featureIndex: number }>();

	// Bumped whenever the cache gains new entries. The paint effect reads
	// this so it knows to repaint after a path is computed.
	let cacheVersion = $state(0);

	// The projection object the cache was built for.
	// When it changes we invalidate all entries and recompute from scratch.
	let cachedProjection: d3.GeoProjection | null = null;

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
	// Incremented whenever the projection changes (rotation or type). Captured at
	// dispatch time so the .then() callback can detect if the projection moved on
	// while the build was in-flight and re-mark the layer stale for a fresh build.
	let projectionVersion = 0;
	// Tracks the topology object reference last sent to the worker per layer.
	// We compare by reference: if workingTopologyData is updated (post-pipeline),
	// the reference changes and we resend. Rotation-only changes skip the send entirely.
	const sentTopologyRefs = new Map<string, unknown>();

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

		// Projection changed — mark all cached paths as stale so
		// old paths stay visible during rebuild rather than flashing invisible.
		const currentProjId = projectionStore.id;
		if (projection !== cachedProjection) {
			for (const id of pathCache.keys()) stalePaths.add(id);
			// For rotation-only changes keep inFlightBuilds intact — at most one build
			// per layer in-flight at a time, preventing worker queue buildup during drag.
			const rotationOnly = projection !== cachedProjection && currentProjId === cachedProjectionId;
			if (!rotationOnly) {
				inFlightBuilds.clear();
				// Only invalidate in-flight builds when the projection type changes —
				// a result built for a slightly different rotation is
				// still a valid render and should display. Incrementing the epoch on every
				// throttle tick during drag means every ~950ms build completes stale and is
				// discarded, so the user never sees intermediate frames.
				pathBuildEpoch++;
			}
			projectionVersion++;
			cachedProjection = projection;
			cachedProjectionId = currentProjId;
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
			if (!activeIds.has(id)) {
				pathCache.delete(id);
				workerRemoveTopology(id);
				sentTopologyRefs.delete(id);
			}
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

		// Compute the rotation threshold gate once, outside the layer loop, so all
		// layers get the same decision. Previously this was checked per-layer: the first
		// layer to pass would update lastBuiltRotate, causing every subsequent layer to
		// see a zero delta and get skipped — only the top layer ever got intermediate frames.
		const skipRotation = (() => {
			if (!untrack(() => isDragging) || projectionEntry.interactionMode !== 'rotate') return false;
			const dλ = Math.abs(rotate[0] - lastBuiltRotate[0]);
			const dφ = Math.abs(rotate[1] - lastBuiltRotate[1]);
			return dλ < ROTATE_BUILD_THRESHOLD && dφ < ROTATE_BUILD_THRESHOLD;
		})();
		if (!skipRotation) lastBuiltRotate = [...rotate];

		for (const layer of currentLayers) {
			const { id } = layer;
			if (!layer.hasTopology) continue;
			if (pathCache.has(id) && !stalePaths.has(id)) continue; // fresh path, skip
			if (inFlightBuilds.has(id)) continue; // already building, avoid duplicate requests
			if (skipRotation) continue;

			const topo = workingTopologyData.get(id);
			if (!topo) continue;

			// Send topology to the worker only when it changes (new layer or post-pipeline
			// update). Compare by reference — workingTopologyData replaces the object when
			// the pipeline reruns, so a changed reference means new topology.
			if (sentTopologyRefs.get(id) !== topo) {
				workerStoreTopology(id, topo);
				sentTopologyRefs.set(id, topo);
			}

			const projVer = projectionVersion; // snapshot at dispatch time
			inFlightBuilds.add(id);
			workerBuildPaths(id, projId, w, h, rotate, { ...layer.processing })
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
					// If the projection changed while this build was in-flight (e.g. the
					// user kept rotating or released the pointer), re-mark stale so the
					// next effect run dispatches a fresh build for the current rotation.
					// Without this, layers that complete mid-drag clear their stale flag
					// and get stuck at an intermediate rotation after pointer-up.
					if (projVer !== projectionVersion) {
						stalePaths.add(id);
						staleBuildVersion++;
					}
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

	// Rebuild the hit-detection canvas whenever anything that affects the
	// rendered scene changes: new paths, pan/zoom, layer visibility, resize.
	// Drawn without DPR scaling so click pixel coords map directly to canvas pixels.
	$effect(() => {
		void cacheVersion;
		if (!width || !height) return;

		if (!hitCanvas) hitCanvas = document.createElement('canvas');
		hitCanvas.width = width;
		hitCanvas.height = height;

		const hctx = hitCanvas.getContext('2d');
		if (!hctx) return;

		// Reset to identity, clear, then set the same projection-space transform
		// as the main canvas (but without DPR — hit canvas lives in CSS pixels).
		hctx.setTransform(1, 0, 0, 1, 0, 0);
		hctx.clearRect(0, 0, width, height);
		hctx.setTransform(mapScale, 0, 0, mapScale, tx, ty);

		hitDecodeMap.clear();
		let colorIdx = 1;

		for (const layer of [...layers].reverse()) {
			if (!layer.visible) continue;
			const chunks = pathCache.get(layer.id);
			if (chunks === undefined) continue;

			const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
			const hasPoints   = layer.geometryTypes.some((t) => t === 'Point' || t === 'MultiPoint');

			if (hasNonPoint) {
				for (let fi = 0; fi < chunks.length; fi++) {
					const r = (colorIdx >> 16) & 0xff;
					const g = (colorIdx >> 8)  & 0xff;
					const b =  colorIdx        & 0xff;
					const color = `rgb(${r},${g},${b})`;
					hctx.fillStyle   = color;
					hctx.strokeStyle = color;
					// Minimum 4px stroke so thin lines stay clickable.
					hctx.lineWidth = Math.max(layer.style.strokeWidth, 4) / mapScale;
					hctx.fill(chunks[fi].path2d, 'evenodd');
					hctx.stroke(chunks[fi].path2d);
					hitDecodeMap.set(colorIdx, { layerId: layer.id, featureIndex: fi });
					colorIdx++;
				}
			}

			if (hasPoints) {
				const proj = untrack(() => projection);
				if (!proj) continue;

				const topo = workingTopologyData.get(layer.id);
				const objectName = topo ? Object.keys(topo.objects)[0] : null;
				const data = topo && objectName
					? feature(topo, topo.objects[objectName]) as { features?: { geometry?: { type?: string; coordinates?: unknown } }[] }
					: undefined;
				if (!data?.features) continue;

				const projCenter: [number, number] | null = interactionMode === 'rotate'
					? [-projectionStore.rotate[0], -projectionStore.rotate[1]]
					: null;

				for (let fi = 0; fi < data.features.length; fi++) {
					const geom = data.features[fi]?.geometry;
					if (!geom) continue;
					const coordsList: [number, number][] =
						geom.type === 'Point'      ? [geom.coordinates as [number, number]]
						: geom.type === 'MultiPoint' ? (geom.coordinates as [number, number][])
						: [];

					const r = (colorIdx >> 16) & 0xff;
					const g = (colorIdx >> 8)  & 0xff;
					const b =  colorIdx        & 0xff;
					hctx.fillStyle = `rgb(${r},${g},${b})`;

					for (const coord of coordsList) {
						if (projCenter && d3.geoDistance(coord, projCenter) >= Math.PI / 2) continue;
						const pt = proj(coord);
						if (!pt) continue;
						// Draw a square hit target; 6 CSS px radius looks up by mapScale.
						const hitR = 6 / mapScale;
						hctx.fillRect(pt[0] - hitR, pt[1] - hitR, hitR * 2, hitR * 2);
					}

					hitDecodeMap.set(colorIdx, { layerId: layer.id, featureIndex: fi });
					colorIdx++;
				}
			}
		}
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

	// Global keyboard shortcuts.
	$effect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			// Don't intercept when focus is in a text field.
			const tag = (e.target as Element | null)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			if (e.key === 'v' || e.key === 'V') {
				toolState.active = 'pan';
			} else if (e.key === 's' || e.key === 'S') {
				toolState.active = 'select';
			} else if (e.key === 'Escape') {
				clearSelection();
				toolState.active = 'pan';
			} else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.features.size > 0) {
				e.preventDefault();
				const snapshot = new Map([...selection.features.entries()].map(([k, v]) => [k, new Set(v)]));
				clearSelection();
				let remaining = snapshot.size;
				for (const [layerId, indices] of snapshot) {
					deleteSelectedFeatures(layerId, indices, () => {
						remaining--;
						if (remaining === 0) pushSnapshot();
					});
				}
			} else if ((e.key === 'e' || e.key === 'E') && selection.features.size > 0) {
				e.preventDefault();
				const snapshot = new Map([...selection.features.entries()].map(([k, v]) => [k, new Set(v)]));
				clearSelection();
				if (snapshot.size > 1) {
					mergeSelectedFeatures(snapshot, () => pushSnapshot());
				} else {
					const [layerId, indices] = [...snapshot.entries()][0];
					extractSelectedFeatures(layerId, indices, () => pushSnapshot());
				}
			}
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
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

	// Keep the mapView store in sync with the current viewport so the projection
	// details panel and minimap always show up-to-date center/extent.
	// Runs on any change to projection, pan, zoom, or canvas size.
	$effect(() => {
		mapView.mapScale = mapScale;

		if (!projection || !width || !height) {
			mapView.center = null;
			mapView.extent = null;
			return;
		}

		// Convert a canvas pixel (cx, cy) to geographic [lon, lat] by inverting the
		// tx/ty/mapScale transform and then inverting the projection itself.
		// Returns RAW (un-normalised) longitude so the caller can measure true span.
		function canvasToGeo(cx: number, cy: number): [number, number] | null {
			const px = (cx - tx) / mapScale;
			const py = (cy - ty) / mapScale;
			return projection!.invert?.([px, py]) ?? null;
		}

		// Normalise a longitude to [-180, 180].
		function normLon(lon: number): number {
			return ((lon + 180) % 360 + 360) % 360 - 180;
		}

		// Geographic center of the viewport.
		const c = canvasToGeo(width / 2, height / 2);
		mapView.center = c ? [+normLon(c[0]).toFixed(1), +c[1].toFixed(1)] : null;

		// Geographic extent — rotate mode (globe projections).
		//
		// Sample points along the canvas perimeter and invert them to geographic
		// coordinates. At mapScale > 1 the hemisphere circle is larger than the
		// canvas, so all perimeter points are guaranteed to be within the visible
		// hemisphere (projection.invert returns null only for out-of-hemisphere points).
		// At mapScale ≤ 1 the full hemisphere (or more) is visible — no bounded
		// rectangular extent makes sense, so we leave it null.
		if (interactionMode === 'rotate') {
			if (mapScale <= 1) {
				mapView.extent = null;
				return;
			}
			const centerLon = normLon(-projectionStore.rotate[0]);
			const lats: number[] = [];
			const dLons: number[] = [];
			const N = 10; // samples per edge
			for (let i = 0; i <= N; i++) {
				const t = i / N;
				const pts: Array<[number, number]> = [
					[t * width, 0],      // top edge
					[t * width, height], // bottom edge
					[0, t * height],     // left edge
					[width, t * height], // right edge
				];
				for (const [cx, cy] of pts) {
					const geo = canvasToGeo(cx, cy);
					if (!geo) continue;
					lats.push(geo[1]);
					dLons.push(normLon(geo[0] - centerLon));
				}
			}
			if (lats.length < 4) {
				mapView.extent = null;
				return;
			}
			const south   = +Math.max(-90,  Math.min(...lats)).toFixed(1);
			const north   = +Math.min( 90,  Math.max(...lats)).toFixed(1);
			const westLon = +normLon(centerLon + Math.min(...dLons)).toFixed(1);
			let   eastLon = +normLon(centerLon + Math.max(...dLons)).toFixed(1);
			if (eastLon === -180) eastLon = 180;
			mapView.extent = [westLon, south, eastLon, north];
			return;
		}

		// Geographic extent — pan mode (flat projections).
		//
		// Find where the world's geographic edges (lon ±180°) appear on the canvas,
		// then clip them to the visible area. The extent box shrinks naturally as the
		// world edges slide off screen — no wrapping or antimeridian special-casing needed.
		const westWorldPt = projection([-180, 0]);
		const eastWorldPt = projection([ 180, 0]);
		if (!westWorldPt || !eastWorldPt) {
			mapView.extent = null;
			return;
		}

		// Convert projection coordinates to canvas coordinates.
		const westWorldCanvasX = westWorldPt[0] * mapScale + tx;
		const eastWorldCanvasX = eastWorldPt[0] * mapScale + tx;

		// Clip world edges to visible canvas.
		const visWestCanvasX = Math.max(0, westWorldCanvasX);
		const visEastCanvasX = Math.min(width, eastWorldCanvasX);

		// If the entire world has scrolled off screen, show nothing.
		if (visEastCanvasX <= visWestCanvasX) {
			mapView.extent = null;
			return;
		}

		// Invert the clipped edge positions back to geographic coords.
		const projY      = (height / 2 - ty) / mapScale;
		const visWestGeo = projection.invert?.([(visWestCanvasX - tx) / mapScale, projY]);
		const visEastGeo = projection.invert?.([(visEastCanvasX - tx) / mapScale, projY]);
		if (!visWestGeo || !visEastGeo) {
			mapView.extent = null;
			return;
		}

		// Latitude from the vertical centre line — no wrapping issues for lat.
		const topGeo    = canvasToGeo(width / 2, 0);
		const bottomGeo = canvasToGeo(width / 2, height);
		const south = bottomGeo ? +Math.max(-90, Math.min(90, bottomGeo[1])).toFixed(1) : -90;
		const north = topGeo    ? +Math.max(-90, Math.min(90, topGeo[1])).toFixed(1)    : 90;

		// normLon maps to [-180, 180). For the east edge we want (-180, 180] —
		// when the east world edge is exactly lon 180°, normLon returns -180, which
		// makes the box width appear as zero. Flip that specific case to +180.
		const westLon = +normLon(visWestGeo[0]).toFixed(1);
		let eastLon   = +normLon(visEastGeo[0]).toFixed(1);
		if (eastLon === -180) eastLon = 180;

		mapView.extent = [westLon, south, eastLon, north];
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

		if (canvasStyles.background.enabled) {
			ctx.globalAlpha = canvasStyles.background.alpha;
			ctx.fillStyle = canvasStyles.background.hex;
			ctx.fillRect(0, 0, width, height);
			ctx.globalAlpha = 1;
		}

		// Drop shadow — drawn in screen space so it sits naturally behind the globe.
		// Must come before ctx.translate/scale so coordinates are in CSS pixels.
		if (isGlobe && canvasStyles.shadow.enabled && projection) {
			const intensity = canvasStyles.shadow.intensity;
			const globeR    = Math.min(width, height) / 2 * mapScale;
			ctx.save();
			ctx.filter = `blur(${Math.max(6, globeR * 0.06)}px)`;
			ctx.beginPath();
			ctx.ellipse(
				width / 2,
				height / 2 + globeR,  // centred at the bottom edge of the globe
				globeR * 0.75,
				globeR * 0.05,
				0, 0, Math.PI * 2,
			);
			ctx.fillStyle = `rgba(0,0,0,${(intensity * 0.55).toFixed(3)})`;
			ctx.fill();
			ctx.restore();
		}

		ctx.translate(tx, ty);
		ctx.scale(mapScale, mapScale);

		// Atmospheric halo — drawn in projection space before the globe disk so the
		// ocean fill covers the interior and leaves only the glowing ring at the rim.
		if (isGlobe && canvasStyles.halo.enabled && projection) {
			const { hex, alpha } = canvasStyles.halo;
			const rgb = hexToRgb(hex);
			if (rgb) {
				const [r, g, b] = rgb;
				const globeRProj = Math.min(width, height) / 2;
				const cx         = width / 2;
				const cy         = height / 2;
				// Width of the halo ring in screen pixels, converted to projection units.
				const haloW  = 28 / mapScale;
				const innerR = globeRProj * 0.85;
				const outerR = globeRProj + haloW;
				// Fraction along the gradient where the halo colour peaks (at the globe rim).
				const peakFrac = (globeRProj - innerR) / (outerR - innerR);
				const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
				grad.addColorStop(0,        `rgba(${r},${g},${b},0)`);
				grad.addColorStop(peakFrac, `rgba(${r},${g},${b},${alpha})`);
				grad.addColorStop(1,        `rgba(${r},${g},${b},0)`);
				ctx.beginPath();
				ctx.arc(cx, cy, outerR, 0, 2 * Math.PI);
				ctx.fillStyle = grad;
				ctx.fill();
			}
		}

		// Draw the globe disk (ocean fill + rim outline) when in globe mode.
		if (isGlobe && projection) {
			const spherePathStr = d3.geoPath(projection)({ type: 'Sphere' });
			if (spherePathStr) {
				const spherePath = new Path2D(spherePathStr);
				const css = getComputedStyle(canvasEl!);

				// Ocean fill — only when enabled in globe styles.
				if (canvasStyles.ocean.enabled) {
					const { hex, alpha } = canvasStyles.ocean;
					const rgb = hexToRgb(hex);
					ctx.fillStyle = rgb
						? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
						: hex;
					ctx.fill(spherePath);
				}

				// Rim outline
				ctx.strokeStyle = css.getPropertyValue('--color-border').trim();
				ctx.lineWidth = 1 / mapScale;
				ctx.stroke(spherePath);
			}
		}

		// Graticule — works for all projection types; d3 clips lines to the
		// visible hemisphere automatically for globe projections.
		if (canvasStyles.graticule.enabled && projection) {
			const { hex, alpha, step } = canvasStyles.graticule;
			const rgb = hexToRgb(hex);
			const graticulePath = d3.geoPath(projection)(d3.geoGraticule().step([step, step])());
			if (graticulePath) {
				ctx.beginPath();
				ctx.strokeStyle = rgb
					? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
					: hex;
				ctx.lineWidth = 0.5 / mapScale;
				ctx.setLineDash([]);
				ctx.globalAlpha = 1;
				ctx.stroke(new Path2D(graticulePath));
			}
		}

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

				ctx.strokeStyle = layer.style.stroke;
				ctx.lineWidth = layer.style.strokeWidth / mapScale;
				if (layer.style.strokeDashed) {
					ctx.setLineDash([layer.style.strokeDash / mapScale, layer.style.strokeGap / mapScale]);
				}

				for (let ci = 0; ci < chunks.length; ci++) {
					const { path2d, bbox } = chunks[ci];
					const [xMin, yMin, xMax, yMax] = bbox;
					if (xMax < vxMin || xMin > vxMax || yMax < vyMin || yMin > vyMax) continue;

					if (layer.style.fill !== 'none') {
						ctx.globalAlpha = layer.style.fillOpacity;
						ctx.fillStyle = layer.style.fill;
						ctx.fill(path2d, 'evenodd');
					}
					ctx.globalAlpha = layer.style.strokeOpacity;
					ctx.stroke(path2d);
				}
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

							// For rotate-mode projections (globe etc.), projection(coord) bypasses
							// d3's stream preclip and returns valid coordinates even for back-
							// hemisphere points. Check visibility explicitly before projecting.
							const projCenter: [number, number] | null = interactionMode === 'rotate'
								? [-projectionStore.rotate[0], -projectionStore.rotate[1]]
								: null;

							for (const coord of coordsList) {
								if (projCenter && d3.geoDistance(coord, projCenter) >= Math.PI / 2) continue;
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

		ctx.globalAlpha = 1;
		ctx.setLineDash([]);

		// Read CSS tokens once per paint frame so highlight colors stay in sync
		// with the design system without hardcoding values.
		const highlightCss    = getComputedStyle(canvasEl!);
		const accentColor     = highlightCss.getPropertyValue('--color-accent').trim();
		const surfaceSecColor = highlightCss.getPropertyValue('--color-surface-secondary').trim();
		const borderColor     = highlightCss.getPropertyValue('--color-border').trim();

		// Hover pass — weight/size change only, original colors preserved.
		if (toolState.active === 'select' && hoveredFeature.value) {
			const isSelected = selection.features.get(hoveredFeature.value.layerId)?.has(hoveredFeature.value.featureIndex) ?? false;
			if (!isSelected) {
				drawFeatureHighlight(
					ctx,
					hoveredFeature.value.layerId,
					hoveredFeature.value.featureIndex,
					surfaceSecColor,  // polygon fill overlay (grey tint)
					'',               // ignored — useLayerStyle reads layer.style.stroke
					0.5,              // polygon fill opacity
					3 / mapScale,     // thicker stroke for lines/outlines
					2,                // point extraRadius
					true,             // useLayerStyle — keep original stroke/point colors
				);
			}
		}

		// Selection pass — accent green, thicker strokes, bigger points.
		for (const [layerId, featureIndices] of selection.features) {
			for (const fi of featureIndices) {
				drawFeatureHighlight(
					ctx,
					layerId,
					fi,
					accentColor,
					accentColor,
					0.25,         // polygon fill opacity
					4 / mapScale, // noticeably thick for lines
					5,            // point extraRadius — dot itself gets bigger
				);
			}
		}

	});
</script>

<div class="map-canvas" bind:this={containerEl}>
	<div class="bottom-center">
		<SelectionBar />
		<MapToolbar />
	</div>

	<div class="bottom-right-stack">
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
		<Toaster />
	</div>

	{#if isMarqueeDragging && marqueeStart && marqueeCurrent}
	<div
		class="marquee"
		style:left="{Math.min(marqueeStart.x, marqueeCurrent.x)}px"
		style:top="{Math.min(marqueeStart.y, marqueeCurrent.y)}px"
		style:width="{Math.abs(marqueeCurrent.x - marqueeStart.x)}px"
		style:height="{Math.abs(marqueeCurrent.y - marqueeStart.y)}px"
	></div>
	{/if}

	<canvas
		bind:this={canvasEl}
		class:dragging={isDragging}
		class:select-mode={toolState.active === 'select'}
		class:feature-hover={toolState.active === 'select' && hoveredFeature.value !== null}
		onclick={handleClick}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointerleave={() => { hoveredFeature.value = null; }}
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

	canvas.select-mode {
		cursor: default;
	}

	canvas.feature-hover {
		cursor: pointer;
	}

	.marquee {
		position: absolute;
		border: 1.5px solid var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		pointer-events: none;
		z-index: 5;
	}

	.bottom-center {
		position: absolute;
		bottom: var(--space-m);
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}

	.zoom-controls {
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
