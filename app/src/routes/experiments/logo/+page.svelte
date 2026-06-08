<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3-geo';
	// d3-geo-projection ships no TypeScript types
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	import * as d3proj from 'd3-geo-projection';

	const mollweideRaw = d3proj.geoMollweideRaw as d3.GeoRawProjection;

	let width = $state(0);
	let height = $state(0);

	// ── Controls ─────────────────────────────────────────────────────────────
	let graticuleStep = $state(30);
	let strokeWidth = $state(1);
	let showSphere = $state(true);
	let transitionDuration = $state(2); // seconds per phase

	// ── Geo data ──────────────────────────────────────────────────────────────
	const sphere = { type: 'Sphere' } as const;
	let graticuleData = $derived(d3.geoGraticule().step([graticuleStep, graticuleStep])());

	// ── Helpers ───────────────────────────────────────────────────────────────
	function easeInOut(t: number) {
		return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	}

	function lerp(a: number, b: number, t: number) {
		return (1 - t) * a + t * b;
	}

	// ── Raw projections ───────────────────────────────────────────────────────
	// Phase 1: Equirectangular → Mollweide (both have real raw functions)
	const rawEquirect: d3.GeoRawProjection = d3.geoEquirectangularRaw;
	const rawMollweide: d3.GeoRawProjection = mollweideRaw;

	// Phase 2 target: Waterman Butterfly
	// Polyhedral projections have no accessible raw function, so we wrap the
	// full fitted projection and un-apply its scale/translate to fake one.
	let watermanProj = $derived.by(() => {
		if (!width || !height) return null;
		return (d3proj.geoPolyhedralWaterman() as d3.GeoProjection)
			.fitExtent([[0.5, 0.5], [width - 0.5, height - 0.5]], sphere);
	});

	let rawWaterman = $derived.by((): d3.GeoRawProjection | null => {
		if (!watermanProj) return null;
		const s = watermanProj.scale();
		const [tx, ty] = watermanProj.translate();
		return (lambda: number, phi: number): [number, number] => {
			const p = watermanProj!([lambda * 180 / Math.PI, phi * 180 / Math.PI]);
			if (!p) return [0, 0]; // cut points collapse toward origin
			// d3 raw functions use y-up coords; screen coords are y-down.
			// d3 applies: y_screen = -k * raw_y + ty, so inverse: raw_y = -(y_screen - ty) / k
			return [(p[0] - tx) / s, -(p[1] - ty) / s];
		};
	});

	// ── Fits: scale + translate for each raw projection ───────────────────────
	let fitEquirect = $derived.by(() => {
		if (!width || !height) return null;
		const p = d3.geoProjection(rawEquirect).fitExtent([[0.5, 0.5], [width - 0.5, height - 0.5]], sphere);
		return { scale: p.scale(), translate: p.translate() as [number, number] };
	});

	let fitMollweide = $derived.by(() => {
		if (!width || !height) return null;
		const p = d3.geoProjection(rawMollweide).fitExtent([[0.5, 0.5], [width - 0.5, height - 0.5]], sphere);
		return { scale: p.scale(), translate: p.translate() as [number, number] };
	});

	let fitWaterman = $derived.by(() => {
		if (!watermanProj) return null;
		return { scale: watermanProj.scale(), translate: watermanProj.translate() as [number, number] };
	});

	// ── Build interpolated projection ─────────────────────────────────────────
	function buildProjection(
		rawA: d3.GeoRawProjection,
		fitA: { scale: number; translate: [number, number] },
		rawB: d3.GeoRawProjection,
		fitB: { scale: number; translate: [number, number] },
		t: number
	): d3.GeoProjection {
		return d3.geoProjection((x: number, y: number): [number, number] => {
			const [x0, y0] = rawA(x, y);
			const [x1, y1] = rawB(x, y);
			return [lerp(x0, x1, t), lerp(y0, y1, t)];
		})
			.scale(lerp(fitA.scale, fitB.scale, t))
			.translate([
				lerp(fitA.translate[0], fitB.translate[0], t),
				lerp(fitA.translate[1], fitB.translate[1], t)
			])
			.precision(0.1);
	}

	// ── Animation ─────────────────────────────────────────────────────────────
	// animT: 0 = Equirectangular, 0.5 = Mollweide, 1 = Waterman Butterfly
	// Each phase (0→0.5, 0.5→1) gets its own ease-in-out.
	let animT = $state(0);
	let playing = $state(false);
	let direction = 1;
	let lastTime: number | null = null;
	let rafId: number | null = null;

	// Total duration = 2 phases × transitionDuration
	function tick(now: number) {
		if (lastTime !== null) {
			const dt = now - lastTime;
			animT = Math.max(0, Math.min(1, animT + direction * dt / (transitionDuration * 2 * 1000)));
			if (animT >= 1) direction = -1;
			if (animT <= 0) direction = 1;
		}
		lastTime = now;
		rafId = requestAnimationFrame(tick);
	}

	function togglePlay() {
		if (playing) {
			playing = false;
			if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
			lastTime = null;
		} else {
			playing = true;
			rafId = requestAnimationFrame(tick);
		}
	}

	onDestroy(() => { if (rafId !== null) cancelAnimationFrame(rafId); });

	// ── Interpolated projection ───────────────────────────────────────────────
	let projection = $derived.by(() => {
		if (animT <= 0.5) {
			// Phase 1: Equirectangular → Mollweide
			if (!fitEquirect || !fitMollweide) return null;
			const t = easeInOut(animT * 2);
			return buildProjection(rawEquirect, fitEquirect, rawMollweide, fitMollweide, t);
		} else {
			// Phase 2: Mollweide → Waterman Butterfly
			if (!fitMollweide || !fitWaterman || !rawWaterman) return null;
			const t = easeInOut((animT - 0.5) * 2);
			const rw = rawWaterman;
			return buildProjection(rawMollweide, fitMollweide, rw, fitWaterman, t);
		}
	});

	// ── SVG paths ─────────────────────────────────────────────────────────────
	let graticuleD = $derived.by(() => {
		if (!projection) return '';
		return d3.geoPath(projection)(graticuleData) ?? '';
	});

	let sphereD = $derived.by(() => {
		if (!projection) return '';
		return d3.geoPath(projection)(sphere) ?? '';
	});
