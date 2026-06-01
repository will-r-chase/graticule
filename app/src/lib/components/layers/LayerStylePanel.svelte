<script lang="ts">
	import { getContext } from 'svelte';
	import { X } from 'phosphor-svelte';
	import ColorPicker from '$lib/components/ui/ColorPicker.svelte';
	import ShapeSelect from '$lib/components/ui/ShapeSelect.svelte';
	import { updateLayerStyle } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import type { Layer } from '$lib/types';

	let { layer, onclose }: { layer: Layer; onclose: () => void } = $props();

	const styleCtx = getContext<{ setPickerOpen(open: boolean): void }>('stylePanel');

	// Local state initialised from the layer's current style.
	// Plain $state — not derived from layer.style — so there's no reactive loop.
	let fillEnabled = $state(layer.style.fill !== 'none');
	let fillHex    = $state(layer.style.fill === 'none' ? '#ffffff' : layer.style.fill);
	let fillAlpha  = $state(layer.style.fillOpacity);

	let strokeEnabled = $state(layer.style.stroke !== 'none');
	let strokeHex   = $state(layer.style.stroke === 'none' ? '#161819' : layer.style.stroke);
	let strokeAlpha = $state(layer.style.strokeOpacity);

	let strokeWidth  = $state(layer.style.strokeWidth);
	let strokeDashed = $state(layer.style.strokeDashed);
	let strokeDash   = $state(layer.style.strokeDash);
	let strokeGap    = $state(layer.style.strokeGap);
	let pointRadius  = $state(layer.style.pointRadius);
	let pointShape   = $state(layer.style.pointShape);

	const hasPoints   = $derived(layer.geometryTypes.some(t => t === 'Point' || t === 'MultiPoint'));
	const hasNonPoint = $derived(layer.geometryTypes.some(t => t !== 'Point' && t !== 'MultiPoint'));

	// Which picker is expanded inline (only one at a time).
	let activePicker = $state<'fill' | 'stroke' | null>(null);

	// When this component is destroyed (e.g. undo/redo causes a remount via {#key}),
	// ensure the picker-open flag is reset so drag-and-drop isn't left disabled.
	$effect(() => () => styleCtx.setPickerOpen(false));

	// Push local state → store whenever it changes.
	$effect(() => {
		updateLayerStyle(layer.id, {
			fill: fillEnabled ? fillHex : 'none',
			fillOpacity: fillAlpha,
		});
	});

	$effect(() => {
		updateLayerStyle(layer.id, {
			stroke: strokeEnabled ? strokeHex : 'none',
			strokeOpacity: strokeAlpha,
		});
	});

	$effect(() => {
		updateLayerStyle(layer.id, { strokeWidth });
	});

	$effect(() => {
		updateLayerStyle(layer.id, { strokeDashed, strokeDash, strokeGap });
	});

	$effect(() => {
		updateLayerStyle(layer.id, { pointRadius, pointShape });
	});

	function toRgba(hex: string, alpha: number): string {
		const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
		if (!m) return 'transparent';
		return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
	}

	function togglePicker(which: 'fill' | 'stroke') {
		const wasOpen = activePicker === which;
		activePicker = activePicker === which ? null : which;
		styleCtx.setPickerOpen(activePicker !== null);
		if (wasOpen) pushSnapshot(); // push when picker closes via swatch click
	}
</script>

