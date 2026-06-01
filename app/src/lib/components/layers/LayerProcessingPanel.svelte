<script lang="ts">
	import { updateLayerProcessing } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { tooltip } from '$lib/actions/tooltip';
	import type { Layer } from '$lib/types';

	let { layer }: { layer: Layer } = $props();

	// Local state initialised from the layer's current processing settings.
	let simpEnabled      = $state(layer.processing.simpEnabled);
	let simpAlgorithm    = $state(layer.processing.simpAlgorithm);
	let simpTolerance    = $state(layer.processing.simpTolerance);
	let simpWeight       = $state(layer.processing.simpWeight);
	let simpKeepShapes   = $state(layer.processing.simpKeepShapes);

	let chaikinEnabled    = $state(layer.processing.chaikinEnabled);
	let chaikinIterations = $state(layer.processing.chaikinIterations);

	let bezierEnabled     = $state(layer.processing.bezierEnabled);
	let bezierCurveType   = $state(layer.processing.bezierCurveType);
	let bezierTension     = $state(layer.processing.bezierTension);
	let bezierAlpha       = $state(layer.processing.bezierAlpha);
	let bezierContinuity  = $state(layer.processing.bezierContinuity);
	let bezierBias        = $state(layer.processing.bezierBias);

	const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

	// Non-linear tolerance slider: 0–950 → value 0–95 (coarse, 0.1 steps)
	//                             950–1450 → value 95–100 (fine, 0.01 steps)
	function posToValue(pos: number): number {
		if (pos <= 950) return parseFloat((pos * 0.1).toFixed(1));
		return parseFloat((95 + (pos - 950) * 0.01).toFixed(2));
	}
	function valueToPos(val: number): number {
		if (val <= 95) return Math.round(val / 0.1);
		return Math.round(950 + (val - 95) / 0.01);
	}

	const ALGORITHMS = [
		{ value: 'weighted',    label: 'Weighted' },
		{ value: 'visvalingam', label: 'Visvalingam' },
		{ value: 'dp',          label: 'Douglas-Peucker' },
	] as const;

	const CURVE_TYPES = [
		{ value: 'catmull-rom', label: 'Catmull-Rom' },
		{ value: 'bspline',     label: 'B-Spline' },
		{ value: 'kb',          label: 'Kochanek-Bartels' },
	] as const;
</script>

