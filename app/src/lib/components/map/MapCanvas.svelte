<script lang="ts">
	import { untrack } from 'svelte';
	import * as d3 from 'd3-geo';
	import * as d3shape from 'd3-shape';
	import * as d3gp from 'd3-geo-projection';
	import { feature } from 'topojson-client';
	import { workerBuildPaths, workerStoreTopology, workerRemoveTopology } from '$lib/workers/geoWorker';
	import type { PathCommand } from '$lib/workers/types';
	import type { LayerProcessing } from '$lib/types';
	import { layers, workingTopologyData, layerDrag, deleteSelectedFeatures, extractSelectedFeatures, mergeSelectedFeatures } from '$lib/stores/layers.svelte';
	import { toolState } from '$lib/stores/tool.svelte';
	import { selection, selectFeature, clearSelection } from '$lib/stores/selection.svelte';
	import { layerSelection, clearLayerSelection, selectLayer, toggleLayerSelection, enterLayer, exitLayer, setHoveredLayer } from '$lib/stores/layerSelection.svelte';
	import { hoveredFeature } from '$lib/stores/hoveredFeature.svelte';
	import { startEditing, editSession, confirmBake, cancelBake, exitEditing, cancelEditing, getDraft, getDirtyFeatures, vertexDragTargets, translateGroup, rebuildNodeMap, recordMoves, beginInsert, commitInsert, selectVertex, toggleVertex, isVertexSelected, getSelectedVertices, clearVertexSelection, deleteSelectedVertices, getPointCoord, translatePoints, recordPointMoves, setVertexSelection, type DragMember, type PointMember } from '$lib/stores/editSession.svelte';
	import { featureArcIndices } from '$lib/utils/topology';
	import { drawSession, getCommitted, getActivePath, placeVertex, finishActive, finishActiveFromDoubleClick, enterDraw, escapeDraw, commitDraw, resetDrawTarget, cancelPicking, setDrawDensifier } from '$lib/stores/drawSession.svelte';
	import { buildBezierArcs, arcRingToPath } from '$lib/utils/bezier';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { mapState } from '$lib/stores/mapState.svelte';
	import { mapView } from '$lib/stores/mapView.svelte';
	import { canvasStyles } from '$lib/stores/canvasStyles.svelte';
	import { stylePanel } from '$lib/stores/stylePanel.svelte';
	import { PROJECTIONS } from '$lib/config';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import MapToolbar from '$lib/components/map/MapToolbar.svelte';
	import SelectionBar from '$lib/components/map/SelectionBar.svelte';
	import DrawBar from '$lib/components/map/DrawBar.svelte';
	import EditSessionBar from '$lib/components/map/EditSessionBar.svelte';
	import LayerActionBar from '$lib/components/map/LayerActionBar.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import FeaturesTable from '$lib/components/map/FeaturesTable.svelte';
	import { MagnifyingGlassPlus, MagnifyingGlassMinus, CornersOut } from 'phosphor-svelte';
	import { computeFeatureBboxes } from '$lib/utils/featureBbox';
	import { featuresTable } from '$lib/stores/featuresTable.svelte';
	import { clipBbox, setClipBbox } from '$lib/stores/clipBbox.svelte';

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
	let spacePanning = $state(false); // Space held in select mode → temporary pan
	// Cursor position (CSS px, canvas-relative) while drawing a line/polygon, for the
	// rubber-band preview from the last placed vertex. Null when not applicable.
	let drawHover = $state<{ x: number; y: number } | null>(null);
	let metaHeld = $state(false);     // Cmd/Ctrl held → marquee mode in edit (no marker/feature cursor)
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
	let panMoved = false;
	let preDragSelection = new Map<string, Set<number>>();
	let preDragLayerIds: string[] = [];
	let marqueeLayerMode = false;
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
		const layer = layers.find((l) => l.id === layerId);

		// Resolve the polygon/line path to highlight. Normal layers use the per-feature
		// cache chunk; bezier layers cache as one whole-layer chunk, so we build a straight
		// per-feature outline from the working topology instead (selection feedback shows
		// the unsmoothed shape — see the on-screen note).
		let highlightPath: Path2D | undefined;
		if (layer?.processing.bezierEnabled && projection) {
			const topo = workingTopologyData.get(layerId);
			const objName = topo ? Object.keys(topo.objects)[0] : null;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const geom = topo && objName ? (topo.objects[objName] as any).geometries[featureIndex] : null;
			if (geom && geom.type !== 'Point' && geom.type !== 'MultiPoint') {
				const pathStr = d3.geoPath(projection)(feature(topo!, geom));
				if (pathStr) highlightPath = new Path2D(pathStr);
			}
		} else {
			highlightPath = pathCache.get(layerId)?.[featureIndex]?.path2d;
		}

		if (highlightPath) {
			const hasPolygons = layer?.geometryTypes.some(
				(t) => t === 'Polygon' || t === 'MultiPolygon'
			) ?? false;
			const strokeColor = useLayerStyle ? (layer?.style.stroke ?? strokeHex) : strokeHex;
			ctx.strokeStyle = strokeColor;
			ctx.lineWidth   = lineWidth;
			if (hasPolygons) {
				ctx.globalAlpha = fillOpacity;
				ctx.fillStyle   = fillHex;
				ctx.fill(highlightPath, 'evenodd');
				ctx.globalAlpha = 1;
			}
			ctx.stroke(highlightPath);
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

	function getHitAtPoint(clientX: number, clientY: number): { layerId: string; featureIndex: number } | null {
		if (!hitCanvas || !canvasEl) return null;
		const rect = canvasEl.getBoundingClientRect();
		const cx = Math.round(clientX - rect.left);
		const cy = Math.round(clientY - rect.top);
		const hctx = hitCanvas.getContext('2d');
		if (!hctx) return null;

		// Sample a 5×5 area centered on the click to handle sub-pixel misses on thin
		// lines and small points, then pick the most common non-background color.
		const radius = 2;
		const size = radius * 2 + 1;
		const imageData = hctx.getImageData(cx - radius, cy - radius, size, size);
		const counts = new Map<number, number>();
		for (let i = 0; i < imageData.data.length; i += 4) {
			const key = (imageData.data[i] << 16) | (imageData.data[i + 1] << 8) | imageData.data[i + 2];
			if (key === 0) continue;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		if (counts.size === 0) return null;
		let bestKey = 0, bestCount = 0;
		for (const [key, count] of counts) {
			if (count > bestCount) { bestCount = count; bestKey = key; }
		}
		return hitDecodeMap.get(bestKey) ?? null;
	}

	// --- Vertex editing: hit-testing + drag ---------------------------------
	const VERTEX_HIT_RADIUS = 12; // px — generous grab buffer so border vertices are easy to
	                              // catch without the click falling through to a neighbour feature

	// The vertex group currently being dragged, or null. `group` holds one member per
	// selected vertex (each with its node-fanned targets + origin); `from` is the grabbed
	// vertex's origin (delta vs the cursor drives the translation). `insert` marks a drag
	// that began by inserting a new vertex (committed as one op).
	let vertexDrag = $state<{
		group: DragMember[];
		from: [number, number];
		insert?: { arcIndex: number; atIndex: number };
	} | null>(null);
	// Point-feature (group) drag — points store coords directly, not in arcs. `from` is the
	// grabbed point's origin; the delta vs the cursor drives the group translation.
	let pointDrag = $state<{ group: PointMember[]; from: [number, number] } | null>(null);
	// Currently hovered point + the selected point set (for marker styling). Keyed "fi:pi".
	let hoveredPoint = $state<string | null>(null);
	let selectedPoints = $state<Set<string>>(new Set());
	const ptKey = (fi: number, pi: number) => `${fi}:${pi}`;
	// Currently hovered arc vertex, keyed "arcIndex:vertexIndex" (drives the marker hover state).
	let hoveredVertexKey = $state<string | null>(null);

	const MARKER_RADIUS = 4;
	// Blends a CSS color toward white by `amt` (0–1) — used to lighten markers on hover.
	function lightenColor(color: string, amt: number): string {
		let r: number, g: number, b: number;
		if (color[0] === '#') {
			const h = color.slice(1);
			const f = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
			r = parseInt(f.slice(0, 2), 16); g = parseInt(f.slice(2, 4), 16); b = parseInt(f.slice(4, 6), 16);
		} else {
			const m = color.match(/[\d.]+/g);
			if (!m || m.length < 3) return color;
			r = +m[0]; g = +m[1]; b = +m[2];
		}
		const mix = (x: number) => Math.round(x + (255 - x) * amt);
		return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
	}

	// Draws one edit marker. Default: white dot + accent ring. Hover: enlarged + lightened.
	// Selected: accent dot (enlarged) with the white outline pushed OUTSIDE so it reads full
	// size rather than shrinking the dot.
	function drawMarker(c: CanvasRenderingContext2D, sx: number, sy: number, sel: boolean, hov: boolean, accent: string): void {
		const r = MARKER_RADIUS + (sel ? 1 : 0) + (hov ? 1 : 0);
		c.globalAlpha = 1;
		if (sel) {
			c.fillStyle = hov ? lightenColor(accent, 0.3) : accent;
			c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
			c.strokeStyle = '#ffffff'; c.lineWidth = 1.5;
			c.beginPath(); c.arc(sx, sy, r + 0.75, 0, Math.PI * 2); c.stroke(); // outside the fill
		} else {
			c.fillStyle = '#ffffff';
			c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
			c.strokeStyle = hov ? lightenColor(accent, 0.3) : accent; c.lineWidth = 1.5;
			c.stroke();
		}
	}
	// Whether the cursor is hovering a draggable vertex (drives the grab cursor).
	let overVertex = $state(false);
	// Hovered edge where a new vertex can be inserted; the ghost marker sits at its midpoint.
	let insertHover = $state<{ arcIndex: number; atIndex: number; geo: [number, number] } | null>(null);
	// Whether the cursor is directly over the ghost point (active state — click to insert).
	let overInsertGhost = $state(false);

	// The insert ghost's position (insertHover.geo) is captured from the draft at hover time
	// and only refreshed on pointermove. A draft mutation (e.g. deleting a vertex) bumps
	// editSession.version but leaves insertHover pointing at the now-stale pre-edit segment, so
	// the ghost can render on the old line. Drop it whenever the draft changes — it reappears
	// fresh on the next pointermove via hitEdge. Skip while an insert-drag is in flight so we
	// don't cancel the active insertion.
	$effect(() => {
		void editSession.version;
		if (untrack(() => vertexDrag?.insert)) return;
		insertHover = null;
	});
	const EDGE_HIT_RADIUS = 8;   // px — how close to a segment shows the ghost
	const GHOST_HOVER_RADIUS = 7; // px — how close to the ghost point activates it

	// True when hover/selection feedback is showing the straight (unsmoothed) outline of a
	// bezier-smoothed layer — drives the on-screen note. Bezier layers can't be highlighted
	// per feature from the smoothed cache, so highlights fall back to the straight shape.
	let bezierNoteDismissed = $state(false);
	const showBezierOutlineNote = $derived.by(() => {
		if (bezierNoteDismissed) return false;
		// Only in select/edit mode — switching to pan dismisses it.
		if (toolState.active !== 'select' && toolState.active !== 'edit') return false;
		if (editSession.activeLayerId !== null) return false; // editing shows the live curve
		const isBez = (id: string | null | undefined) =>
			!!layers.find((l) => l.id === id)?.processing.bezierEnabled;
		if (hoveredFeature.value && isBez(hoveredFeature.value.layerId)) return true;
		for (const layerId of selection.features.keys()) if (isBez(layerId)) return true;
		if (isBez(layerSelection.hoveredLayerId)) return true;
		for (const id of layerSelection.ids) if (isBez(id)) return true;
		return false;
	});
	// rAF throttle for vertex drags: the latest pointer position, applied once per frame.
	let pendingDragGeo: [number, number] | null = null;
	let dragRafId: number | null = null;

	// Inverse of the projection + pan/zoom transform: a screen point → [lon, lat].
	function screenToGeo(clientX: number, clientY: number): [number, number] | null {
		if (!projection || !canvasEl) return null;
		const rect = canvasEl.getBoundingClientRect();
		const px = (clientX - rect.left - tx) / mapScale;
		const py = (clientY - rect.top - ty) / mapScale;
		return projection.invert?.([px, py]) ?? null;
	}

	// Densifies a lon/lat polyline so each edge stays straight on the CURRENT projection.
	// Projection space is affine to screen, so lerping between the projected endpoints traces
	// the screen-straight line; inverting the samples gives lon/lat points that re-trace it.
	// Endpoints are kept exact (the originals); only interiors are sampled. Registered with the
	// draw session so the commit can bake straight edges in (the WYSIWYG behaviour).
	function densifyForCommit(coords: readonly [number, number][]): [number, number][] {
		if (!projection || coords.length < 2) return coords.map((c) => [c[0], c[1]]);
		const inv = projection.invert;
		const out: [number, number][] = [];
		for (let i = 0; i < coords.length - 1; i++) {
			const a = coords[i];
			const b = coords[i + 1];
			out.push([a[0], a[1]]);
			const pa = projection(a as [number, number]);
			const pb = projection(b as [number, number]);
			if (pa && pb && inv) {
				const dx = pb[0] - pa[0];
				const dy = pb[1] - pa[1];
				const screenLen = Math.hypot(dx, dy) * mapScale;
				const k = Math.min(64, Math.max(1, Math.round(screenLen / 8)));
				for (let s = 1; s < k; s++) {
					const t = s / k;
					const g = inv([pa[0] + dx * t, pa[1] + dy * t]);
					if (g) out.push([g[0], g[1]]);
				}
			}
		}
		const lastC = coords[coords.length - 1];
		out.push([lastC[0], lastC[1]]);
		return out;
	}
	setDrawDensifier(densifyForCommit);

	// Nearest draft vertex of the targeted feature within VERTEX_HIT_RADIUS, or null.
	function hitVertex(clientX: number, clientY: number): { arcIndex: number; vertexIndex: number } | null {
		const draft = getDraft();
		if (!draft || !projection || !canvasEl) return null;
		const rect = canvasEl.getBoundingClientRect();
		const mx = clientX - rect.left;
		const my = clientY - rect.top;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const arcs = (draft as any).arcs as number[][][];
		const arcIndices = featureArcIndices(draft, editSession.featureIndex);
		const stride = markerStride(); // only the drawn (decimated) vertices are grabbable

		let best: { arcIndex: number; vertexIndex: number } | null = null;
		let bestDist = VERTEX_HIT_RADIUS * VERTEX_HIT_RADIUS;
		for (const ai of arcIndices) {
			const arc = arcs[ai];
			if (!arc) continue;
			for (let vi = 0; vi < arc.length; vi += stride) {
				const p = projection(arc[vi] as [number, number]);
				if (!p) continue;
				const sx = p[0] * mapScale + tx;
				const sy = p[1] * mapScale + ty;
				// Cheap reject before the distance math: only vertices near the cursor.
				if (Math.abs(sx - mx) > VERTEX_HIT_RADIUS || Math.abs(sy - my) > VERTEX_HIT_RADIUS) continue;
				const dx = sx - mx;
				const dy = sy - my;
				const d = dx * dx + dy * dy;
				if (d < bestDist) { bestDist = d; best = { arcIndex: ai, vertexIndex: vi }; }
			}
		}
		return best;
	}

	// Current draft coordinate of a vertex.
	function vertexCoord(arcIndex: number, vertexIndex: number): [number, number] | null {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const arc = ((getDraft() as any)?.arcs as number[][][] | undefined)?.[arcIndex];
		const c = arc?.[vertexIndex];
		return c ? [c[0], c[1]] : null;
	}

	// A drag member for a vertex: its node-fanned targets plus its origin coordinate.
	function dragMemberFor(arcIndex: number, vertexIndex: number): DragMember | null {
		const orig = vertexCoord(arcIndex, vertexIndex);
		if (!orig) return null;
		return { targets: vertexDragTargets(arcIndex, vertexIndex), orig };
	}

	// Arrow-key nudge: shift the current vertex/point selection by a screen-pixel offset.
	// The pixel offset is converted to a geographic delta at the reference coordinate (via
	// project → offset → invert) so the on-screen movement is consistent at any zoom, and
	// reuses the same translate/record path as a drag, so each press is one undoable step.
	function nudgeSelection(dx: number, dy: number): void {
		if (!projection) return;

		// Pixel offset at refGeo → geographic delta.
		function geoDelta(refGeo: [number, number]): [number, number] | null {
			const p = projection!(refGeo);
			if (!p) return null;
			const moved = projection!.invert?.([p[0] + dx / mapScale, p[1] + dy / mapScale]);
			if (!moved) return null;
			return [moved[0] - refGeo[0], moved[1] - refGeo[1]];
		}

		// Point layers move selected points; line/polygon layers move selected vertices.
		if (selectedPoints.size > 0) {
			const group: PointMember[] = [...selectedPoints].map((k) => {
				const [fi, pi] = k.split(':').map(Number);
				return { featureIndex: fi, pointIndex: pi, orig: getPointCoord(fi, pi) ?? [0, 0] };
			});
			const d = geoDelta(group[0].orig);
			if (!d) return;
			translatePoints(group, d[0], d[1]);
			recordPointMoves(group);
			return;
		}

		const group = getSelectedVertices()
			.map((v) => dragMemberFor(v.arcIndex, v.vertexIndex))
			.filter((m): m is DragMember => m !== null);
		if (group.length === 0) return;
		const d = geoDelta(group[0].orig);
		if (!d) return;
		translateGroup(group, d[0], d[1]);
		recordMoves(group);
		rebuildNodeMap();
	}

	// Marker decimation. While zoomed out, the targeted feature's markers are thinned to
	// every Nth vertex (kept ~MARKER_TARGET_SPACING px apart) so a detailed feature stays
	// fast and isn't an unusable blur. Once vertices are naturally that far apart on screen
	// — a scale where you'd actually edit — the stride is 1 and the marker set stops shifting.
	//
	// The decision is driven by the *real* on-screen spacing of vertices that are currently
	// in view, measured by sampling ~MARKER_SPACING_SAMPLES consecutive pairs and projecting
	// them. This is far more accurate than a bbox proxy (which underestimates spacing badly
	// for very wiggly boundaries, leaving huge features still decimating when zoomed in), yet
	// still cheap — a fixed sample, not every vertex.
	const MARKER_TARGET_SPACING = 6; // px between drawn markers; at/above this on screen, show all
	const MARKER_SPACING_SAMPLES = 64;
	function markerStride(): number {
		const draft = getDraft();
		if (!draft || !projection || !editSession.activeLayerId) return 1;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const arcs = (draft as any).arcs as number[][][];
		const arcIndices = featureArcIndices(draft, editSession.featureIndex);

		let total = 0;
		for (const ai of arcIndices) total += arcs[ai]?.length ?? 0;
		if (total < 2) return 1;
		const step = Math.max(1, Math.floor(total / MARKER_SPACING_SAMPLES));

		// Sample consecutive-pair distances; prefer pairs in the viewport (the density you
		// actually see), falling back to all sampled pairs if too few are visible.
		let sumVis = 0, nVis = 0, sumAll = 0, nAll = 0, counter = 0;
		for (const ai of arcIndices) {
			const arc = arcs[ai];
			if (!arc || arc.length < 2) continue;
			for (let vi = 0; vi < arc.length - 1; vi++) {
				if (counter++ % step !== 0) continue;
				const a = projection(arc[vi] as [number, number]);
				const b = projection(arc[vi + 1] as [number, number]);
				if (!a || !b) continue;
				const ax = a[0] * mapScale + tx, ay = a[1] * mapScale + ty;
				const bx = b[0] * mapScale + tx, by = b[1] * mapScale + ty;
				const d = Math.hypot(ax - bx, ay - by);
				sumAll += d; nAll++;
				const inView = (ax >= 0 && ax <= width && ay >= 0 && ay <= height)
					|| (bx >= 0 && bx <= width && by >= 0 && by <= height);
				if (inView) { sumVis += d; nVis++; }
			}
		}
		const spacing = nVis >= 8 ? sumVis / nVis : (nAll > 0 ? sumAll / nAll : MARKER_TARGET_SPACING);
		if (spacing >= MARKER_TARGET_SPACING) return 1;
		return Math.max(1, Math.round(MARKER_TARGET_SPACING / spacing));
	}

	// Live bezier-smoothed path for the whole edit layer, rebuilt from the draft into a
	// single Path2D (all features share one recorder — splitting per feature breaks the
	// boundary reconstruction). Memoised on the draft version + projection, so it only
	// rebuilds when geometry or the projection changes (not on pan/zoom).
	let editBezierPath: Path2D | null = null;
	let editBezierKey = '';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function getEditBezierPath(draft: any, processing: LayerProcessing): Path2D | null {
		const proj = projection;
		if (!proj) return null;
		const key = [
			editSession.version, projectionStore.id, projectionStore.rotate.join(','), width, height,
			processing.bezierCurveType, processing.bezierTension, processing.bezierAlpha,
			processing.bezierContinuity, processing.bezierBias,
		].join('|');
		if (editBezierPath && editBezierKey === key) return editBezierPath;
		try {
			const bezierArcs = buildBezierArcs(
				draft, proj, processing.bezierCurveType, processing.bezierTension,
				processing.bezierAlpha, processing.bezierContinuity, processing.bezierBias, width, height,
			);
			const path = new Path2D();
			const vp: [number, number] = [width, height];
			const objName = Object.keys(draft.objects)[0];
			for (const geom of draft.objects[objName].geometries) {
				if (geom.type === 'Polygon') {
					for (const ring of geom.arcs) arcRingToPath(ring, bezierArcs, path, true, proj, vp);
				} else if (geom.type === 'MultiPolygon') {
					for (const poly of geom.arcs) for (const ring of poly) arcRingToPath(ring, bezierArcs, path, true, proj, vp);
				} else if (geom.type === 'LineString') {
					arcRingToPath(geom.arcs, bezierArcs, path, false);
				} else if (geom.type === 'MultiLineString') {
					for (const line of geom.arcs) arcRingToPath(line, bezierArcs, path, false);
				}
			}
			editBezierPath = path;
			editBezierKey = key;
			return path;
		} catch (err) {
			console.warn('[editBezier] build failed', err);
			return null;
		}
	}

	// Nearest point within VERTEX_HIT_RADIUS across ALL point features of the edit layer —
	// every point is directly grabbable (no need to target its feature first). Returns null
	// for non-point geometry / when nothing is close.
	function hitPoint(clientX: number, clientY: number): { featureIndex: number; pointIndex: number } | null {
		const draft = getDraft();
		if (!draft || !projection || !canvasEl || editSession.activeLayerId === null) return null;
		const rect = canvasEl.getBoundingClientRect();
		const mx = clientX - rect.left;
		const my = clientY - rect.top;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const geometries = (draft as any).objects[Object.keys((draft as any).objects)[0]].geometries as any[];
		let best: { featureIndex: number; pointIndex: number } | null = null;
		let bestDist = VERTEX_HIT_RADIUS * VERTEX_HIT_RADIUS;
		for (let fi = 0; fi < geometries.length; fi++) {
			const geom = geometries[fi];
			if (!geom || (geom.type !== 'Point' && geom.type !== 'MultiPoint')) continue;
			const coords: number[][] = geom.type === 'Point' ? [geom.coordinates] : geom.coordinates;
			for (let i = 0; i < coords.length; i++) {
				const p = projection(coords[i] as [number, number]);
				if (!p) continue;
				const dx = p[0] * mapScale + tx - mx;
				const dy = p[1] * mapScale + ty - my;
				const d = dx * dx + dy * dy;
				if (d < bestDist) { bestDist = d; best = { featureIndex: fi, pointIndex: geom.type === 'Point' ? 0 : i }; }
			}
		}
		return best;
	}

	// Squared distance from point (px,py) to segment (ax,ay)-(bx,by), in screen space.
	function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
		const dx = bx - ax;
		const dy = by - ay;
		const len2 = dx * dx + dy * dy;
		let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
		t = Math.max(0, Math.min(1, t));
		const ex = px - (ax + t * dx);
		const ey = py - (ay + t * dy);
		return ex * ex + ey * ey;
	}

	// Nearest segment of the targeted feature within EDGE_HIT_RADIUS of the cursor (hovering
	// anywhere along the segment counts). The ghost is placed at that segment's midpoint;
	// atIndex is the splice position.
	function hitEdge(clientX: number, clientY: number): { arcIndex: number; atIndex: number; geo: [number, number] } | null {
		const draft = getDraft();
		// Insert is disabled while markers are decimated — inserting among sub-pixel
		// vertices is meaningless; the user zooms in (stride 1) to add points.
		if (!draft || !projection || !canvasEl || markerStride() > 1) return null;
		const rect = canvasEl.getBoundingClientRect();
		const mx = clientX - rect.left;
		const my = clientY - rect.top;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const arcs = (draft as any).arcs as number[][][];
		const arcIndices = featureArcIndices(draft, editSession.featureIndex);

		let best: { arcIndex: number; atIndex: number; sx: number; sy: number } | null = null;
		let bestDist = EDGE_HIT_RADIUS * EDGE_HIT_RADIUS;
		for (const ai of arcIndices) {
			const arc = arcs[ai];
			if (!arc) continue;
			for (let vi = 0; vi < arc.length - 1; vi++) {
				const a = projection(arc[vi] as [number, number]);
				const b = projection(arc[vi + 1] as [number, number]);
				if (!a || !b) continue;
				const ax = a[0] * mapScale + tx;
				const ay = a[1] * mapScale + ty;
				const bx = b[0] * mapScale + tx;
				const by = b[1] * mapScale + ty;
				// Cull segments fully outside the viewport.
				if ((ax < 0 && bx < 0) || (ax > width && bx > width) || (ay < 0 && by < 0) || (ay > height && by > height)) continue;
				const d = distToSegmentSq(mx, my, ax, ay, bx, by);
				if (d < bestDist) { bestDist = d; best = { arcIndex: ai, atIndex: vi + 1, sx: (ax + bx) / 2, sy: (ay + by) / 2 }; }
			}
		}
		if (!best) return null;
		const geo = projection.invert?.([(best.sx - tx) / mapScale, (best.sy - ty) / mapScale]);
		if (!geo) return null;
		return { arcIndex: best.arcIndex, atIndex: best.atIndex, geo: geo as [number, number] };
	}

	// True when the cursor is within EDIT_SELECT_BUFFER px of the edited feature's geometry
	// (its edges/vertices, or its points). Used to create a no-select zone so hovering near
	// the feature you're editing doesn't highlight or select a neighbouring feature.
	const EDIT_SELECT_BUFFER = 14; // px
	function nearEditedGeometry(clientX: number, clientY: number): boolean {
		const draft = getDraft();
		if (!draft || !projection || !canvasEl || editSession.activeLayerId === null) return false;
		const rect = canvasEl.getBoundingClientRect();
		const mx = clientX - rect.left;
		const my = clientY - rect.top;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyDraft = draft as any;
		const objName = Object.keys(anyDraft.objects)[0];
		const geom = anyDraft.objects[objName].geometries[editSession.featureIndex];
		if (!geom) return false;
		const buf2 = EDIT_SELECT_BUFFER * EDIT_SELECT_BUFFER;

		if (geom.type === 'Point' || geom.type === 'MultiPoint') {
			const coords: number[][] = geom.type === 'Point' ? [geom.coordinates] : geom.coordinates;
			for (const c of coords) {
				const p = projection(c as [number, number]);
				if (!p) continue;
				const dx = p[0] * mapScale + tx - mx;
				const dy = p[1] * mapScale + ty - my;
				if (dx * dx + dy * dy < buf2) return true;
			}
			return false;
		}

		const arcs = anyDraft.arcs as number[][][];
		for (const ai of featureArcIndices(draft, editSession.featureIndex)) {
			const arc = arcs[ai];
			if (!arc) continue;
			for (let vi = 0; vi < arc.length - 1; vi++) {
				const a = projection(arc[vi] as [number, number]);
				const b = projection(arc[vi + 1] as [number, number]);
				if (!a || !b) continue;
				const ax = a[0] * mapScale + tx, ay = a[1] * mapScale + ty;
				const bx = b[0] * mapScale + tx, by = b[1] * mapScale + ty;
				if ((ax < 0 && bx < 0) || (ax > width && bx > width) || (ay < 0 && by < 0) || (ay > height && by > height)) continue;
				if (distToSegmentSq(mx, my, ax, ay, bx, by) < buf2) return true;
			}
		}
		return false;
	}

	// Highlights one feature of the edit layer using the live draft geometry (the path
	// cache is stale during a session). Drawn in projection space, like drawFeatureHighlight.
	function drawDraftFeatureHighlight(
		c: CanvasRenderingContext2D,
		featureIndex: number,
		fillColor: string,
		strokeColor: string,
		fillOpacity: number,
		lineWidth: number,
	): void {
		const draft = getDraft();
		if (!draft || !projection) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyDraft = draft as any;
		const objName = Object.keys(anyDraft.objects)[0];
		const geom = anyDraft.objects[objName].geometries[featureIndex];
		if (!geom) return;
		// Point features are shown via their own markers, not a feature outline.
		if (geom.type === 'Point' || geom.type === 'MultiPoint') return;
		const pathStr = d3.geoPath(projection)(feature(anyDraft, geom));
		if (!pathStr) return;
		const path = new Path2D(pathStr);
		if ((geom.type === 'Polygon' || geom.type === 'MultiPolygon') && fillColor !== 'none') {
			c.globalAlpha = fillOpacity;
			c.fillStyle = fillColor;
			c.fill(path, 'evenodd');
		}
		c.globalAlpha = 1;
		c.strokeStyle = strokeColor;
		c.lineWidth = lineWidth;
		c.stroke(path);
	}

	function handleClick(e: MouseEvent) {
		if (suppressNextClick) { suppressNextClick = false; return; }
		if (clipBbox.open && clipBbox.mode === 'bbox') return;
		if (toolState.active === 'pan') return;

		if (toolState.active === 'draw') {
			if (spacePanning) return; // space-pan in progress — don't place
			if (drawSession.picking) return; // picker armed — canvas clicks don't place vertices
			// Clicking on an endpoint of the active path finishes it — an alternative to
			// double-click. A polygon closes on its FIRST vertex (where the closing edge lands);
			// a line finishes on its LAST (terminal) vertex. Both endpoints work for polygons.
			if (drawSession.drawType !== 'point' && drawSession.activeCount > 0 && projection && canvasEl) {
				const active = getActivePath();
				const proj = projection;
				const rect = canvasEl.getBoundingClientRect();
				const cx = e.clientX - rect.left;
				const cy = e.clientY - rect.top;
				const near = (coord: readonly [number, number]): boolean => {
					const p = proj(coord as [number, number]);
					if (!p) return false;
					return Math.hypot(p[0] * mapScale + tx - cx, p[1] * mapScale + ty - cy) <= 8;
				};
				const hitClose =
					drawSession.drawType === 'polygon'
						? near(active[0]) || near(active[active.length - 1])
						: near(active[active.length - 1]);
				if (hitClose) {
					finishActive(); // no-op if below the min vertex count
					return;
				}
			}
			const geo = screenToGeo(e.clientX, e.clientY);
			if (geo) placeVertex(geo[0], geo[1]); // null = clicked off-globe; ignore
			return;
		}

		if (toolState.active === 'edit') {
			const editHit = getHitAtPoint(e.clientX, e.clientY);
			if (editSession.activeLayerId) {
				// No-select zone: a click near the edited feature never swaps to a neighbour.
				if (nearEditedGeometry(e.clientX, e.clientY)) return;
				// Active draft: single-click only swaps to another feature in the SAME
				// layer. Clicks on other layers or empty space do nothing — leaving the
				// draft requires a double-click (protection).
				if (editHit && editHit.layerId === editSession.activeLayerId) {
					startEditing(editHit.layerId, editHit.featureIndex);
					selectFeature(editHit.layerId, editHit.featureIndex, false);
				}
			} else {
				// Targeting: single-click selects a feature so the contextual action bar
				// (with its Edit button) appears. Clicking empty clears.
				if (editHit) selectFeature(editHit.layerId, editHit.featureIndex, false);
				else clearSelection();
			}
			return;
		}

		if (toolState.active !== 'select') return;

		const hit = getHitAtPoint(e.clientX, e.clientY);
		const cmd = e.metaKey || e.ctrlKey;

		if (layerSelection.enteredId !== null) {
			if (!hit) {
				exitLayer();
				clearLayerSelection();
				clearSelection();
			} else if (hit.layerId === layerSelection.enteredId || cmd) {
				const alreadySelected = selection.features.get(hit.layerId)?.has(hit.featureIndex) ?? false;
				if (alreadySelected && !e.shiftKey) {
					selectFeature(hit.layerId, hit.featureIndex, true);
				} else {
					selectFeature(hit.layerId, hit.featureIndex, e.shiftKey);
				}
			} else {
				clearSelection();
				exitLayer();
				selectLayer(hit.layerId);
			}
		} else {
			if (!hit) {
				clearLayerSelection();
				clearSelection();
			} else if (cmd) {
				selectFeature(hit.layerId, hit.featureIndex, e.shiftKey);
			} else if (e.shiftKey) {
				toggleLayerSelection(hit.layerId);
			} else {
				clearSelection();
				selectLayer(hit.layerId);
			}
		}
	}

	function handleDblClick(e: MouseEvent) {
		if (toolState.active === 'draw') {
			// Finish the active line/polygon (drops the duplicate vertex the dblclick's second
			// click placed). The draw tool stays active to start the next feature.
			finishActiveFromDoubleClick();
			return;
		}
		if (toolState.active === 'edit') {
			const editHit = getHitAtPoint(e.clientX, e.clientY);
			if (editSession.activeLayerId) {
				// Active draft: double-click commits. On another feature, jump straight
				// into editing it; on empty space, return to targeting.
				if (editHit) {
					startEditing(editHit.layerId, editHit.featureIndex);
					selectFeature(editHit.layerId, editHit.featureIndex, false);
				} else {
					exitEditing();
					clearSelection();
				}
			} else {
				// Targeting: double-click starts editing the feature (the fast path).
				if (editHit) startEditing(editHit.layerId, editHit.featureIndex);
			}
			return;
		}
		if (toolState.active !== 'select') return;
		const hit = getHitAtPoint(e.clientX, e.clientY);
		if (!hit) return;
		enterLayer(hit.layerId);
		selectFeature(hit.layerId, hit.featureIndex, false);
	}

	// Marquee selection while editing: selects the edited feature's vertices within the box
	// (lines/polygons), or every point of the layer within the box (point layers).
	function updateEditMarqueeSelection() {
		const draft = getDraft();
		if (!draft || !projection || !marqueeStart || !marqueeCurrent || editSession.activeLayerId === null) return;
		const x1 = Math.min(marqueeStart.x, marqueeCurrent.x);
		const y1 = Math.min(marqueeStart.y, marqueeCurrent.y);
		const x2 = Math.max(marqueeStart.x, marqueeCurrent.x);
		const y2 = Math.max(marqueeStart.y, marqueeCurrent.y);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyDraft = draft as any;
		const geometries = anyDraft.objects[Object.keys(anyDraft.objects)[0]].geometries as { type?: string; coordinates?: number[] | number[][] }[];
		const inBox = (c: number[]): boolean => {
			const p = projection!(c as [number, number]);
			if (!p) return false;
			const sx = p[0] * mapScale + tx, sy = p[1] * mapScale + ty;
			return sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2;
		};

		const targetGeom = geometries[editSession.featureIndex];
		if (targetGeom && (targetGeom.type === 'Point' || targetGeom.type === 'MultiPoint')) {
			const sel = new Set<string>();
			for (let fi = 0; fi < geometries.length; fi++) {
				const g = geometries[fi];
				if (!g || (g.type !== 'Point' && g.type !== 'MultiPoint')) continue;
				const coords: number[][] = g.type === 'Point' ? [g.coordinates as number[]] : g.coordinates as number[][];
				for (let pi = 0; pi < coords.length; pi++) if (inBox(coords[pi])) sel.add(`${fi}:${pi}`);
			}
			selectedPoints = sel;
		} else {
			const arcs = anyDraft.arcs as number[][][];
			const verts: { arcIndex: number; vertexIndex: number }[] = [];
			for (const ai of featureArcIndices(draft, editSession.featureIndex)) {
				const arc = arcs[ai];
				if (!arc) continue;
				for (let vi = 0; vi < arc.length; vi++) if (inBox(arc[vi])) verts.push({ arcIndex: ai, vertexIndex: vi });
			}
			setVertexSelection(verts);
		}
	}

	function updateMarqueeSelection(addToExisting: boolean) {
		if (!marqueeStart || !marqueeCurrent || !projection) return;

		// Marquee bounds in canvas pixel coords.
		const x1 = Math.min(marqueeStart.x, marqueeCurrent.x);
		const y1 = Math.min(marqueeStart.y, marqueeCurrent.y);
		const x2 = Math.max(marqueeStart.x, marqueeCurrent.x);
		const y2 = Math.max(marqueeStart.y, marqueeCurrent.y);

		// Sample points along all four edges of the marquee and invert to geographic
		// coordinates. Sampling densely (rather than just 4 corners) gives a much
		// better geographic envelope for curved projections — conics, azimuthals,
		// and the globe — where a screen rectangle's geographic extent bulges well
		// outside its corner-only bbox.
		const EDGE_SAMPLES = 20;
		const screenSamples: [number, number][] = [];
		for (let i = 0; i <= EDGE_SAMPLES; i++) {
			const t = i / EDGE_SAMPLES;
			const mx = x1 + (x2 - x1) * t;
			const my = y1 + (y2 - y1) * t;
			screenSamples.push([mx, y1]); // top edge
			screenSamples.push([mx, y2]); // bottom edge
			screenSamples.push([x1, my]); // left edge
			screenSamples.push([x2, my]); // right edge
		}
		const corners = screenSamples
			.map((p) => projection!.invert!([(p[0] - tx) / mapScale, (p[1] - ty) / mapScale]))
			.filter((c): c is [number, number] => c !== null);

		if (corners.length === 0) return;

		const geoX1 = Math.min(...corners.map((c) => c[0]));
		const geoX2 = Math.max(...corners.map((c) => c[0]));
		const geoY1 = Math.min(...corners.map((c) => c[1]));
		const geoY2 = Math.max(...corners.map((c) => c[1]));

		if (marqueeLayerMode) {
			const hitLayerIds: string[] = [];
			for (const layer of layers) {
				if (!layer.visible || !layer.hasTopology) continue;
				const bboxes = cachedBboxes.get(layer.id);
				if (!bboxes) continue;
				for (let i = 0; i < bboxes.length; i++) {
					const bbox = bboxes[i];
					if (!bbox) continue;
					const [minLon, minLat, maxLon, maxLat] = bbox;
					if (maxLon >= geoX1 && minLon <= geoX2 && maxLat >= geoY1 && minLat <= geoY2) {
						hitLayerIds.push(layer.id);
						break;
					}
				}
			}
			const merged = addToExisting
				? [...new Set([...preDragLayerIds, ...hitLayerIds])]
				: hitLayerIds;
			layerSelection.ids = merged;
			return;
		}

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
		if (clipBbox.open && clipBbox.mode === 'bbox' && toolState.active !== 'pan' && !spacePanning) return;

		// Edit tool, active draft: select/drag a vertex, insert, or clear the selection.
		if (toolState.active === 'edit' && editSession.activeLayerId && !spacePanning) {
			// Point feature — grab the point itself (points aren't stored in arcs).
			const pHit = hitPoint(e.clientX, e.clientY);
			if (pHit) {
				const key = ptKey(pHit.featureIndex, pHit.pointIndex);
				if (e.shiftKey) {
					// Shift = toggle this point's selection; no drag.
					const next = new Set(selectedPoints);
					if (next.has(key)) next.delete(key); else next.add(key);
					selectedPoints = next;
					return;
				}
				// Select on mousedown, keeping an existing multi-selection so a drag moves
				// the whole group.
				if (!selectedPoints.has(key)) selectedPoints = new Set([key]);
				const group: PointMember[] = [...selectedPoints].map((k) => {
					const [fi, pi] = k.split(':').map(Number);
					return { featureIndex: fi, pointIndex: pi, orig: getPointCoord(fi, pi) ?? [0, 0] };
				});
				const from = getPointCoord(pHit.featureIndex, pHit.pointIndex);
				pointDrag = { group, from: from ?? [0, 0] };
				(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
				return;
			}
			const hit = hitVertex(e.clientX, e.clientY);
			if (hit) {
				if (e.shiftKey) {
					// Shift = toggle this vertex's selection; no drag.
					toggleVertex(hit.arcIndex, hit.vertexIndex);
					return;
				}
				// Select on mousedown, but only if not already selected — keeping an
				// existing multi-selection intact so a drag moves the whole group.
				if (!isVertexSelected(hit.arcIndex, hit.vertexIndex)) {
					selectVertex(hit.arcIndex, hit.vertexIndex);
				}
				const group = getSelectedVertices()
					.map((v) => dragMemberFor(v.arcIndex, v.vertexIndex))
					.filter((m): m is DragMember => m !== null);
				const from = vertexCoord(hit.arcIndex, hit.vertexIndex);
				if (group.length && from) {
					vertexDrag = { group, from };
					(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
				}
				return;
			}
			// On the active ghost point — insert a vertex there and drag it into place.
			if (insertHover && overInsertGhost) {
				const { arcIndex, atIndex, geo } = insertHover;
				beginInsert(arcIndex, atIndex, geo);
				vertexDrag = { group: [{ targets: [{ arcIndex, vertexIndex: atIndex }], orig: geo }], from: geo, insert: { arcIndex, atIndex } };
				insertHover = null;
				overInsertGhost = false;
				(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
				return;
			}
			// Cmd/Ctrl + drag on empty space starts a marquee that selects vertices/points
			// (Shift is reserved for toggling individual vertices/points).
			if ((e.metaKey || e.ctrlKey) && containerEl) {
				const containerRect = containerEl.getBoundingClientRect();
				marqueePtrStartX = e.clientX;
				marqueePtrStartY = e.clientY;
				marqueeStart = { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };
				marqueeCurrent = { ...marqueeStart };
				(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
				return;
			}
			// Clicked feature body or empty space — clear the vertex/point selection.
			clearVertexSelection();
			selectedPoints = new Set();
		}

		if (toolState.active === 'pan' || spacePanning) {
			isDragging = true;
			panMoved = false;
			lastPointerX = e.clientX;
			lastPointerY = e.clientY;
			if (interactionMode === 'rotate') {
				localRotate = [...projectionStore.rotate];
				lastBuiltRotate = [...projectionStore.rotate]; // reset so delta is measured from drag start
			}
			(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
		} else if (toolState.active === 'select' && containerEl) {
			const cmd = e.metaKey || e.ctrlKey;
			const enteredId = layerSelection.enteredId;
			marqueeLayerMode = !enteredId && !cmd;

			const containerRect = containerEl.getBoundingClientRect();
			marqueePtrStartX = e.clientX;
			marqueePtrStartY = e.clientY;
			marqueeStart = { x: e.clientX - containerRect.left, y: e.clientY - containerRect.top };
			marqueeCurrent = { ...marqueeStart };
			preDragSelection = new Map([...selection.features.entries()].map(([k, v]) => [k, new Set(v)]));
			preDragLayerIds = [...layerSelection.ids];
			// Cache bboxes: entered layer only for feature mode without cmd, all layers otherwise.
			cachedBboxes = new Map();
			for (const layer of layers) {
				if (!layer.visible || !layer.hasTopology) continue;
				if (!cmd && enteredId && layer.id !== enteredId) continue;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const topo = workingTopologyData.get(layer.id) as any;
				if (topo) cachedBboxes.set(layer.id, computeFeatureBboxes(topo));
			}
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		}
	}

	function handlePointerMove(e: PointerEvent) {
		metaHeld = e.metaKey || e.ctrlKey; // keep in sync even if a keyup was missed

		// Rubber-band preview: track the cursor only while a line/polygon is mid-draw, so we
		// don't repaint the whole canvas on every mouse move in point mode or when idle.
		if (toolState.active === 'draw' && drawSession.drawType !== 'point' && drawSession.activeCount > 0 && !drawSession.picking && canvasEl) {
			const rect = canvasEl.getBoundingClientRect();
			drawHover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		} else if (drawHover !== null) {
			drawHover = null;
		}
		// Dragging a point feature — move the point under the cursor.
		if (pointDrag) {
			const geo = screenToGeo(e.clientX, e.clientY);
			if (geo) translatePoints(pointDrag.group, geo[0] - pointDrag.from[0], geo[1] - pointDrag.from[1]);
			return;
		}

		// Dragging a vertex — record the latest position and apply it at most once per
		// animation frame (coalesces rapid pointer-moves into one repaint).
		if (vertexDrag) {
			const geo = screenToGeo(e.clientX, e.clientY);
			if (geo) {
				pendingDragGeo = geo;
				if (dragRafId === null) {
					dragRafId = requestAnimationFrame(() => {
						dragRafId = null;
						if (vertexDrag && pendingDragGeo) {
							translateGroup(vertexDrag.group, pendingDragGeo[0] - vertexDrag.from[0], pendingDragGeo[1] - vertexDrag.from[1]);
						}
					});
				}
			}
			return;
		}

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
			if (toolState.active === 'edit') updateEditMarqueeSelection();
			else updateMarqueeSelection(e.shiftKey);
			return;
		}

		if (toolState.active === 'select' && !isDragging && !isMarqueeDragging && hitCanvas && canvasEl) {
			const featureHoverActive = layerSelection.enteredId !== null || e.metaKey || e.ctrlKey;
			if (!featureHoverActive) {
				const hit = getHitAtPoint(e.clientX, e.clientY);
				setHoveredLayer(hit?.layerId ?? null);
				hoveredFeature.value = null;
			} else {
				setHoveredLayer(null);
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
			} // end featureHoverActive
		}

		// Edit tool, targeting sub-state: feature hover is always active (you target
		// features directly), so highlight whatever feature is under the cursor.
		if (toolState.active === 'edit' && !isDragging && hitCanvas && canvasEl) {
			if (editSession.activeLayerId !== null) {
				if (e.metaKey || e.ctrlKey) {
					// Cmd/Ctrl held → marquee mode: no marker or feature hover feedback.
					hoveredFeature.value = null;
					hoveredPoint = null;
					hoveredVertexKey = null;
					overVertex = false;
					insertHover = null;
					overInsertGhost = false;
				} else {
				// No-select zone: don't highlight neighbours while the cursor is near the
				// feature being edited.
				const pHover = hitPoint(e.clientX, e.clientY);
				hoveredPoint = pHover ? ptKey(pHover.featureIndex, pHover.pointIndex) : null;
				const vHover = hitVertex(e.clientX, e.clientY);
				hoveredVertexKey = vHover ? `${vHover.arcIndex}:${vHover.vertexIndex}` : null;
				// Over a point (or near the edited feature) → no neighbour highlight; the
				// point markers convey hover instead.
				hoveredFeature.value = pHover || nearEditedGeometry(e.clientX, e.clientY) ? null : getHitAtPoint(e.clientX, e.clientY);
				overVertex = vHover !== null || pHover !== null;
				// Show the insert ghost only when not already over a draggable vertex.
				insertHover = overVertex ? null : hitEdge(e.clientX, e.clientY);
				// Active when the cursor is right on the ghost point itself.
				if (insertHover && projection && canvasEl) {
					const gp = projection(insertHover.geo);
					const rect = canvasEl.getBoundingClientRect();
					const gx = gp ? gp[0] * mapScale + tx : -1e9;
					const gy = gp ? gp[1] * mapScale + ty : -1e9;
					overInsertGhost = Math.hypot(gx - (e.clientX - rect.left), gy - (e.clientY - rect.top)) <= GHOST_HOVER_RADIUS;
				} else {
					overInsertGhost = false;
				}
				}
			} else {
				hoveredFeature.value = getHitAtPoint(e.clientX, e.clientY);
				overVertex = false;
				insertHover = null;
				overInsertGhost = false;
			}
		}

		if (!isDragging) return;
		panMoved = true;

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
		// End of a point drag — record it for undo and swallow the trailing click.
		if (pointDrag) {
			recordPointMoves(pointDrag.group);
			pointDrag = null;
			suppressNextClick = true;
			return;
		}

		// End of a vertex drag — rebuild the node map (a moved node has new coords) and
		// swallow the trailing click so it doesn't retarget/deselect.
		if (vertexDrag) {
			// Flush any pending throttled move so the final position is applied.
			if (dragRafId !== null) { cancelAnimationFrame(dragRafId); dragRafId = null; }
			if (pendingDragGeo) {
				translateGroup(vertexDrag.group, pendingDragGeo[0] - vertexDrag.from[0], pendingDragGeo[1] - vertexDrag.from[1]);
				pendingDragGeo = null;
			}
			if (vertexDrag.insert) {
				// Insert + placement collapse into one undo step.
				commitInsert(vertexDrag.insert.arcIndex, vertexDrag.insert.atIndex);
			} else {
				recordMoves(vertexDrag.group);
			}
			vertexDrag = null;
			rebuildNodeMap();
			suppressNextClick = true;
			return;
		}

		if (isMarqueeDragging) {
			isMarqueeDragging = false;
			suppressNextClick = true;
		}
		if (isDragging && panMoved) {
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
		const proj = fn().fitSize([width, height], { type: 'Sphere' });
		// Composite projections (e.g. geoAlbersUsa) omit .rotate; only apply it when supported.
		if (projectionEntry.interactionMode === 'rotate' && typeof proj.rotate === 'function') proj.rotate(rot);
		return proj;
	});

	// Returns the geographic bbox [west, south, east, north] of the current viewport,
	// sampling the canvas border to handle curved projections. Returns null if the
	// projection is not available.
	function getViewportBbox(): [number, number, number, number] | null {
		if (!projection || !width || !height) return null;
		const EDGE_SAMPLES = 20;
		const screenSamples: [number, number][] = [];
		for (let i = 0; i <= EDGE_SAMPLES; i++) {
			const t = i / EDGE_SAMPLES;
			screenSamples.push([width * t, 0]);        // top edge
			screenSamples.push([width * t, height]);   // bottom edge
			screenSamples.push([0, height * t]);        // left edge
			screenSamples.push([width, height * t]);    // right edge
		}
		const coords = screenSamples
			.map(([sx, sy]) => projection!.invert!([(sx - tx) / mapScale, (sy - ty) / mapScale]))
			.filter((c): c is [number, number] => c !== null);
		if (coords.length === 0) return null;
		const lons = coords.map(c => c[0]);
		const lats = coords.map(c => c[1]);
		return [
			Math.max(-180, Math.min(...lons)),
			Math.max(-90,  Math.min(...lats)),
			Math.min(180,  Math.max(...lons)),
			Math.min(90,   Math.max(...lats)),
		];
	}

	// --- Clip bbox overlay ---

	let draggingHandle = $state<'nw' | 'ne' | 'se' | 'sw' | null>(null);

	function projectPoint(lon: number, lat: number): [number, number] | null {
		if (!projection) return null;
		const p = projection([lon, lat]);
		if (!p) return null;
		return [p[0] * mapScale + tx, p[1] * mapScale + ty];
	}

	const BBOX_SAMPLES = 20;

	const bboxPath = $derived.by(() => {
		if (!clipBbox.open || clipBbox.mode !== 'bbox' || !projection) return '';
		const { west, south, east, north } = clipBbox;
		const pts: [number, number][] = [];
		for (let i = 0; i <= BBOX_SAMPLES; i++) {
			const t = i / BBOX_SAMPLES;
			const p1 = projectPoint(west + (east - west) * t, north);   // top W→E
			if (p1) pts.push(p1);
		}
		for (let i = 0; i <= BBOX_SAMPLES; i++) {
			const t = i / BBOX_SAMPLES;
			const p2 = projectPoint(east, north + (south - north) * t); // right N→S
			if (p2) pts.push(p2);
		}
		for (let i = 0; i <= BBOX_SAMPLES; i++) {
			const t = i / BBOX_SAMPLES;
			const p3 = projectPoint(east + (west - east) * t, south);   // bottom E→W
			if (p3) pts.push(p3);
		}
		for (let i = 0; i <= BBOX_SAMPLES; i++) {
			const t = i / BBOX_SAMPLES;
			const p4 = projectPoint(west, south + (north - south) * t); // left S→N
			if (p4) pts.push(p4);
		}
		if (pts.length === 0) return '';
		return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
	});

	const bboxCorners = $derived.by(() => {
		if (!clipBbox.open || clipBbox.mode !== 'bbox') return null;
		return {
			nw: projectPoint(clipBbox.west, clipBbox.north),
			ne: projectPoint(clipBbox.east, clipBbox.north),
			se: projectPoint(clipBbox.east, clipBbox.south),
			sw: projectPoint(clipBbox.west, clipBbox.south),
		};
	});

	function onHandleDragMove(e: MouseEvent) {
		if (!draggingHandle || !projection || !containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const geo = projection.invert!([(sx - tx) / mapScale, (sy - ty) / mapScale]);
		const lon = geo ? Math.max(-180, Math.min(180, geo[0])) : null;
		const lat = geo ? Math.max(-90,  Math.min(90,  geo[1])) : null;
		const { west, south, east, north } = clipBbox;
		if (draggingHandle === 'nw') setClipBbox(lon ?? west, south, east, lat ?? north);
		if (draggingHandle === 'ne') setClipBbox(west, south, lon ?? east, lat ?? north);
		if (draggingHandle === 'se') setClipBbox(west, lat ?? south, lon ?? east, north);
		if (draggingHandle === 'sw') setClipBbox(lon ?? west, lat ?? south, east, north);
	}

	function onHandleDragEnd() {
		draggingHandle = null;
		window.removeEventListener('mousemove', onHandleDragMove);
		window.removeEventListener('mouseup', onHandleDragEnd);
	}

	function startHandleDrag(e: MouseEvent, handle: 'nw' | 'ne' | 'se' | 'sw') {
		e.preventDefault();
		e.stopPropagation();
		draggingHandle = handle;
		window.addEventListener('mousemove', onHandleDragMove);
		window.addEventListener('mouseup', onHandleDragEnd);
	}

	$effect(() => {
		return () => {
			window.removeEventListener('mousemove', onHandleDragMove);
			window.removeEventListener('mouseup', onHandleDragEnd);
		};
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
				// Bezier layers cache as one whole-layer chunk, so they can't be picked per
				// feature from the cache — build the regions from the working topology
				// (straight geometry) so individual features stay selectable/editable.
				const bezierHit = layer.processing.bezierEnabled;
				const bezTopo = bezierHit ? workingTopologyData.get(layer.id) : undefined;
				const bezProj = bezierHit ? untrack(() => projection) : null;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const bezGeoms = bezTopo ? (bezTopo.objects[Object.keys(bezTopo.objects)[0]] as any).geometries as any[] : null;
				const bezPathGen = bezProj ? d3.geoPath(bezProj) : null;
				const count = bezierHit ? (bezGeoms?.length ?? 0) : chunks.length;

				for (let fi = 0; fi < count; fi++) {
					let p2d: Path2D;
					if (bezierHit) {
						const g = bezGeoms?.[fi];
						if (!g || g.type === 'Point' || g.type === 'MultiPoint' || !bezPathGen || !bezTopo) continue;
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const pathStr = bezPathGen(feature(bezTopo, g) as any);
						if (!pathStr) continue;
						p2d = new Path2D(pathStr);
					} else {
						p2d = chunks[fi].path2d;
					}
					const r = (colorIdx >> 16) & 0xff;
					const g = (colorIdx >> 8)  & 0xff;
					const b =  colorIdx        & 0xff;
					const color = `rgb(${r},${g},${b})`;
					hctx.fillStyle   = color;
					hctx.strokeStyle = color;
					// Minimum 4px stroke so thin lines stay clickable.
					hctx.lineWidth = Math.max(layer.style.strokeWidth, 4) / mapScale;
					hctx.fill(p2d, 'evenodd');
					hctx.stroke(p2d);
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
		function handleKeyUp(e: KeyboardEvent) {
			metaHeld = e.metaKey || e.ctrlKey;
			if (e.key === ' ') {
				spacePanning = false;
				if (isDragging) { isDragging = false; }
			}
		}

		function handleKeyDown(e: KeyboardEvent) {
			metaHeld = e.metaKey || e.ctrlKey;
			// Don't intercept when focus is in a text field.
			const tag = (e.target as Element | null)?.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			// Esc backs out of the bake dialog, then cancels an edit session (discards edits).
			if (e.key === 'Escape') {
				if (editSession.pendingBake) { cancelBake(); return; }
				if (editSession.activeLayerId) { cancelEditing(); return; }
				// While drawing: Esc first disarms the "pick a layer" mode, then cancels the
				// active path, then discards the rest of the session (two-stage).
				if (toolState.active === 'draw' && drawSession.picking) { cancelPicking(); return; }
				if (toolState.active === 'draw' && escapeDraw()) return;
			}

			// Enter confirms the bake dialog, then commits an edit session (done).
			if (e.key === 'Enter') {
				if (editSession.pendingBake) { confirmBake(); return; }
				if (editSession.activeLayerId) { exitEditing(); return; }
				// While drawing, Enter finishes the active line/polygon (stay drawing), or
				// commits the session when nothing is active. The draw tool stays active.
				if (toolState.active === 'draw' && (drawSession.committedCount > 0 || drawSession.activeCount > 0)) { enterDraw(); return; }
			}

			// During a session, Delete/Backspace removes the selected vertices (and takes
			// precedence over feature/layer deletion).
			if ((e.key === 'Delete' || e.key === 'Backspace') && editSession.activeLayerId) {
				e.preventDefault();
				deleteSelectedVertices();
				return;
			}

			// During a session, arrow keys nudge the selected vertices/points — 1px, or
			// 10px with Shift (screen-pixel steps, consistent at any zoom).
			if (editSession.activeLayerId &&
				(e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
				e.preventDefault();
				const step = e.shiftKey ? 10 : 1;
				let dx = 0, dy = 0;
				if (e.key === 'ArrowUp') dy = -step;
				else if (e.key === 'ArrowDown') dy = step;
				else if (e.key === 'ArrowLeft') dx = -step;
				else dx = step;
				nudgeSelection(dx, dy);
				return;
			}

			if (e.key === ' ' && (toolState.active === 'select' || toolState.active === 'edit' || toolState.active === 'draw')) {
				e.preventDefault(); // prevent page scroll
				spacePanning = true;
				return;
			}

			if (e.key === 'v' || e.key === 'V') {
				exitLayer();
				toolState.active = 'pan';
			} else if (e.key === 's' || e.key === 'S') {
				exitLayer();
				toolState.active = 'select';
			} else if (e.key === 'e' || e.key === 'E') {
				exitLayer();
				toolState.active = 'edit';
			} else if (e.key === 'd' || e.key === 'D') {
				exitLayer();
				toolState.active = 'draw';
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
			} else if ((e.key === 'c' || e.key === 'C') && selection.features.size > 0) {
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
		window.addEventListener('keyup', handleKeyUp);
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	});

	// Leaving the edit tool (toolbar button or shortcut) ends any active edit session
	// and dismisses a pending bake dialog.
	$effect(() => {
		if (toolState.active !== 'edit') {
			if (editSession.pendingBake) cancelBake();
			if (editSession.activeLayerId) exitEditing();
		}
	});

	// Entering the draw tool clears layer/feature selection — the draw target is its own
	// explicit state (set via the draw action bar), deliberately decoupled from selection.
	$effect(() => {
		if (toolState.active === 'draw') {
			clearSelection();
			clearLayerSelection();
		}
	});

	// Leaving the draw tool commits any in-progress session (no-op if empty), then resets the
	// draw target so a later re-entry starts on a fresh new layer.
	$effect(() => {
		if (toolState.active !== 'draw') {
			commitDraw();
			resetDrawTarget();
		}
	});

	// Reset point hover/selection whenever the edit session starts, ends, or changes layer.
	$effect(() => {
		void editSession.activeLayerId;
		selectedPoints = new Set();
		hoveredPoint = null;
		hoveredVertexKey = null;
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
			const bgDim = (layerSelection.enteredId !== null || editSession.activeLayerId !== null) ? 0.35 : 1.0;
			ctx.globalAlpha = canvasStyles.background.alpha * bgDim;
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

			// Edit layer: draw clean features from the (still-valid) path cache and only
			// the edited "dirty" features live from the draft — so a drag on a complex
			// layer re-projects one feature, not the whole layer.
			if (editSession.activeLayerId === layer.id) {
				void editSession.version; // subscribe so draft mutations repaint
				const draft = getDraft();
				const editChunks = pathCache.get(layer.id);

				// Bezier layers cache as one whole-layer path, so rebuild the smoothed
				// curve live from the draft — the edited vertices are the control points.
				if (draft && projection && layer.processing.bezierEnabled) {
					const bpath = getEditBezierPath(draft, layer.processing);
					if (bpath) {
					if (layer.style.fill !== 'none') {
						ctx.globalAlpha = layer.style.fillOpacity;
						ctx.fillStyle = layer.style.fill;
						ctx.fill(bpath, 'evenodd');
					}
					ctx.globalAlpha = layer.style.strokeOpacity;
					ctx.strokeStyle = layer.style.stroke;
					ctx.lineWidth = layer.style.strokeWidth / mapScale;
					if (layer.style.strokeDashed) {
						ctx.setLineDash([layer.style.strokeDash / mapScale, layer.style.strokeGap / mapScale]);
					}
					ctx.stroke(bpath);
					ctx.setLineDash([]);
					ctx.globalAlpha = 1;
					}
					continue;
				}

				if (draft && projection) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const anyDraft = draft as any;
					const objName = Object.keys(anyDraft.objects)[0];
					const geometries = anyDraft.objects[objName].geometries as { type?: string }[];
					const dirty = getDirtyFeatures();

					const vxMin = -tx / mapScale;
					const vxMax = (width - tx) / mapScale;
					const vyMin = -ty / mapScale;
					const vyMax = (height - ty) / mapScale;
					const fillEnabled = layer.style.fill !== 'none';

					ctx.strokeStyle = layer.style.stroke;
					ctx.lineWidth = layer.style.strokeWidth / mapScale;
					if (layer.style.strokeDashed) {
						ctx.setLineDash([layer.style.strokeDash / mapScale, layer.style.strokeGap / mapScale]);
					}

					const count = editChunks ? editChunks.length : geometries.length;
					for (let ci = 0; ci < count; ci++) {
						let path2d: Path2D;
						if (dirty.has(ci) || !editChunks) {
							// Edited feature (or no cache) — project it from the draft now.
							const geom = geometries[ci];
							if (!geom) continue;
							if (geom.type === 'Point' || geom.type === 'MultiPoint') continue; // drawn below
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const pathStr = d3.geoPath(projection)(feature(anyDraft, geom as any));
							if (!pathStr) continue;
							path2d = new Path2D(pathStr);
						} else {
							const chunk = editChunks[ci];
							if (!chunk) continue;
							const [xMin, yMin, xMax, yMax] = chunk.bbox;
							if (xMax < vxMin || xMin > vxMax || yMax < vyMin || yMin > vyMax) continue;
							path2d = chunk.path2d;
						}
						if (fillEnabled) {
							ctx.globalAlpha = layer.style.fillOpacity;
							ctx.fillStyle = layer.style.fill;
							ctx.fill(path2d, 'evenodd');
						}
						ctx.globalAlpha = layer.style.strokeOpacity;
						ctx.stroke(path2d);
					}
					ctx.setLineDash([]);
					ctx.globalAlpha = 1;

					// Point features are drawn as editable markers in the marker pass below.
				}
				continue;
			}

			const chunks = pathCache.get(layer.id);
			if (chunks === undefined) continue;

			const hasNonPoint = layer.geometryTypes.some((t) => t !== 'Point' && t !== 'MultiPoint');
			const hasPoints   = layer.geometryTypes.some((t) => t === 'Point' || t === 'MultiPoint');

				const dim = layerSelection.enteredId !== null && layer.id !== layerSelection.enteredId ? 0.35
					: editSession.activeLayerId !== null && layer.id !== editSession.activeLayerId ? 0.35
					: clipBbox.open && !layerSelection.ids.includes(layer.id) ? 0.2
					: 1.0;
				const isMaskLayer = clipBbox.open && clipBbox.mode === 'layer' && layer.id === clipBbox.maskId;
				const clipFill   = isMaskLayer ? '#e9a400' : null;

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
						ctx.globalAlpha = layer.style.fillOpacity * dim;
						ctx.fillStyle = clipFill ?? layer.style.fill;
						ctx.fill(path2d, 'evenodd');
					}
					ctx.globalAlpha = layer.style.strokeOpacity * dim;
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
									ctx.globalAlpha = layer.style.fillOpacity * dim;
									ctx.fillStyle = layer.style.fill;
									ctx.fill(symPath2D);
								}

								if (layer.style.stroke !== 'none') {
									ctx.globalAlpha = layer.style.strokeOpacity * dim;
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
		const textColor       = highlightCss.getPropertyValue('--color-text-primary').trim();

		// Layer state pass — bbox stroke (zoom-independent) + geometry tints.
		// Entered layers are excluded: they rely solely on the opacity knockback above.
		if (layerSelection.ids.length > 0 || layerSelection.hoveredLayerId !== null) {
			const hovId    = layerSelection.hoveredLayerId;
			const selIds   = layerSelection.ids;
			const enteredId = layerSelection.enteredId;
			const hasTint  = selIds.length > 0 || hovId !== null;

			if (hasTint) {
				const vxMin = -tx / mapScale;
				const vxMax = (width - tx) / mapScale;
				const vyMin = -ty / mapScale;
				const vyMax = (height - ty) / mapScale;

				ctx.save();
				for (const layer of [...layers].reverse()) {
					if (!layer.visible) continue;
					if (layer.id === enteredId) continue; // entered = opacity knockback only
					const isSelected = selIds.includes(layer.id);
					const isHovered  = layer.id === hovId;
					if (!isSelected && !isHovered) continue;
					const stylePanelOpen = stylePanel.openId === layer.id;

					const chunks = pathCache.get(layer.id);
					if (!chunks) continue;

					const isMask     = clipBbox.open && clipBbox.mode === 'layer' && layer.id === clipBbox.maskId;
					const bboxColor  = isSelected ? accentColor : textColor;
					const isPolygon  = layer.geometryTypes.some(t => t === 'Polygon'    || t === 'MultiPolygon');
					const isLine     = layer.geometryTypes.some(t => t === 'LineString' || t === 'MultiLineString');
					const hasNonPt   = layer.geometryTypes.some(t => t !== 'Point'      && t !== 'MultiPoint');
					const hasPoints  = layer.geometryTypes.some(t => t === 'Point'      || t === 'MultiPoint');

					// Bbox stroke — union all chunk bboxes, draw at zoom-independent thickness.
					// Point layers have empty path cache arrays, so we fall back to projecting
					// coordinates directly from the topology.
					let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
					for (const { bbox } of chunks) {
						const [xMin, yMin, xMax, yMax] = bbox;
						if (!isFinite(xMin)) continue;
						if (xMin < bx1) bx1 = xMin;
						if (yMin < by1) by1 = yMin;
						if (xMax > bx2) bx2 = xMax;
						if (yMax > by2) by2 = yMax;
					}
					// Bezier layers cache as one infinite-bbox chunk; bound the projected
					// geometry from the working topology instead.
					if (!isFinite(bx1) && hasNonPt && projection) {
						const topo = workingTopologyData.get(layer.id);
						if (topo) {
							const objectName = Object.keys(topo.objects)[0];
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							const b = d3.geoPath(projection).bounds(feature(topo, topo.objects[objectName]) as any);
							if (isFinite(b[0][0])) { bx1 = b[0][0]; by1 = b[0][1]; bx2 = b[1][0]; by2 = b[1][1]; }
						}
					}
					if (!isFinite(bx1) && hasPoints && projection) {
						const topo = workingTopologyData.get(layer.id);
						if (topo) {
							const objectName = Object.keys(topo.objects)[0];
							const ptData = feature(topo, topo.objects[objectName]) as {
								features?: { geometry?: { type?: string; coordinates?: unknown } }[]
							};
							const projCenter: [number, number] | null = interactionMode === 'rotate'
								? [-projectionStore.rotate[0], -projectionStore.rotate[1]]
								: null;
							for (const f of ptData?.features ?? []) {
								const geom = f?.geometry;
								if (!geom) continue;
								const coords: [number, number][] =
									geom.type === 'Point'        ? [geom.coordinates as [number, number]]
									: geom.type === 'MultiPoint' ? (geom.coordinates as [number, number][])
									: [];
								for (const coord of coords) {
									if (projCenter && d3.geoDistance(coord, projCenter) >= Math.PI / 2) continue;
									const pt = projection(coord);
									if (!pt) continue;
									if (pt[0] < bx1) bx1 = pt[0];
									if (pt[1] < by1) by1 = pt[1];
									if (pt[0] > bx2) bx2 = pt[0];
									if (pt[1] > by2) by2 = pt[1];
								}
							}
						}
					}
					if (isFinite(bx1)) {
						const pad = 6 / mapScale;
						ctx.strokeStyle = bboxColor;
						ctx.lineWidth   = 1.5 / mapScale;
						ctx.globalAlpha = 1;
						ctx.setLineDash([]);
						ctx.strokeRect(bx1 - pad, by1 - pad, (bx2 - bx1) + pad * 2, (by2 - by1) + pad * 2);
					}

					// Polygon fill — dark overlay so it darkens any fill color.
					if (isPolygon && !stylePanelOpen && !isMask && !clipBbox.open) {
						ctx.fillStyle   = '#000000';
						ctx.globalAlpha = isSelected ? 0.08 : 0.05;
						for (const { path2d, bbox } of chunks) {
							const [xMin, yMin, xMax, yMax] = bbox;
							if (xMax < vxMin || xMin > vxMax || yMax < vyMin || yMin > vyMax) continue;
							ctx.fill(path2d, 'evenodd');
						}
					}

					// Polygon stroke thickening — accent outline when selected, orange for clip mask.
					if (isPolygon && isSelected && !stylePanelOpen && !clipBbox.open) {
						ctx.strokeStyle = isMask ? '#f6c87e' : accentColor;
						ctx.lineWidth   = (layer.style.strokeWidth + 1) / mapScale;
						ctx.globalAlpha = 0.6;
						ctx.setLineDash([]);
						for (const { path2d, bbox } of chunks) {
							const [xMin, yMin, xMax, yMax] = bbox;
							if (xMax < vxMin || xMin > vxMax || yMax < vyMin || yMin > vyMax) continue;
							ctx.stroke(path2d);
						}
						ctx.setLineDash([]);
					}

					// Line stroke tint — grey for hover, accent for selected.
					if (hasNonPt && (isLine || !isPolygon) && !stylePanelOpen) {
						ctx.strokeStyle = bboxColor;
						ctx.lineWidth   = (layer.style.strokeWidth + 2) / mapScale;
						ctx.globalAlpha = isSelected ? 0.30 : 0.18;
						ctx.setLineDash([]);
						for (const { path2d, bbox } of chunks) {
							const [xMin, yMin, xMax, yMax] = bbox;
							if (xMax < vxMin || xMin > vxMax || yMax < vyMin || yMin > vyMax) continue;
							ctx.stroke(path2d);
						}
						ctx.setLineDash([]);
					}

					// Point halos — grey for hover, accent for selected.
					if (hasPoints && projection && !stylePanelOpen) {
						const topo = workingTopologyData.get(layer.id);
						if (topo) {
							const objectName = Object.keys(topo.objects)[0];
							const ptData = feature(topo, topo.objects[objectName]) as {
								features?: { geometry?: { type?: string; coordinates?: unknown } }[]
							};
							if (ptData?.features) {
								const sym      = shapeMap[layer.style.pointShape] ?? d3shape.symbolCircle;
								const r        = layer.style.pointRadius;
								const haloArea = Math.PI * r * r * 2.25;
								const haloPath = new Path2D(d3shape.symbol(sym, haloArea)() ?? '');
								const projCenter: [number, number] | null = interactionMode === 'rotate'
									? [-projectionStore.rotate[0], -projectionStore.rotate[1]]
									: null;

								ctx.fillStyle   = bboxColor;
								ctx.globalAlpha = isSelected ? 0.45 : 0.30;

								for (const f of ptData.features) {
									const geom = f?.geometry;
									if (!geom) continue;
									const coordsList: [number, number][] =
										geom.type === 'Point'       ? [geom.coordinates as [number, number]]
										: geom.type === 'MultiPoint' ? (geom.coordinates as [number, number][])
										: [];
									for (const coord of coordsList) {
										if (projCenter && d3.geoDistance(coord, projCenter) >= Math.PI / 2) continue;
										const pt = projection(coord);
										if (!pt) continue;
										ctx.save();
										ctx.translate(pt[0], pt[1]);
										ctx.scale(1 / mapScale, 1 / mapScale);
										ctx.fill(haloPath);
										ctx.restore();
									}
								}
							}
						}
					}
				}
				ctx.restore();
			}
		}

		// Hover pass — grey stroke, subtle dark fill overlay, slightly larger points.
		if ((toolState.active === 'select' || toolState.active === 'edit') && hoveredFeature.value) {
			const hv = hoveredFeature.value;
			if (editSession.activeLayerId === hv.layerId) {
				// Edit layer: draw the hover highlight from the draft (the cache is stale
				// during a session). Skip the currently-targeted feature — it already shows
				// the tint + vertex markers.
				if (hv.featureIndex !== editSession.featureIndex) {
					drawDraftFeatureHighlight(ctx, hv.featureIndex, '#000000', textColor, 0.08, 3 / mapScale);
				}
			} else {
				const isSelected = selection.features.get(hv.layerId)?.has(hv.featureIndex) ?? false;
				if (!isSelected) {
					drawFeatureHighlight(
						ctx,
						hv.layerId,
						hv.featureIndex,
						'#000000',    // polygon fill — dark overlay darkens any fill color
						textColor,    // grey stroke for polygons and lines
						0.08,         // subtle fill opacity
						3 / mapScale, // thicker stroke
						2,            // slightly larger points
					);
				}
			}
		}

		// Selection pass — accent fill, accent border, accent stroke, accent dot.
		// Skipped while editing: the edit-marker pass below is the relevant overlay.
		if (!editSession.activeLayerId) {
			for (const [layerId, featureIndices] of selection.features) {
				for (const fi of featureIndices) {
					drawFeatureHighlight(
						ctx,
						layerId,
						fi,
						accentColor,
						accentColor,
						0.25,         // polygon fill opacity
						4 / mapScale, // thick border for polygons / stroke for lines
						5,            // larger dot for points
					);
				}
			}
		}

		// Vertex-edit pass — fixed-size markers on the targeted feature's vertices.
		// Drawn in CSS-pixel space so markers stay a constant size regardless of zoom.
		if (editSession.activeLayerId && projection) {
			const draft = getDraft();
			if (draft) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const anyDraft = draft as any;

				// Tint the targeted feature (accent fill, projection space) so it stays
				// easy to distinguish from surrounding features while editing.
				const objName = Object.keys(anyDraft.objects)[0];
				const geom = anyDraft.objects[objName].geometries[editSession.featureIndex];
				if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
					const featPathStr = d3.geoPath(projection)(feature(anyDraft, geom));
					if (featPathStr) {
						ctx.globalAlpha = 0.18;
						ctx.fillStyle = accentColor || '#84a000';
						ctx.fill(new Path2D(featPathStr), 'evenodd');
						ctx.globalAlpha = 1;
					}
				}

				const stride = markerStride(); const arcs = anyDraft.arcs as number[][][];
				const arcIndices = featureArcIndices(draft, editSession.featureIndex);

				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				const RADIUS = 4;
				const accent = accentColor || '#2563eb';
				const M = RADIUS + 2; // viewport cull margin
				ctx.lineWidth = 1.5;

				// Decimated markers — every `stride`th vertex, so the drawn count is bounded
				// by screen size rather than the feature's vertex count.
				for (const ai of arcIndices) {
					const arc = arcs[ai];
					if (!arc) continue;
					for (let vi = 0; vi < arc.length; vi += stride) {
						const p = projection(arc[vi] as [number, number]);
						if (!p) continue;
						const sx = p[0] * mapScale + tx;
						const sy = p[1] * mapScale + ty;
						if (sx < -M || sx > width + M || sy < -M || sy > height + M) continue;
						drawMarker(ctx, sx, sy, isVertexSelected(ai, vi), hoveredVertexKey === `${ai}:${vi}`, accent);
					}
				}

				// Selected vertices always drawn on top, regardless of the decimation stride.
				for (const v of getSelectedVertices()) {
					const pt = arcs[v.arcIndex]?.[v.vertexIndex];
					if (!pt) continue;
					const p = projection(pt as [number, number]);
					if (!p) continue;
					const sx = p[0] * mapScale + tx;
					const sy = p[1] * mapScale + ty;
					if (sx < -M || sx > width + M || sy < -M || sy > height + M) continue;
					drawMarker(ctx, sx, sy, true, hoveredVertexKey === `${v.arcIndex}:${v.vertexIndex}`, accent);
				}

				// Point markers — every point of the layer is a directly grabbable handle.
				// Selected point: accent fill + white outline. Others: white fill + accent
				// outline (the hovered one drawn a touch larger as a grab affordance).
				const allGeoms = anyDraft.objects[objName].geometries as { type?: string; coordinates?: number[] | number[][] }[];
				for (let fi = 0; fi < allGeoms.length; fi++) {
					const g = allGeoms[fi];
					if (!g || (g.type !== 'Point' && g.type !== 'MultiPoint')) continue;
					const pCoords: number[][] = g.type === 'Point' ? [g.coordinates as number[]] : g.coordinates as number[][];
					for (let pi = 0; pi < pCoords.length; pi++) {
						const p = projection(pCoords[pi] as [number, number]);
						if (!p) continue;
						const sx = p[0] * mapScale + tx;
						const sy = p[1] * mapScale + ty;
						if (sx < -M || sx > width + M || sy < -M || sy > height + M) continue;
						const key = `${fi}:${pi}`;
						drawMarker(ctx, sx, sy, selectedPoints.has(key), key === hoveredPoint, accent);
					}
				}

				// Ghost insert marker at the hovered edge midpoint. Grows and fills with the
				// accent colour when the cursor is right on it (active, ready to click).
				if (insertHover) {
					const gp = projection(insertHover.geo);
					if (gp) {
						const gx = gp[0] * mapScale + tx;
						const gy = gp[1] * mapScale + ty;
						const accent = accentColor || '#2563eb';
						const gr = overInsertGhost ? RADIUS + 2 : RADIUS;
						const plus = overInsertGhost ? 3 : 2;
						ctx.beginPath();
						ctx.arc(gx, gy, gr, 0, Math.PI * 2);
						if (overInsertGhost) {
							ctx.globalAlpha = 1;
							ctx.fillStyle = accent;
							ctx.fill();
						} else {
							ctx.globalAlpha = 0.6;
							ctx.fillStyle = '#ffffff';
							ctx.fill();
							ctx.globalAlpha = 1;
						}
						ctx.strokeStyle = accent;
						ctx.stroke();
						// Plus sign — white on the filled (active) state, accent otherwise.
						ctx.strokeStyle = overInsertGhost ? '#ffffff' : accent;
						ctx.beginPath();
						ctx.moveTo(gx - plus, gy);
						ctx.lineTo(gx + plus, gy);
						ctx.moveTo(gx, gy - plus);
						ctx.lineTo(gx, gy + plus);
						ctx.stroke();
					}
				}
			}
		}

		// Draw tool: render committed ghost features + the active path + rubber-band preview,
		// all in CSS-pixel space at constant size.
		void drawSession.version; // subscribe so placements/undo repaint
		void drawHover;            // subscribe so the rubber-band follows the cursor
		if (toolState.active === 'draw' && projection) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			const accent = accentColor || '#2563eb';
			const M = 6; // viewport cull margin
			const proj = projection;
			const toScreen = (coord: readonly [number, number]): [number, number] | null => {
				const p = proj(coord as [number, number]);
				return p ? [p[0] * mapScale + tx, p[1] * mapScale + ty] : null;
			};
			const onScreen = (s: [number, number]) => !(s[0] < -M || s[0] > width + M || s[1] < -M || s[1] > height + M);

			// Strokes a polyline through coords; optionally closes the ring and fills it faintly.
			const strokePath = (coords: readonly [number, number][], close: boolean, fill: boolean) => {
				ctx.beginPath();
				let started = false;
				for (const c of coords) {
					const s = toScreen(c);
					if (!s) continue;
					if (!started) { ctx.moveTo(s[0], s[1]); started = true; } else ctx.lineTo(s[0], s[1]);
				}
				if (!started) return;
				if (close) ctx.closePath();
				if (fill) { ctx.save(); ctx.globalAlpha = 0.13; ctx.fillStyle = accent; ctx.fill(); ctx.restore(); }
				ctx.strokeStyle = accent;
				ctx.lineWidth = 1.5;
				ctx.stroke();
			};

			// highlightLast draws the most recently placed vertex in the selected (filled) style.
			const markers = (coords: readonly [number, number][], highlightLast = false) => {
				for (let i = 0; i < coords.length; i++) {
					const s = toScreen(coords[i]);
					if (s && onScreen(s)) drawMarker(ctx, s[0], s[1], highlightLast && i === coords.length - 1, false, accent);
				}
			};

			// Committed (finished-this-session) features — clean stroke/fill, no vertex handles.
			for (const f of getCommitted()) {
				if (f.type === 'Point') {
					const s = toScreen(f.coords[0]);
					if (s && onScreen(s)) drawMarker(ctx, s[0], s[1], false, false, accent);
				} else if (f.type === 'LineString') {
					strokePath(f.coords, false, false);
				} else {
					strokePath(f.coords, true, true);
				}
			}

			// Active path being drawn (line/polygon), plus the rubber-band to the cursor.
			const active = getActivePath();
			if (active.length > 0) {
				strokePath(active, false, false);
				const last = toScreen(active[active.length - 1]);
				if (drawHover && last) {
					// Current-position line: last placed vertex → cursor (solid accent).
					ctx.save();
					ctx.strokeStyle = accent;
					ctx.lineWidth = 1.5;
					ctx.setLineDash([4, 4]);
					ctx.beginPath();
					ctx.moveTo(last[0], last[1]);
					ctx.lineTo(drawHover.x, drawHover.y);
					ctx.stroke();
					ctx.restore();
					// Polygon closing-edge hint: cursor → first vertex, drawn fainter to
					// distinguish it from the line you're actively extending.
					if (drawSession.drawType === 'polygon' && active.length >= 2) {
						const first = toScreen(active[0]);
						if (first) {
							ctx.save();
							ctx.globalAlpha = 0.35;
							ctx.strokeStyle = accent;
							ctx.lineWidth = 1.5;
							ctx.setLineDash([4, 4]);
							ctx.beginPath();
							ctx.moveTo(drawHover.x, drawHover.y);
							ctx.lineTo(first[0], first[1]);
							ctx.stroke();
							ctx.restore();
						}
					}
				}
				markers(active, true);
			}
		}

	});
</script>

<div class="map-canvas">
	<div class="canvas-area" class:table-open={featuresTable.open} bind:this={containerEl}>
		<div class="bottom-center">
			<LayerActionBar {getViewportBbox} />
			{#if editSession.activeLayerId}
				<EditSessionBar />
			{:else if toolState.active === 'draw'}
				<DrawBar />
			{:else}
				<SelectionBar />
			{/if}
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
			class:select-mode={toolState.active === 'select' && !spacePanning}
			class:edit-mode={toolState.active === 'edit' && !spacePanning}
			class:draw-mode={toolState.active === 'draw' && !spacePanning}
			class:vertex-grab={toolState.active === 'edit' && overVertex && !vertexDrag && !spacePanning && !metaHeld}
			class:insert-ghost-hover={toolState.active === 'edit' && overInsertGhost && !vertexDrag && !spacePanning && !metaHeld}
			class:vertex-grabbing={vertexDrag !== null || pointDrag !== null}
			class:space-pan={spacePanning}
			class:feature-hover={(toolState.active === 'select' || toolState.active === 'edit') && !spacePanning && hoveredFeature.value !== null}
			class:layer-hover={toolState.active === 'select' && !spacePanning && layerSelection.hoveredLayerId !== null && hoveredFeature.value === null}
	
			onclick={handleClick}
			ondblclick={handleDblClick}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointerleave={() => { hoveredFeature.value = null; setHoveredLayer(null); insertHover = null; overVertex = false; overInsertGhost = false; hoveredPoint = null; hoveredVertexKey = null; }}
		></canvas>

		{#if showBezierOutlineNote}
			<div class="bezier-outline-note">
				<span>Highlights may not match the smoothed outline for layers with bezier smoothing enabled</span>
				<button class="note-dismiss" aria-label="Dismiss" onclick={() => (bezierNoteDismissed = true)}>×</button>
			</div>
		{/if}

		{#if clipBbox.open && clipBbox.mode === 'bbox'}
		<svg class="clip-bbox-overlay" ondragstart={(e) => e.preventDefault()}>
			{#if bboxPath}
			<path d={bboxPath} class="bbox-outline" />
			{/if}
			{#if bboxCorners}
				{#each ([['nw', bboxCorners.nw], ['ne', bboxCorners.ne], ['se', bboxCorners.se], ['sw', bboxCorners.sw]] as const) as [handle, pt]}
					{#if pt}
					<rect
						x={pt[0] - 5}
						y={pt[1] - 5}
						width={10}
						height={10}
						class="bbox-handle"
						onmousedown={(e) => startHandleDrag(e, handle)}
					/>
					{/if}
				{/each}
			{/if}
		</svg>
		{/if}

		{#if featuresTable.open}
			<FeaturesTable />
		{/if}
	</div>

	{#if editSession.pendingBake}
		<ConfirmModal
			title="Bake processing to edit?"
			message="To edit this layer's vertices, it will be duplicated with its current simplified and smoothed geometry baked in as the new shape. Any further simplification or smoothing will apply on top of that. The original layer is kept."
			confirmLabel="Bake & edit"
			onconfirm={confirmBake}
			oncancel={cancelBake}
		/>
	{/if}
</div>

<style>
	.map-canvas {
		flex: 1;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.canvas-area {
		position: relative;
		flex: 1;
		min-height: 0;
		background-color: #ffffff;
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

	canvas.edit-mode {
		cursor: default;
	}

	canvas.draw-mode {
		cursor: crosshair;
	}

	canvas.vertex-grab {
		cursor: pointer;
	}

	canvas.insert-ghost-hover {
		cursor: pointer;
	}

	.bezier-outline-note {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: flex-start;
		gap: 10px;
		max-width: 320px;
		background: rgba(20, 24, 25, 0.82);
		color: #ffffff;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 16px;
		padding: 8px 10px 8px 12px;
		border-radius: 6px;
		z-index: 5;
	}

	.note-dismiss {
		flex-shrink: 0;
		border: none;
		background: transparent;
		color: #ffffff;
		font-size: 16px;
		line-height: 14px;
		padding: 0;
		cursor: pointer;
		opacity: 0.8;
	}

	.note-dismiss:hover {
		opacity: 1;
	}


	canvas.vertex-grabbing {
		cursor: grabbing;
	}

	canvas.space-pan {
		cursor: grab;
	}

	canvas.space-pan.dragging {
		cursor: grabbing;
	}

	canvas.feature-hover,
	canvas.layer-hover {
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
		transition: bottom 150ms ease;
	}

	.canvas-area.table-open .bottom-center {
		bottom: calc(260px + var(--space-m));
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
		transition: bottom 150ms ease;
	}

	.canvas-area.table-open .bottom-right-stack {
		bottom: calc(260px + var(--space-m));
	}

	.clip-bbox-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}

	.bbox-outline {
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 1.5;
		stroke-dasharray: 6 4;
		opacity: 0.8;
	}

	.bbox-handle {
		fill: white;
		stroke: var(--color-accent);
		stroke-width: 1.5;
		rx: 2;
		pointer-events: all;
		cursor: grab;
	}

	.bbox-handle:hover {
		fill: var(--color-accent);
	}

</style>
