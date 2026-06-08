<script lang="ts">
	import * as d3 from 'd3-geo';
	// d3-geo-projection ships no TypeScript types
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	import * as d3proj from 'd3-geo-projection';

	// ── Controls ─────────────────────────────────────────────────────────────
	let logoWidth = $state(400);
	let graticuleStep = $state(30);
	let graticuleStroke = $state(1);
	let outlineStroke = $state(1);
	let showOutline = $state(true);

	// ── Geo data ──────────────────────────────────────────────────────────────
	const sphere = { type: 'Sphere' } as const;

	let graticuleData = $derived(d3.geoGraticule().step([graticuleStep, graticuleStep])());

	// ── Projection ────────────────────────────────────────────────────────────
	let projection = $derived(
		(d3proj.geoPolyhedralWaterman() as d3.GeoProjection)
			.fitSize([logoWidth, logoWidth], sphere)
	);

	// ── SVG paths ─────────────────────────────────────────────────────────────
	let pathGen = $derived(d3.geoPath(projection));
	let sphereD = $derived(pathGen(sphere) ?? '');
	let graticuleD = $derived(pathGen(graticuleData) ?? '');
</script>

<div class="page">
	<!-- ── Preview area ──────────────────────────────────────────────────────── -->
	<div class="preview-area">
		<div class="logo-frame" style:width="{logoWidth}px" style:height="{logoWidth}px">
			<svg width={logoWidth} height={logoWidth}>
				<defs>
					<!-- Clip graticule to the butterfly outline so lines don't
					     appear in the cuts between lobes -->
					<clipPath id="butterfly-clip">
						<path d={sphereD} />
					</clipPath>
				</defs>

				<!-- White fill -->
				<path class="sphere-fill" d={sphereD} />

				<!-- Graticule, clipped to butterfly boundary -->
				<path
					class="graticule"
					d={graticuleD}
					clip-path="url(#butterfly-clip)"
					style:stroke-width={graticuleStroke}
				/>

				<!-- Outline drawn last so it sits on top -->
				{#if showOutline}
					<path class="outline" d={sphereD} style:stroke-width={outlineStroke} />
				{/if}
			</svg>
		</div>
		<p class="size-label">{logoWidth}px</p>
	</div>

	<!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
	<aside class="sidebar">
		<div class="sidebar-inner">
			<h3>Waterman</h3>

			<section>
				<h4>Size</h4>
				<div class="control-group">
					<span class="label">Width (px)</span>
					<div class="slider-row">
						<input
							type="range"
							min="24"
							max="800"
							step="1"
							bind:value={logoWidth}
						/>
						<input
							class="number-input"
							type="number"
							min="24"
							max="800"
							step="1"
							bind:value={logoWidth}
						/>
					</div>
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
					<span class="label">Line weight</span>
					<div class="slider-row">
						<input type="range" min="0.25" max="3" step="0.25" bind:value={graticuleStroke} />
						<span class="value">{graticuleStroke}</span>
					</div>
				</div>
			</section>

			<div class="divider"></div>

			<section>
				<h4>Outline</h4>

				<label class="checkbox-label">
					<input type="checkbox" bind:checked={showOutline} />
					Show outline
				</label>

				{#if showOutline}
					<div class="control-group">
						<span class="label">Line weight</span>
						<div class="slider-row">
							<input type="range" min="0.25" max="3" step="0.25" bind:value={outlineStroke} />
							<span class="value">{outlineStroke}</span>
						</div>
					</div>
				{/if}
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

	/* ── Preview area ────────────────────────────────────────────────────────── */
	.preview-area {
		flex: 1;
		height: 100%;
		overflow: auto;
		background: var(--color-surface-secondary);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-m);
	}

	.logo-frame {
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06);
		flex-shrink: 0;
	}

	svg {
		display: block;
	}

	.sphere-fill {
		fill: white;
		stroke: none;
	}

	.graticule {
		fill: none;
		stroke: #161819;
	}

	.outline {
		fill: none;
		stroke: #161819;
	}

	.size-label {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-tertiary);
	}

	/* ── Sidebar ─────────────────────────────────────────────────────────────── */
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

	/* ── Controls ────────────────────────────────────────────────────────────── */
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

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		font-size: 13px;
		color: var(--color-text-primary);
		cursor: pointer;
	}
</style>