</script>

<div class="page">
	<!-- ── SVG area ─────────────────────────────────────────────────────────── -->
	<div class="svg-area" bind:clientWidth={width} bind:clientHeight={height}>
		<svg {width} {height}>
			{#if showSphere}
				<path class="sphere" d={sphereD} />
			{/if}
			<path class="graticule" d={graticuleD} style:stroke-width={strokeWidth} />
		</svg>
	</div>

	<!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
	<aside class="sidebar">
		<div class="sidebar-inner">
			<h3>Logo</h3>

			<section>
				<h4>Animation</h4>

				<button class="play-btn" onclick={togglePlay}>
					{playing ? 'Pause' : 'Play'}
				</button>

				<div class="control-group">
					<span class="label">Duration</span>
					<div class="slider-row">
						<input type="range" min="0.5" max="5" step="0.5" bind:value={transitionDuration} />
						<span class="value">{transitionDuration}s</span>
					</div>
					<span class="hint">Per projection</span>
				</div>
			</section>

			<div class="divider"></div>

			<section>
				<h4>Graticule</h4>

				<div class="control-group">
					<span class="label">Step</span>
					<div class="segmented">
						{#each [10, 20, 30, 45] as step}
							<button
								class:active={graticuleStep === step}
								onclick={() => (graticuleStep = step)}
							>{step}°</button>
						{/each}
					</div>
				</div>

				<div class="control-group">
					<span class="label">Stroke weight</span>
					<div class="slider-row">
						<input type="range" min="0.25" max="3" step="0.25" bind:value={strokeWidth} />
						<span class="value">{strokeWidth}</span>
					</div>
				</div>
			</section>

			<div class="divider"></div>

			<section>
				<h4>Sphere</h4>
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showSphere} />
					Show outline
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

	/* ── SVG area ─────────────────────────────────────────────────────────── */
	.svg-area {
		flex: 1;
		height: 100%;
		overflow: hidden;
		background: var(--color-surface-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	svg {
		display: block;
	}

	.sphere {
		fill: var(--color-surface-primary);
		stroke: var(--color-text-primary);
		stroke-width: 1;
	}

	.graticule {
		fill: none;
		stroke: var(--color-text-primary);
	}

	/* ── Sidebar ──────────────────────────────────────────────────────────── */
	.sidebar {
		width: 240px;
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

	h3 { margin: 0; }
	h4 { margin: 0; }

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.divider {
		height: 1px;
		background: var(--color-border);
		margin: 0 calc(-1 * var(--space-l));
	}

	/* ── Play button ──────────────────────────────────────────────────────── */
	.play-btn {
		width: 100%;
		padding: var(--space-s) var(--space-m);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-size: 13px;
		cursor: pointer;
		transition: background 100ms ease;
	}

	.play-btn:hover {
		background: var(--color-surface-secondary);
	}

	/* ── Controls ─────────────────────────────────────────────────────────── */
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

	.segmented {
		display: flex;
		gap: 2px;
	}

	.segmented button {
		flex: 1;
		padding: var(--space-s) 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-size: 13px;
		text-align: center;
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

	.slider-row {
		display: flex;
		align-items: center;
		gap: var(--space-m);
	}

	.slider-row input[type='range'] {
		flex: 1;
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	.value {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
		min-width: 28px;
		text-align: right;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		font-size: 13px;
		color: var(--color-text-primary);
		cursor: pointer;
	}
</style>