<div class="style-panel">
	<!-- Fill row -->
	<div class="style-row">
		<span class="label mono-small">Fill</span>
		<div class="controls">
			<button
				class="toggle-track"
				class:on={fillEnabled}
				role="switch"
				aria-checked={fillEnabled}
				onclick={() => {
					fillEnabled = !fillEnabled;
					if (!fillEnabled) { activePicker = null; styleCtx.setPickerOpen(false); }
					updateLayerStyle(layer.id, { fill: fillEnabled ? fillHex : 'none', fillOpacity: fillAlpha });
					pushSnapshot();
				}}
			>
				<span class="toggle-thumb"></span>
			</button>

			<button
				class="swatch"
				class:ring={activePicker === 'fill'}
				style="--c: {toRgba(fillHex, fillAlpha)}; visibility: {fillEnabled ? 'visible' : 'hidden'}"
				onclick={() => togglePicker('fill')}
				aria-label="Edit fill colour"
				tabindex={fillEnabled ? 0 : -1}
			></button>
		</div>
		<button class="icon-btn" onclick={onclose} aria-label="Close style panel">
			<X size={12} />
		</button>
	</div>

	<!-- Stroke row -->
	<div class="style-row">
		<span class="label mono-small">Stroke</span>
		<div class="controls">
			{#if hasPoints}
				<button
					class="toggle-track"
					class:on={strokeEnabled}
					role="switch"
					aria-checked={strokeEnabled}
					onclick={() => {
						strokeEnabled = !strokeEnabled;
						if (!strokeEnabled && activePicker === 'stroke') {
							activePicker = null;
							styleCtx.setPickerOpen(false);
						}
						updateLayerStyle(layer.id, { stroke: strokeEnabled ? strokeHex : 'none', strokeOpacity: strokeAlpha });
						pushSnapshot();
					}}
				>
					<span class="toggle-thumb"></span>
				</button>
			{/if}
			<button
				class="swatch"
				class:ring={activePicker === 'stroke'}
				style="--c: {toRgba(strokeHex, strokeAlpha)}; visibility: {strokeEnabled ? 'visible' : 'hidden'}"
				onclick={() => togglePicker('stroke')}
				aria-label="Edit stroke colour"
				tabindex={strokeEnabled ? 0 : -1}
			></button>
			<input
				class="width-input number-input"
				type="number"
				min="0"
				step="0.1"
				bind:value={strokeWidth}
				onblur={() => { updateLayerStyle(layer.id, { strokeWidth }); pushSnapshot(); }}
				style="visibility: {strokeEnabled ? 'visible' : 'hidden'}"
				tabindex={strokeEnabled ? 0 : -1}
			/>
		</div>
	</div>

	<!-- Dash row — not applicable for point symbols -->
	{#if hasNonPoint}
		<div class="style-row">
			<span class="label mono-small">Dash</span>
			<div class="controls">
				<button
					class="toggle-track"
					class:on={strokeDashed}
					role="switch"
					aria-checked={strokeDashed}
					onclick={() => { strokeDashed = !strokeDashed; updateLayerStyle(layer.id, { strokeDashed }); pushSnapshot(); }}
				>
					<span class="toggle-thumb"></span>
				</button>
				<input
					class="width-input number-input"
					type="number" min="1" step="1"
					bind:value={strokeDash}
					onblur={() => { updateLayerStyle(layer.id, { strokeDash }); pushSnapshot(); }}
					style="visibility: {strokeDashed ? 'visible' : 'hidden'}"
					tabindex={strokeDashed ? 0 : -1}
				/>
				<span class="dash-sep mono-small" style="visibility: {strokeDashed ? 'visible' : 'hidden'}">gap</span>
				<input
					class="width-input number-input"
					type="number" min="1" step="1"
					bind:value={strokeGap}
					onblur={() => { updateLayerStyle(layer.id, { strokeGap }); pushSnapshot(); }}
					style="visibility: {strokeDashed ? 'visible' : 'hidden'}"
					tabindex={strokeDashed ? 0 : -1}
				/>
			</div>
		</div>
	{/if}

	<!-- Point controls -->
	{#if hasPoints}
		{#if hasNonPoint}
			<div class="divider"></div>
		{/if}

		<!-- Size row -->
		<div class="style-row">
			<span class="label mono-small">Size</span>
			<div class="controls">
				<input
					class="width-input number-input"
					type="number"
					min="1"
					step="1"
					bind:value={pointRadius}
					onblur={() => { updateLayerStyle(layer.id, { pointRadius, pointShape }); pushSnapshot(); }}
				/>
			</div>
		</div>

		<!-- Shape row -->
		<div class="style-row">
			<span class="label mono-small">Shape</span>
			<div class="controls">
				<ShapeSelect bind:value={pointShape} onchange={(id) => { updateLayerStyle(layer.id, { pointRadius, pointShape: id }); pushSnapshot(); }} />
			</div>
		</div>
	{/if}

	<!-- Inline colour picker — only one open at a time -->
	{#if activePicker !== null}
		<div class="picker-area">
			<div class="picker-header">
				<button class="icon-btn" onclick={() => { activePicker = null; styleCtx.setPickerOpen(false); pushSnapshot(); }} aria-label="Close colour picker">
					<X size={12} />
				</button>
			</div>
			{#if activePicker === 'fill'}
				<ColorPicker bind:hex={fillHex} bind:alpha={fillAlpha} />
			{:else}
				<ColorPicker bind:hex={strokeHex} bind:alpha={strokeAlpha} />
			{/if}
		</div>
	{/if}
</div>

<style>
	.style-panel {
		padding: var(--space-m) var(--space-m) var(--space-m);
		background: var(--color-surface-primary);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.style-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 28px;
	}

	.label {
		width: 44px;
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: var(--space-m);
		flex: 1;
	}

	/* Toggle switch */
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

	/* Checkerboard background shows through when alpha < 1 */
	.swatch {
		position: relative;
		width: 24px;
		height: 24px;
		border-radius: 3px;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		background-color: white;
		background-image:
			linear-gradient(45deg, #ccc 25%, transparent 25%),
			linear-gradient(-45deg, #ccc 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #ccc 75%),
			linear-gradient(-45deg, transparent 75%, #ccc 75%);
		background-size: 6px 6px;
		background-position: 0 0, 0 3px, 3px -3px, -3px 0px;
	}

	.swatch::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 3px;
		background: var(--c, transparent);
		outline: 1.5px solid rgba(0, 0, 0, 0.2);
		outline-offset: -1.5px;
	}

	.swatch.ring {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}

	.divider {
		height: 1px;
		background: var(--color-border);
		margin: var(--space-xs) 0;
	}

	.dash-sep {
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}

	.width-input {
		width: 56px;
	}

	.picker-area {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-s);
		margin-top: var(--space-xs);
	}

	.picker-header {
		display: flex;
		justify-content: flex-end;
		margin-bottom: var(--space-xs);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		color: var(--color-icon-secondary);
	}

	.icon-btn:hover {
		background: var(--color-surface-secondary);
		color: var(--color-icon-primary);
	}
</style>
