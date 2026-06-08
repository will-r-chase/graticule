<script lang="ts">
	import { onMount } from 'svelte';
	import * as d3 from 'd3-geo';
	import { feature } from 'topojson-client';
	import type { Topology } from 'topojson-specification';
	import type { FeatureCollection } from 'geojson';
	import { PUBLIC_R2_URL } from '$env/static/public';
	import { countTopoPoints, applyChaikinToTopology } from '$lib/utils/chaikin';
	import { buildBezierArcs, buildTopoPath, type BezierArc, type BezierCurveType } from '$lib/utils/bezier';

	// mapshaper loaded via script tags in onMount — see loadScript() below.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let ms: any = null;

	const DATASET_URL = `${PUBLIC_R2_URL}/natural-earth/admin-0-countries/ne_10m.topojson`;

	// ── Canvas ───────────────────────────────────────────────────────────────
	let containerEl = $state<HTMLDivElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let width = $state(0);
	let height = $state(0);

	// ── Status ───────────────────────────────────────────────────────────────
	let status = $state<'loading' | 'processing' | 'ready' | 'error'>('loading');

	// Geodata lives outside $state — same pattern as the main app.
	// processVersion is the reactive signal that a new frame is ready to paint.
	let rawTopology: Topology | null = null;
	let workingTopology: Topology | null = null;  // post-pipeline (post-simplify, post-Chaikin)
	let displayData: FeatureCollection | null = null;
	let processVersion = $state(0);
	let cachedPath2d: Path2D | null = null;
	let bezierArtifactWarning = $state(false);

	// ── Controls: Simplification ─────────────────────────────────────────────
	let simpAlgorithm = $state<'weighted' | 'dp' | 'visvalingam'>('weighted');
	let simpTolerance = $state(0);   // user-facing value, 0–100
	let simpKeepShapes = $state(false);
	let simpWeight = $state(0.7);    // only used when algorithm === 'weighted'

	// Non-linear slider: 0–950 maps to value 0–95 (coarse zone, 0.1 steps),
	// 950–1450 maps to value 95–100 (fine zone, 0.01 steps).
	// simpTolerance is the source of truth; the slider position is derived from it.
	function posToValue(pos: number): number {
		if (pos <= 950) return parseFloat((pos * 0.1).toFixed(1));
		return parseFloat((95 + (pos - 950) * 0.01).toFixed(2));
	}
	function valueToPos(val: number): number {
		if (val <= 95) return Math.round(val / 0.1);
		return Math.round(950 + (val - 95) / 0.01);
	}

	// ── Controls: Chaikin ────────────────────────────────────────────────────
	let chaikinEnabled = $state(false);
	let chaikinIterations = $state(2);
	let chaikinWarning = $state<string | null>(null);

	const CHAIKIN_POINT_LIMIT = 500_000;

	// ── Controls: Debug ──────────────────────────────────────────────────────
	let debugStrokeOnly = $state(false);

	// ── Controls: Bezier ─────────────────────────────────────────────────────
	let bezierEnabled = $state(false);
	let bezierCurveType = $state<BezierCurveType>('catmull-rom');
	let bezierTension = $state(0.5);
	let bezierAlpha = $state(0.5);       // Catmull-Rom only: 0=uniform, 0.5=centripetal, 1=chordal
	let bezierContinuity = $state(0);    // K-B only: 0=smooth, –1=sharp, 1=loop
	let bezierBias = $state(0);          // K-B only: 0=symmetric, 1=forward, –1=backward

	// ── Pan / zoom ────────────────────────────────────────────────────────────
	// Plain variables — not $state. Only render() reads them; no need for
	// Svelte's reactive machinery firing on every pointermove/wheel event.
	let tx = 0;
	let ty = 0;
	let mapScale = 1;
	let isDragging = $state(false); // $state only for the cursor style binding
	let hasPanned = $state(false);  // $state only for the reset-button visibility
	let dragStart = { x: 0, y: 0, tx: 0, ty: 0 };

	// Render is always scheduled via rAF so we never paint more than once per
	// frame, even if wheel/pointermove fire several times between frames.
	let rafId: number | null = null;
	function scheduleRender() {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => { rafId = null; render(); });
	}

	function handlePointerDown(e: PointerEvent) {
		isDragging = true;
		dragStart = { x: e.clientX, y: e.clientY, tx, ty };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging) return;
		tx = dragStart.tx + (e.clientX - dragStart.x);
		ty = dragStart.ty + (e.clientY - dragStart.y);
		hasPanned = true;
		scheduleRender();
	}

	function handlePointerUp() {
		isDragging = false;
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		if (!canvasEl) return;
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const rect = canvasEl.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		tx = mx - (mx - tx) * factor;
		ty = my - (my - ty) * factor;
		mapScale *= factor;
		hasPanned = true;
		scheduleRender();
	}

	function resetView() {
		tx = 0;
		ty = 0;
		mapScale = 1;
		hasPanned = false;
		render();
	}

	// ── Projection ───────────────────────────────────────────────────────────
	let projection = $derived.by(() => {
		if (!width || !height) return null;
		return d3.geoNaturalEarth1().fitSize([width, height], { type: 'Sphere' });
	});

	// ── Load mapshaper + data on mount ───────────────────────────────────────
	// Mapshaper is a CJS package that checks `typeof Buffer != 'undefined'` at
	// line 57 of its bundle. In the browser Buffer isn't a global, so it falls
	// through to require$1('buffer') — which is undefined and throws.
	// Fix: provide Buffer globally BEFORE importing mapshaper, then dynamic-
	// import it so it only ever runs in the browser (never during SSR/build).
	function loadScript(src: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const el = document.createElement('script');
			el.src = src;
			el.onload = () => resolve();
			el.onerror = () => reject(new Error(`Failed to load ${src}`));
			document.head.appendChild(el);
		});
	}

	onMount(async () => {
		try {
			// Load mapshaper the way its own web app does: modules.js first (sets
			// window.modules with flatbush, mproj, buffer, etc.), then mapshaper.js
			// (uses window.modules via its require$1 function). Both are copied from
			// node_modules/mapshaper/www/ into static/ so they're served as plain scripts.
			await loadScript('/mapshaper-modules.js');
			await loadScript('/mapshaper.js');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			ms = (window as any).mapshaper;

			const r = await fetch(DATASET_URL);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			rawTopology = (await r.json()) as Topology;
			runPipeline();
		} catch (e) {
			console.error('Experiments init failed:', e);
			status = 'error';
		}
	});

	// ── Re-run pipeline when any control changes (debounced 300ms) ────────────
	// The Svelte 5 cleanup return cancels the previous timer on each re-run,
	// which is the idiomatic way to debounce inside an effect.
	$effect(() => {
		void [simpAlgorithm, simpTolerance, simpKeepShapes, simpWeight, chaikinEnabled, chaikinIterations];
		if (!rawTopology) return;

		const timer = setTimeout(runPipeline, 300);
		return () => clearTimeout(timer);
	});

	// ── Rebuild path + repaint when projection changes or new data is ready ──
	// Path2D is built once here; pan/zoom calls render() directly without
	// re-projecting all coordinates on every frame.
	// Bezier is a rendering concern — it lives here, not in the pipeline.
	$effect(() => {
		void projection;
		void processVersion;
		void bezierEnabled;
		void bezierCurveType;
		void bezierTension;
		void bezierAlpha;
		void bezierContinuity;
		void bezierBias;
		void debugStrokeOnly;
		if (!projection || !displayData) {
			cachedPath2d = null;
			render();
			return;
		}
		if (bezierEnabled && workingTopology) {
			const bezierArcs = buildBezierArcs(workingTopology, projection, bezierCurveType, bezierTension, bezierAlpha, bezierContinuity, bezierBias);
			bezierArtifactWarning = bezierArcs.some(arc => arc.segs.some(s => s.isBreak));
			debugBezierArcs(bezierArcs, workingTopology, projection);
			cachedPath2d = buildTopoPath(workingTopology, bezierArcs);
		} else {
			bezierArtifactWarning = false;
			const svgPath = d3.geoPath(projection)(displayData as d3.GeoPermissibleObjects);
			cachedPath2d = svgPath ? new Path2D(svgPath) : null;
		}
		render();
	});

	// ── Topology-aware screen-space Bezier (Catmull-Rom → cubic) ─────────────
	// Each topology arc is projected to screen space and gets Catmull-Rom
	// control points computed with reflected ghost endpoints — so the control
	// points are derived purely from the arc itself, not from ring context.
	// Rings are then assembled directly from topology arc index references
	// (honouring forward/reversed arcs). Shared borders produce identical
	// C commands on both sides → no gaps.


	function debugBezierArcs(arcs: BezierArc[], topo: Topology, proj: d3.GeoProjection) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyTopo = topo as any;
		const transform = anyTopo.transform as { scale: [number,number]; translate: [number,number] } | undefined;
		const [scx, scy] = transform ? transform.scale : [1, 1];
		const [otx, oty] = transform ? transform.translate : [0, 0];
		const hasTransform = !!transform;
		const projWidth = proj.translate()[0] * 2;

		// Helper: decode geographic coords for a given arc index
		function decodeArcGeo(ai: number): [number,number][] {
			const rawArc = (anyTopo.arcs as number[][][])[ai];
			const geo: [number,number][] = [];
			if (hasTransform) {
				let qx = 0, qy = 0;
				for (const [dqx, dqy] of rawArc) { qx += dqx; qy += dqy; geo.push([qx*scx+otx, qy*scy+oty]); }
			} else {
				for (const [gx, gy] of rawArc) geo.push([gx, gy]);
			}
			return geo;
		}

		let breaksCaught = 0;
		let slippingThrough = 0;

		arcs.forEach((arc, ai) => {
			const geo = decodeArcGeo(ai);
			const paired = geo.map(g => proj(g) as [number,number] | null).map((p, i) => ({ geo: geo[i], p })).filter(x => x.p !== null);

			let prevEx = arc.sx;
			let prevEy = arc.sy;
			arc.segs.forEach((seg, si) => {
				if (seg.isBreak) {
					breaksCaught++;
					const p1geo = paired[si]?.geo;
					const p2geo = paired[si + 1]?.geo;
					const p1screen = paired[si]?.p;
					const p2screen = paired[si + 1]?.p;
					const screenDist = Math.hypot((p2screen?.[0] ?? 0) - (p1screen?.[0] ?? 0), (p2screen?.[1] ?? 0) - (p1screen?.[1] ?? 0));
					console.log(`[bezier] BREAK arc ${ai} seg ${si}: geo p1=${p1geo?.map(v=>v.toFixed(2))} p2=${p2geo?.map(v=>v.toFixed(2))} | lonDiff=${p1geo && p2geo ? Math.abs(p1geo[0]-p2geo[0]).toFixed(1) : '?'} | screen p1=(${p1screen?.map(v=>Math.round(v))}) p2=(${p2screen?.map(v=>Math.round(v))}) | screenDist=${Math.round(screenDist)}px (${Math.round(screenDist/projWidth*100)}% of canvas)`);
				} else {
					const dist = Math.hypot(seg.ex - prevEx, seg.ey - prevEy);
					if (dist > 300) {
						slippingThrough++;
						const p1geo = paired[si]?.geo;
						const p2geo = paired[si + 1]?.geo;
						const cp1dist = Math.hypot(seg.cp1x - prevEx, seg.cp1y - prevEy);
						const cp2dist = Math.hypot(seg.cp2x - seg.ex, seg.cp2y - seg.ey);
						const p1screen = paired[si]?.p;
						const p2screen = paired[si + 1]?.p;
						console.log(`[bezier] MISSED arc ${ai} seg ${si}: endpoint dist=${Math.round(dist)}px | geo p1=${p1geo?.map(v=>v.toFixed(2))} p2=${p2geo?.map(v=>v.toFixed(2))} | lonDiff=${p1geo && p2geo ? Math.abs(p1geo[0]-p2geo[0]).toFixed(1) : '?'} | screen p1=(${p1screen?.map(v=>Math.round(v))}) p2=(${p2screen?.map(v=>Math.round(v))}) | prevEnd=(${Math.round(prevEx)},${Math.round(prevEy)}) segEnd=(${Math.round(seg.ex)},${Math.round(seg.ey)}) | cp1dist=${Math.round(cp1dist)}px cp2dist=${Math.round(cp2dist)}px`);
					}
				}
				prevEx = seg.ex;
				prevEy = seg.ey;
			});
		});
		console.log(`[bezier] summary: ${breaksCaught} breaks caught, ${slippingThrough} slipping through | projWidth=${Math.round(projWidth)}px`);
	}

	// ── Processing pipeline ───────────────────────────────────────────────────
	async function runPipeline() {
		if (!rawTopology || !ms) return;
		status = 'processing';
		chaikinWarning = null;

		try {
			// Step 1 — Mapshaper simplification.
			// We pass the raw TopoJSON so mapshaper uses the topology to simplify
			// shared borders consistently (no gaps or overlaps between countries).
			// Slider is 0 = no change, 100 = heavy, so we invert to get retain %.
			const retainPct = 100 - simpTolerance;
			const keepShapes = simpKeepShapes ? 'keep-shapes' : '';
			const weightParam = simpAlgorithm === 'weighted' ? `weighting=${simpWeight}` : '';
			const cmd = `-i input.topojson -simplify ${retainPct}% ${simpAlgorithm} ${weightParam} ${keepShapes} -o output.topojson format=topojson`
				.replace(/\s+/g, ' ').trim();

			const output = await ms.applyCommands(cmd, {
				'input.topojson': JSON.stringify(rawTopology)
			});

			// Step 2 — Chaikin smoothing, applied to topology arcs before feature().
			// This ensures shared borders are smoothed once so adjacent countries
			// stay perfectly aligned (no gaps).
			let workingTopo = JSON.parse(output['output.topojson']) as Topology;
			if (chaikinEnabled) {
				const currentPts = countTopoPoints(workingTopo);
				const estimatedPts = currentPts * Math.pow(2, chaikinIterations);
				if (estimatedPts > CHAIKIN_POINT_LIMIT) {
					chaikinWarning = `~${Math.round(estimatedPts / 1000)}k points estimated — simplify more or reduce iterations.`;
				} else {
					workingTopo = applyChaikinToTopology(workingTopo, chaikinIterations);
				}
			}

			// Convert to GeoJSON for rendering.
			const objectName = Object.keys(workingTopo.objects)[0];
			let geojson = feature(workingTopo, workingTopo.objects[objectName]) as FeatureCollection;

			workingTopology = workingTopo;
			displayData = geojson;
			processVersion++;
			status = 'ready';
		} catch (e) {
			console.error('Pipeline error:', e);
			status = 'error';
		}
	}

	// ── Canvas render ─────────────────────────────────────────────────────────
	function render() {
		if (!canvasEl || !cachedPath2d || !width || !height) return;

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
		ctx.fillStyle = '#f4f4f5';
		ctx.fillRect(0, 0, width, height);

		ctx.save();
		ctx.translate(tx, ty);
		ctx.scale(mapScale, mapScale);
		if (!debugStrokeOnly) {
			ctx.fillStyle = '#ffffff';
			ctx.fill(cachedPath2d);
		}
		ctx.strokeStyle = '#161819';
		ctx.lineWidth = 0.5 / mapScale;
		ctx.stroke(cachedPath2d);
		ctx.restore();
	}

	// ── ResizeObserver ────────────────────────────────────────────────────────
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

	// ── Non-passive wheel listener (preventDefault blocks page scroll) ────────
	$effect(() => {
		if (!canvasEl) return;
		const el = canvasEl;
		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => el.removeEventListener('wheel', handleWheel);
	});