<div class="processing-panel">

	<!-- ── Simplification ─────────────────────────────── -->
	<div class="section">
		<div class="section-header">
			<span class="h4 section-title" use:tooltip={"Reduces the number of points in your geometry. Use this to improve rendering performance and reduce visual noise, especially at smaller map scales."}
			>Simplify</span>
			<button
				class="toggle-track"
				class:on={simpEnabled}
				role="switch"
				aria-checked={simpEnabled}
				onclick={() => {
					simpEnabled = !simpEnabled;
					updateLayerProcessing(layer.id, { simpEnabled }, pushSnapshot);
				}}
			>
				<span class="toggle-thumb"></span>
			</button>
		</div>

		{#if simpEnabled}
			<div class="style-row">
				<span class="label mono-small" use:tooltip={"The method used to choose which points to remove. Weighted preserves visually important features. Visvalingam prioritises visual significance by area. Douglas-Peucker is fast and classic, but tends to produce spikier shapes."}
				>Algorithm</span>
				<select
					class="select mono-small"
					bind:value={simpAlgorithm}
					onchange={() => { updateLayerProcessing(layer.id, { simpAlgorithm }, pushSnapshot); }}
				>
					{#each ALGORITHMS as algo}
						<option value={algo.value}>{algo.label}</option>
					{/each}
				</select>
			</div>

			<div class="style-row">
				<span class="label mono-small" use:tooltip={"How aggressively to simplify. Higher values remove more points, creating simpler and blockier shapes. Lower values preserve more detail. The slider gives finer control near 100%."}
				>Tolerance</span>
				<input
					class="slider"
					type="range"
					min="0" max="1450" step="1"
					value={valueToPos(simpTolerance)}
					oninput={(e) => { simpTolerance = posToValue(Number((e.currentTarget as HTMLInputElement).value)); }}
					onchange={() => { updateLayerProcessing(layer.id, { simpTolerance }, pushSnapshot); }}
				/>
				<input class="value-input mono-small" type="number" min="0" max="100" step="0.1"
					bind:value={simpTolerance}
					onchange={() => { simpTolerance = clamp(simpTolerance, 0, 100); updateLayerProcessing(layer.id, { simpTolerance }, pushSnapshot); }}
				/>
			</div>

			{#if simpAlgorithm === 'weighted'}
				<div class="style-row">
					<span class="label mono-small" use:tooltip={"Balances the two components of the Weighted algorithm. 0 uses triangle area only; 1 uses perimeter ratio only. Values in between blend both."}
				>Weight</span>
					<input
						class="slider"
						type="range"
						min="0" max="1" step="0.05"
						bind:value={simpWeight}
						onchange={() => { updateLayerProcessing(layer.id, { simpWeight }, pushSnapshot); }}
					/>
					<input class="value-input mono-small" type="number" min="0" max="1" step="0.01"
					bind:value={simpWeight}
					onchange={() => { simpWeight = clamp(simpWeight, 0, 1); updateLayerProcessing(layer.id, { simpWeight }, pushSnapshot); }}
				/>
				</div>
			{/if}

			<div class="style-row">
				<span class="label mono-small" use:tooltip={"Prevents small features from being simplified away entirely. Useful when your layer contains small islands or polygons that should remain visible even at high simplification."}
				>Keep shapes</span>
				<button
					class="toggle-track"
					class:on={simpKeepShapes}
					role="switch"
					aria-checked={simpKeepShapes}
					onclick={() => {
						simpKeepShapes = !simpKeepShapes;
						updateLayerProcessing(layer.id, { simpKeepShapes }, pushSnapshot);
					}}
				>
					<span class="toggle-thumb"></span>
				</button>
			</div>
		{/if}
	</div>

	<!-- ── Chaikin smoothing ───────────────────────────── -->
	<div class="section">
		<div class="section-header">
			<span class="h4 section-title" use:tooltip={"Iteratively cuts corners to create smooth, organic curves. This is a geo-space operation — the smoothed points are encoded into your data, which increases the size of your geometry."}
			>Chaikin Smoothing</span>
			<button
				class="toggle-track"
				class:on={chaikinEnabled}
				role="switch"
				aria-checked={chaikinEnabled}
				onclick={() => {
					chaikinEnabled = !chaikinEnabled;
					updateLayerProcessing(layer.id, { chaikinEnabled }, pushSnapshot);
				}}
			>
				<span class="toggle-thumb"></span>
			</button>
		</div>

		{#if chaikinEnabled}
			<div class="style-row">
				<span class="label mono-small" use:tooltip={"How many times to apply the smoothing pass. More iterations create smoother curves but also increase point count. 2–3 is usually enough; beyond 4 the gains are minimal."}
				>Iterations</span>
				<input
					class="width-input number-input"
					type="number"
					min="1" max="4" step="1"
					bind:value={chaikinIterations}
					onblur={() => { updateLayerProcessing(layer.id, { chaikinIterations }, pushSnapshot); }}
				/>
			</div>
		{/if}
	</div>

	<!-- ── Bezier fitting ─────────────────────────────── -->
	<div class="section">
		<div class="section-header">
			<span class="h4 section-title" use:tooltip={"Fits smooth spline curves through the geometry points using configurable interpolation algorithms. This is a screen-space transform — it does not alter your underlying geodata."}
			>Bezier Smoothing</span>
			<button
				class="toggle-track"
				class:on={bezierEnabled}
				role="switch"
				aria-checked={bezierEnabled}
				onclick={() => {
					bezierEnabled = !bezierEnabled;
					updateLayerProcessing(layer.id, { bezierEnabled }, pushSnapshot);
				}}
			>
				<span class="toggle-thumb"></span>
			</button>
		</div>

		{#if bezierEnabled}
			<div class="style-row">
				<span class="label mono-small" use:tooltip={"The spline algorithm used to fit curves. Catmull-Rom passes through original points. B-Spline is smoother but doesn't pass through points. Kochanek-Bartels allows asymmetric control over tension, continuity, and bias."}
				>Curve</span>
				<select
					class="select mono-small"
					bind:value={bezierCurveType}
					onchange={() => { updateLayerProcessing(layer.id, { bezierCurveType }, pushSnapshot); }}
				>
					{#each CURVE_TYPES as ct}
						<option value={ct.value}>{ct.label}</option>
					{/each}
				</select>
			</div>

			<div class="style-row">
				<span class="label mono-small" use:tooltip={"Controls how tightly the curve follows the original path. Lower values create loose, rounded curves. Higher values pull the curve closer to straight lines between points."}
				>Tension</span>
				<input
					class="slider"
					type="range"
					min="0" max="1" step="0.05"
					bind:value={bezierTension}
					onchange={() => { updateLayerProcessing(layer.id, { bezierTension }, pushSnapshot); }}
				/>
				<input class="value-input mono-small" type="number" min="0" max="1" step="0.01"
					bind:value={bezierTension}
					onchange={() => { bezierTension = clamp(bezierTension, 0, 1); updateLayerProcessing(layer.id, { bezierTension }, pushSnapshot); }}
				/>
			</div>

			{#if bezierCurveType === 'catmull-rom'}
				<div class="style-row">
					<span class="label mono-small" use:tooltip={"Catmull-Rom parameterisation. 0 = uniform (can produce loops), 0.5 = centripetal (smooth, avoids loops — recommended), 1 = chordal (follows chord lengths)."}
				>Alpha</span>
					<input
						class="slider"
						type="range"
						min="0" max="1" step="0.05"
						bind:value={bezierAlpha}
						onchange={() => { updateLayerProcessing(layer.id, { bezierAlpha }, pushSnapshot); }}
					/>
					<input class="value-input mono-small" type="number" min="0" max="1" step="0.01"
					bind:value={bezierAlpha}
					onchange={() => { bezierAlpha = clamp(bezierAlpha, 0, 1); updateLayerProcessing(layer.id, { bezierAlpha }, pushSnapshot); }}
				/>
				</div>
			{/if}

			{#if bezierCurveType === 'kb'}
				<div class="style-row">
					<span class="label mono-small" use:tooltip={"Kochanek-Bartels: controls corner sharpness. 0 is smooth. Negative values create sharper corners. Positive values create loop-like overshoots."}
				>Continuity</span>
					<input
						class="slider"
						type="range"
						min="-1" max="1" step="0.05"
						bind:value={bezierContinuity}
						onchange={() => { updateLayerProcessing(layer.id, { bezierContinuity }, pushSnapshot); }}
					/>
					<input class="value-input mono-small" type="number" min="-1" max="1" step="0.01"
					bind:value={bezierContinuity}
					onchange={() => { bezierContinuity = clamp(bezierContinuity, -1, 1); updateLayerProcessing(layer.id, { bezierContinuity }, pushSnapshot); }}
				/>
				</div>
				<div class="style-row">
					<span class="label mono-small" use:tooltip={"Kochanek-Bartels: shifts the curve's influence before or after each point. 0 is symmetric. Positive values pull toward the incoming direction; negative toward the outgoing."}
				>Bias</span>
					<input
						class="slider"
						type="range"
						min="-1" max="1" step="0.05"
						bind:value={bezierBias}
						onchange={() => { updateLayerProcessing(layer.id, { bezierBias }, pushSnapshot); }}
					/>
					<input class="value-input mono-small" type="number" min="-1" max="1" step="0.01"
					bind:value={bezierBias}
					onchange={() => { bezierBias = clamp(bezierBias, -1, 1); updateLayerProcessing(layer.id, { bezierBias }, pushSnapshot); }}
				/>
				</div>
			{/if}
		{/if}
	</div>

</div>

<style>
	.processing-panel {
		padding: var(--space-m);
		background: var(--color-surface-primary);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 28px;
	}

	.style-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 28px;
		padding-left: var(--space-m);
	}

	.label {
		width: 80px;
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	.section-title {
		color: var(--color-text-primary);
	}

	.slider {
		flex: 1;
		min-width: 0;
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	.slider::-webkit-slider-runnable-track {
		height: 3px;
		border-radius: 1.5px;
		background: var(--color-border);
	}

	.slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-accent);
		margin-top: calc((3px - 14px) / 2);
	}

	.slider::-moz-range-track {
		height: 3px;
		border-radius: 1.5px;
		background: var(--color-border);
	}

	.slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: none;
		background: var(--color-accent);
	}

	.value-input {
		width: 44px;
		text-align: right;
		color: var(--color-text-secondary);
		flex-shrink: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius);
		padding: 0 var(--space-xs);
	}

	.value-input:hover {
		border-color: var(--color-border);
	}

	.value-input::-webkit-outer-spin-button,
	.value-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.value-input[type=number] {
		-moz-appearance: textfield;
	}

	.select {
		flex: 1;
		height: 24px;
		padding: 0 var(--space-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
	}

	.width-input {
		width: 56px;
	}

	/* Toggle switch — matches LayerStylePanel */
	.toggle-track {
		position: relative;
		width: 28px;
		height: 16px;
		border-radius: 8px;
		border: none;
		background: var(--color-border);
		cursor: pointer;
		padding: 0;
		transition: background 150ms;
		flex-shrink: 0;
	}

	.toggle-track.on {
		background: var(--color-accent);
	}

	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--grey-0);
		transition: transform 150ms;
		pointer-events: none;
	}

	.toggle-track.on .toggle-thumb {
		transform: translateX(12px);
	}
</style>
