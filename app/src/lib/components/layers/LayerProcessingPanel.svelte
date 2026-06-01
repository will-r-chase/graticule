<script lang="ts">
	import { updateLayerProcessing } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
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
			<span class="h4 section-title">Simplify</span>
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
				<span class="label mono-small">Algorithm</span>
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
				<span class="label mono-small">Tolerance</span>
				<input
					class="slider"
					type="range"
					min="0" max="100" step="1"
					bind:value={simpTolerance}
					onchange={() => { updateLayerProcessing(layer.id, { simpTolerance }, pushSnapshot); }}
				/>
				<span class="value-label mono-small">{simpTolerance}%</span>
			</div>

			{#if simpAlgorithm === 'weighted'}
				<div class="style-row">
					<span class="label mono-small">Weight</span>
					<input
						class="slider"
						type="range"
						min="0" max="1" step="0.05"
						bind:value={simpWeight}
						onchange={() => { updateLayerProcessing(layer.id, { simpWeight }, pushSnapshot); }}
					/>
					<span class="value-label mono-small">{simpWeight.toFixed(2)}</span>
				</div>
			{/if}

			<div class="style-row">
				<span class="label mono-small">Keep shapes</span>
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
			<span class="h4 section-title">Smooth</span>
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
				<span class="label mono-small">Iterations</span>
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
			<span class="h4 section-title">Bezier</span>
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
				<span class="label mono-small">Curve</span>
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
				<span class="label mono-small">Tension</span>
				<input
					class="slider"
					type="range"
					min="0" max="1" step="0.05"
					bind:value={bezierTension}
					onchange={() => { updateLayerProcessing(layer.id, { bezierTension }, pushSnapshot); }}
				/>
				<span class="value-label mono-small">{bezierTension.toFixed(2)}</span>
			</div>

			{#if bezierCurveType === 'catmull-rom'}
				<div class="style-row">
					<span class="label mono-small">Alpha</span>
					<input
						class="slider"
						type="range"
						min="0" max="1" step="0.05"
						bind:value={bezierAlpha}
						onchange={() => { updateLayerProcessing(layer.id, { bezierAlpha }, pushSnapshot); }}
					/>
					<span class="value-label mono-small">{bezierAlpha.toFixed(2)}</span>
				</div>
			{/if}

			{#if bezierCurveType === 'kb'}
				<div class="style-row">
					<span class="label mono-small">Continuity</span>
					<input
						class="slider"
						type="range"
						min="-1" max="1" step="0.05"
						bind:value={bezierContinuity}
						onchange={() => { updateLayerProcessing(layer.id, { bezierContinuity }, pushSnapshot); }}
					/>
					<span class="value-label mono-small">{bezierContinuity.toFixed(2)}</span>
				</div>
				<div class="style-row">
					<span class="label mono-small">Bias</span>
					<input
						class="slider"
						type="range"
						min="-1" max="1" step="0.05"
						bind:value={bezierBias}
						onchange={() => { updateLayerProcessing(layer.id, { bezierBias }, pushSnapshot); }}
					/>
					<span class="value-label mono-small">{bezierBias.toFixed(2)}</span>
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

	.value-label {
		width: 36px;
		text-align: right;
		color: var(--color-text-secondary);
		flex-shrink: 0;
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