</script>

<div class="page">
	<!-- ── Canvas area ────────────────────────────────────────────────────── -->
	<div class="canvas-area" bind:this={containerEl}>
		{#if status === 'loading'}
			<div class="overlay">Loading…</div>
		{:else if status === 'error'}
			<div class="overlay error">Failed to load dataset.<br />Check the R2 URL in the console.</div>
		{/if}

		{#if status === 'processing'}
			<div class="processing-badge">Processing…</div>
		{/if}

		<canvas
			bind:this={canvasEl}
			style:cursor={isDragging ? 'grabbing' : 'grab'}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		></canvas>

		{#if hasPanned}
			<button class="reset-view-btn mono-small" onclick={resetView}>Reset view</button>
		{/if}
	</div>

	<!-- ── Sidebar ───────────────────────────────────────────────────────── -->
	<aside class="sidebar">
		<div class="sidebar-inner">
			<h3>Experiments</h3>

			<!-- Simplification -->
			<section>
				<h4>Simplification</h4>

				<div class="control-group">
					<span class="label">Algorithm</span>
					<div class="segmented">
						<button
							class:active={simpAlgorithm === 'weighted'}
							onclick={() => (simpAlgorithm = 'weighted')}
						>
							Visvalingam / Weighted
						</button>
						<button
							class:active={simpAlgorithm === 'dp'}
							onclick={() => (simpAlgorithm = 'dp')}
						>
							Douglas–Peucker
						</button>
						<button
							class:active={simpAlgorithm === 'visvalingam'}
							onclick={() => (simpAlgorithm = 'visvalingam')}
						>
							Visvalingam
						</button>
					</div>
				</div>

			{#if simpAlgorithm === 'weighted'}
					<div class="control-group">
						<span class="label">Weight</span>
						<div class="slider-row">
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								bind:value={simpWeight}
							/>
							<span class="value">{simpWeight.toFixed(2)}</span>
						</div>
						<span class="hint">0 = pure area · 1 = perimeter ratio</span>
					</div>
				{/if}

				<div class="control-group">
					<span class="label">Amount</span>
					<div class="slider-row">
						<input
							type="range"
							min="0"
							max="1450"
							step="1"
							value={valueToPos(simpTolerance)}
							oninput={(e) => simpTolerance = posToValue(Number((e.currentTarget as HTMLInputElement).value))}
						/>
						<input
							class="number-input"
							type="number"
							min="0"
							max="100"
							step="0.01"
							bind:value={simpTolerance}
						/>
					</div>
					<span class="hint">0 = no change · 100 = maximum</span>
				</div>

				<label class="checkbox-label">
					<input type="checkbox" bind:checked={simpKeepShapes} />
					Keep small shapes
				</label>
			</section>

			<div class="divider"></div>

			<!-- Chaikin smoothing -->
			<section>
				<div class="section-header">
					<h4>Chaikin Smoothing</h4>
					<label class="toggle">
						<input type="checkbox" bind:checked={chaikinEnabled} />
						<span class="toggle-track"></span>
					</label>
				</div>

				{#if chaikinEnabled}
					<div class="control-group">
						<span class="label">Iterations</span>
						<div class="slider-row">
							<input
								type="range"
								min="1"
								max="4"
								step="1"
								bind:value={chaikinIterations}
							/>
							<span class="value">{chaikinIterations}</span>
						</div>
						<span class="hint">Each iteration doubles the point count.</span>
					</div>
					{#if chaikinWarning}
						<p class="chaikin-warning">{chaikinWarning}</p>
					{/if}
				{/if}
			</section>

			<div class="divider"></div>

			<!-- Bezier fitting -->
			<section>
				<div class="section-header">
					<h4>Bezier Fitting</h4>
					<label class="toggle">
						<input type="checkbox" bind:checked={bezierEnabled} />
						<span class="toggle-track"></span>
					</label>
				</div>

				{#if bezierEnabled}
					<div class="control-group">
						<span class="label">Curve type</span>
						<div class="segmented">
							<button
								class:active={bezierCurveType === 'catmull-rom'}
								onclick={() => bezierCurveType = 'catmull-rom'}
							>Catmull-Rom</button>
							<button
								class:active={bezierCurveType === 'kb'}
								onclick={() => bezierCurveType = 'kb'}
							>Kochanek-Bartels</button>
							<button
								class:active={bezierCurveType === 'bspline'}
								onclick={() => bezierCurveType = 'bspline'}
							>B-spline</button>
						</div>
					</div>

					<div class="control-group">
						<span class="label">Tension</span>
						<div class="slider-row">
							<input type="range" min="0" max="1" step="0.01" bind:value={bezierTension} />
							<span class="value">{bezierTension.toFixed(2)}</span>
						</div>
						<span class="hint">0 = straight · 1 = full effect</span>
					</div>

					{#if bezierCurveType === 'catmull-rom'}
						<div class="control-group">
							<span class="label">Alpha</span>
							<div class="slider-row">
								<input type="range" min="0" max="1" step="0.05" bind:value={bezierAlpha} />
								<span class="value">{bezierAlpha.toFixed(2)}</span>
							</div>
							<span class="hint">0 = uniform · 0.5 = centripetal · 1 = chordal</span>
						</div>
					{/if}

					{#if bezierCurveType === 'kb'}
						<div class="control-group">
							<span class="label">Continuity</span>
							<div class="slider-row">
								<input type="range" min="-1" max="1" step="0.05" bind:value={bezierContinuity} />
								<span class="value">{bezierContinuity.toFixed(2)}</span>
							</div>
							<span class="hint">0 = smooth · –1 = sharp · 1 = loop</span>
						</div>
						<div class="control-group">
							<span class="label">Bias</span>
							<div class="slider-row">
								<input type="range" min="-1" max="1" step="0.05" bind:value={bezierBias} />
								<span class="value">{bezierBias.toFixed(2)}</span>
							</div>
							<span class="hint">0 = symmetric · 1 = forward · –1 = backward</span>
						</div>
					{/if}

				{#if bezierArtifactWarning}
					<p class="artifact-warning">Some borders near ±180° longitude may show fill or stroke artifacts at these settings.</p>
				{/if}
				{/if}
			</section>

			<div class="divider"></div>

			<!-- Debug -->
			<section>
				<h4>Debug</h4>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={debugStrokeOnly} />
					Stroke only (no fill)
				</label>
			</section>
		</div>
	</aside>
</div>

<style>
	.page {
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--color-surface-primary);
	}

	/* ── Canvas area ──────────────────────────────────────────────────────── */
	.canvas-area {
		position: relative;
		flex: 1;
		height: 100%;
		overflow: hidden;
		background: var(--color-surface-secondary);
	}

	canvas {
		display: block;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		color: var(--color-text-secondary);
		text-align: center;
	}

	.overlay.error {
		color: var(--color-error);
	}

	.processing-badge {
		position: absolute;
		top: var(--space-m);
		left: var(--space-m);
		padding: var(--space-xs) var(--space-s);
		background: var(--color-surface-invert);
		color: var(--color-text-invert);
		font-family: var(--font-mono);
		font-size: 12px;
		border-radius: var(--radius);
		pointer-events: none;
	}

	.reset-view-btn {
		position: absolute;
		bottom: var(--space-m);
		right: var(--space-m);
		padding: var(--space-xs) var(--space-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-secondary);
		font-size: 12px;
		cursor: pointer;
	}

	.reset-view-btn:hover {
		background: var(--color-surface-secondary);
		color: var(--color-text-primary);
	}

	/* ── Sidebar ──────────────────────────────────────────────────────────── */
	.sidebar {
		width: 280px;
		flex-shrink: 0;
		height: 100%;
		border-left: 1px solid var(--color-border);
		background: var(--color-surface-primary);
		overflow-y: auto;
	}

	.sidebar-inner {
		padding: var(--space-l);
		display: flex;
		flex-direction: column;
		gap: var(--space-l);
	}

	h3 {
		margin: 0;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.divider {
		height: 1px;
		background: var(--color-border);
		margin: 0 calc(-1 * var(--space-l));
	}

	/* ── Control groups ───────────────────────────────────────────────────── */
	.control-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.label {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.hint {
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	.chaikin-warning,
	.artifact-warning {
		margin: 0;
		font-size: 12px;
		color: var(--color-error, #e53e3e);
	}

	/* ── Segmented control ────────────────────────────────────────────────── */
	.segmented {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.segmented button {
		width: 100%;
		padding: var(--space-s) var(--space-m);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		transition: background 100ms ease;
	}

	.segmented button:hover {
		background: var(--color-surface-secondary);
	}

	.segmented button.active {
		background: var(--color-accent-subtle);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	/* ── Slider ───────────────────────────────────────────────────────────── */
	.slider-row {
		display: flex;
		align-items: center;
		gap: var(--space-m);
	}

	.slider-row input[type='range'] {
		flex: 1;
		height: 4px;
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	.value {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
		min-width: 36px;
		text-align: right;
	}

	.number-input {
		width: 56px;
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-primary);
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 2px 4px;
		text-align: right;
		appearance: textfield;
	}

	.number-input::-webkit-inner-spin-button,
	.number-input::-webkit-outer-spin-button {
		opacity: 0.4;
	}

	/* ── Checkbox ─────────────────────────────────────────────────────────── */
	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		font-size: 13px;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	/* ── Toggle ───────────────────────────────────────────────────────────── */
	.toggle {
		position: relative;
		display: inline-block;
		width: 32px;
		height: 18px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.toggle input {
		opacity: 0;
		width: 0;
		height: 0;
		position: absolute;
	}

	.toggle-track {
		position: absolute;
		inset: 0;
		border-radius: 9px;
		background: var(--color-border);
		transition: background 100ms ease;
	}

	.toggle-track::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: white;
		transition: transform 100ms ease;
	}

	.toggle input:checked + .toggle-track {
		background: var(--color-accent);
	}

	.toggle input:checked + .toggle-track::after {
		transform: translateX(14px);
	}
</style>
