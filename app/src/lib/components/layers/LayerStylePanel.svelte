<script lang="ts">
	import { getContext } from 'svelte';
	import { X } from 'phosphor-svelte';
	import ColorPickerPopup from '$lib/components/ui/ColorPickerPopup.svelte';
	import ShapeSelect from '$lib/components/ui/ShapeSelect.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import { blendModeOptions, type BlendMode } from '$lib/utils/blendModes';
	import { defaultGlow, type Glow } from '$lib/utils/glow';
	import { patternOptions, patternId, specFromPatternId, type FillPattern } from '$lib/utils/patterns';
	import { updateLayerStyle } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import type { Layer } from '$lib/types';

	let { layer, onclose }: { layer: Layer; onclose: () => void } = $props();

	const styleCtx = getContext<{ setPickerOpen(open: boolean): void }>('stylePanel');

	let blendMode = $state<BlendMode>(layer.style.blendMode);

	// Local state initialised from the layer's current style.
	// Plain $state — not derived from layer.style — so there's no reactive loop.
	let fillEnabled = $state(layer.style.fill !== 'none');
	let fillHex    = $state(layer.style.fill === 'none' ? '#ffffff' : layer.style.fill);
	let fillAlpha  = $state(layer.style.fillOpacity);

	// Pattern fill (polygons). The dropdown id encodes type + variant; size/weight are the tile
	// size and the line thickness (dot radius for dots).
	// patternSel keeps the last pick while the toggle is off, so re-enabling restores it.
	let patternEnabled = $state(layer.style.fillPattern !== null);
	let patternSel    = $state(layer.style.fillPattern ? patternId(layer.style.fillPattern) : 'lines:diagonal');
	const pickableOptions = patternOptions.filter((o) => o.id !== 'none');
	let patternSize   = $state(layer.style.fillPattern?.size ?? 8);
	let patternWeight = $state(layer.style.fillPattern?.weight ?? 1);

	// Glows (polygons). The color picker takes hex and alpha separately, so each glow's color
	// and opacity live as two fields here and are recombined into a Glow (or null) on push.
	type GlowKey = 'outerGlow' | 'innerGlow';
	const glowLocal = (g: Glow | null) => {
		const v = g ?? defaultGlow;
		return { on: g !== null, hex: v.color, alpha: v.opacity, blur: v.blur, spread: v.spread };
	};
	const glowState = $state({
		outerGlow: glowLocal(layer.style.outerGlow),
		innerGlow: glowLocal(layer.style.innerGlow),
	});

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
	const hasPolygon  = $derived(layer.geometryTypes.some(t => t === 'Polygon' || t === 'MultiPolygon'));
	const hasNonPoint = $derived(layer.geometryTypes.some(t => t !== 'Point' && t !== 'MultiPoint'));

	// Outer glow applies to every geometry type (a "Halo" when there are no polygons); inner
	// glow only makes sense inside polygons.
	const glowRows = $derived<{ key: GlowKey; label: string; name: string }[]>([
		hasPolygon
			? { key: 'outerGlow', label: 'Outer glow', name: 'Outer glow' }
			: { key: 'outerGlow', label: 'Halo', name: 'Halo' },
		...(hasPolygon ? [{ key: 'innerGlow' as const, label: 'Inner glow', name: 'Inner glow' }] : []),
	]);

	// Which picker is open (only one at a time).
	let activePicker = $state<'fill' | 'stroke' | GlowKey | null>(null);

	// DOM refs for positioning and click-outside detection.
	let panelEl          = $state<HTMLDivElement | null>(null);
	let floatingPickerEl = $state<HTMLDivElement | null>(null);
	let pickerPos        = $state({ left: 0, top: 0 });

	// When this component is destroyed (e.g. undo/redo causes a remount via {#key}),
	// ensure the picker-open flag is reset so drag-and-drop isn't left disabled.
	$effect(() => () => styleCtx.setPickerOpen(false));

	// Calculate floating picker position whenever it opens.
	$effect(() => {
		if (activePicker !== null && panelEl) {
			const rect = panelEl.getBoundingClientRect();
			const pickerWidth = 236; // 220px content + 16px padding
			const gap = 8;
			pickerPos = {
				left: Math.max(8, rect.left - pickerWidth - gap),
				top:  Math.max(8, rect.top),
			};
		}
	});

	// Close picker on click outside.
	$effect(() => {
		if (activePicker === null) return;

		function onPointerDown(e: PointerEvent) {
			if (!floatingPickerEl) return;
			if (floatingPickerEl.contains(e.target as Node)) return;
			closePicker();
		}

		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	// Push local state → store whenever it changes.
	$effect(() => {
		updateLayerStyle(layer.id, {
			fill: fillEnabled ? fillHex : 'none',
			fillOpacity: fillAlpha,
		});
	});

	// A new object each time — style snapshots copy shallowly, so never mutate in place.
	$effect(() => {
		let fillPattern: FillPattern | null = patternEnabled ? specFromPatternId(patternSel, null) : null;
		if (fillPattern) {
			fillPattern = {
				...fillPattern,
				size: Math.max(2, patternSize || 2),
				weight: Math.max(0.1, patternWeight || 0.1),
			};
		}
		updateLayerStyle(layer.id, { fillPattern });
	});

	$effect(() => {
		updateLayerStyle(layer.id, {
			stroke: strokeEnabled ? strokeHex : 'none',
			strokeOpacity: strokeAlpha,
		});
	});

	// New objects each time — style snapshots copy shallowly, so never mutate in place.
	$effect(() => {
		const toGlow = (g: (typeof glowState)[GlowKey]): Glow | null =>
			g.on ? { color: g.hex, opacity: g.alpha, blur: Math.max(0, g.blur || 0), spread: Math.max(0, g.spread || 0) } : null;
		updateLayerStyle(layer.id, {
			outerGlow: toGlow(glowState.outerGlow),
			innerGlow: toGlow(glowState.innerGlow),
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

	function closePicker() {
		activePicker = null;
		styleCtx.setPickerOpen(false);
		pushSnapshot();
	}

	function togglePicker(which: 'fill' | 'stroke' | GlowKey) {
		const wasOpen = activePicker === which;
		activePicker = activePicker === which ? null : which;
		styleCtx.setPickerOpen(activePicker !== null);
		if (wasOpen) pushSnapshot(); // push when picker closes via swatch click
	}
</script>

<div class="style-panel" bind:this={panelEl}>
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
				onpointerdown={(e) => { e.stopPropagation(); togglePicker('fill'); }}
				aria-label="Edit fill color"
				tabindex={fillEnabled ? 0 : -1}
			></button>
		</div>
		<button class="icon-btn" onclick={onclose} aria-label="Close style panel">
			<X size={12} />
		</button>
	</div>

	<!-- Pattern rows — polygons only, and only while the fill is on -->
	{#if hasPolygon && fillEnabled}
		<div class="style-row">
			<span class="label mono-small">Pattern</span>
			<div class="controls">
				<button
					class="toggle-track"
					class:on={patternEnabled}
					role="switch"
					aria-checked={patternEnabled}
					onclick={() => { patternEnabled = !patternEnabled; pushSnapshot(); }}
				>
					<span class="toggle-thumb"></span>
				</button>
				{#if patternEnabled}
					<Combobox
						small
						options={pickableOptions}
						value={patternSel}
						onchange={(id) => {
							// Same type keeps size/weight; a new type takes that type's defaults.
							if (id.split(':')[0] !== patternSel.split(':')[0]) {
								const fresh = specFromPatternId(id, null)!;
								patternSize = fresh.size;
								patternWeight = fresh.weight;
							}
							patternSel = id;
							pushSnapshot();
						}}
					/>
				{/if}
			</div>
		</div>
		{#if patternEnabled}
			<div class="style-row">
				<span class="label mono-small"></span>
				<div class="controls">
					<div class="notched-field">
						<span class="notch-label">Size</span>
						<input
							class="width-input number-input"
							type="number" min="2" step="1"
							bind:value={patternSize}
							onblur={() => pushSnapshot()}
						/>
					</div>
					<div class="notched-field">
						<span class="notch-label">{patternSel.startsWith('circles') ? 'Radius' : 'Weight'}</span>
						<input
							class="width-input number-input"
							type="number" min="0.1" step="0.5"
							bind:value={patternWeight}
							onblur={() => pushSnapshot()}
						/>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Stroke row -->
	<div class="style-row">
		<span class="label mono-small">Stroke</span>
		<div class="controls">
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
			<button
				class="swatch"
				class:ring={activePicker === 'stroke'}
				style="--c: {toRgba(strokeHex, strokeAlpha)}; visibility: {strokeEnabled ? 'visible' : 'hidden'}"
				onpointerdown={(e) => { e.stopPropagation(); togglePicker('stroke'); }}
				aria-label="Edit stroke color"
				tabindex={strokeEnabled ? 0 : -1}
			></button>
			<div class="notched-field" style="visibility: {strokeEnabled ? 'visible' : 'hidden'}">
				<span class="notch-label">Width</span>
				<input
					class="width-input number-input"
					type="number"
					min="0"
					step="0.1"
					bind:value={strokeWidth}
					onblur={() => { updateLayerStyle(layer.id, { strokeWidth }); pushSnapshot(); }}
					tabindex={strokeEnabled ? 0 : -1}
				/>
			</div>
		</div>
	</div>

	<!-- Dash row — not applicable for point symbols -->
	{#if hasNonPoint}
		<div class="style-row">
			<span class="label mono-small">Dashed</span>
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
				<div class="notched-field" style="visibility: {strokeDashed ? 'visible' : 'hidden'}">
					<span class="notch-label">Dash</span>
					<input
						class="width-input number-input"
						type="number" min="1" step="1"
						bind:value={strokeDash}
						onblur={() => { updateLayerStyle(layer.id, { strokeDash }); pushSnapshot(); }}
						tabindex={strokeDashed ? 0 : -1}
					/>
				</div>
				<div class="notched-field" style="visibility: {strokeDashed ? 'visible' : 'hidden'}">
					<span class="notch-label">Gap</span>
					<input
						class="width-input number-input"
						type="number" min="1" step="1"
						bind:value={strokeGap}
						onblur={() => { updateLayerStyle(layer.id, { strokeGap }); pushSnapshot(); }}
						tabindex={strokeDashed ? 0 : -1}
					/>
				</div>
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

	<!-- Glow rows. Outer glow applies to every layer (a 'Halo' on lines/points); inner glow is polygon-only. -->
	{#each glowRows as { key, label, name } (key)}
		{@const g = glowState[key]}
		<div class="style-row">
			<span class="label two-line mono-small" title={name}>{label}</span>
			<div class="controls">
				<button
					class="toggle-track"
					class:on={g.on}
					role="switch"
					aria-checked={g.on}
					aria-label={name}
					onclick={() => {
						g.on = !g.on;
						if (!g.on && activePicker === key) { activePicker = null; styleCtx.setPickerOpen(false); }
						pushSnapshot();
					}}
				>
					<span class="toggle-thumb"></span>
				</button>
				{#if g.on}
					<button
						class="swatch"
						class:ring={activePicker === key}
						style="--c: {toRgba(g.hex, g.alpha)}"
						onpointerdown={(e) => { e.stopPropagation(); togglePicker(key); }}
						aria-label="Edit {name.toLowerCase()} color"
					></button>
				{/if}
			</div>
		</div>
		{#if g.on}
			<div class="style-row">
				<span class="label mono-small"></span>
				<div class="controls">
					<div class="notched-field">
						<span class="notch-label">Size</span>
						<input class="width-input number-input" type="number" min="0" step="1" bind:value={g.blur} onblur={() => pushSnapshot()} />
					</div>
					<div class="notched-field">
						<span class="notch-label">Spread</span>
						<input class="width-input number-input" type="number" min="0" step="1" bind:value={g.spread} onblur={() => pushSnapshot()} />
					</div>
				</div>
			</div>
		{/if}
	{/each}

	<!-- Blend mode — how the whole layer composites onto the layers beneath -->
	<div class="style-row">
		<span class="label mono-small">Blend</span>
		<div class="controls">
			<Combobox
				small
				options={blendModeOptions}
				value={blendMode}
				onchange={(id) => { blendMode = id as BlendMode; updateLayerStyle(layer.id, { blendMode }); pushSnapshot(); }}
			/>
		</div>
	</div>
</div>

<!-- Floating color picker — rendered outside the panel div so position: fixed escapes cleanly -->
{#if activePicker !== null}
	<div
		class="floating-picker"
		bind:this={floatingPickerEl}
		style="left: {pickerPos.left}px; top: {pickerPos.top}px"
	>
		{#if activePicker === 'fill'}
			<ColorPickerPopup bind:hex={fillHex} bind:alpha={fillAlpha} title="Fill color" onclose={closePicker} />
		{:else if activePicker === 'stroke'}
			<ColorPickerPopup bind:hex={strokeHex} bind:alpha={strokeAlpha} title="Stroke color" onclose={closePicker} />
		{:else}
			<ColorPickerPopup bind:hex={glowState[activePicker].hex} bind:alpha={glowState[activePicker].alpha} title={activePicker === 'outerGlow' ? (hasPolygon ? 'Outer glow color' : 'Halo color') : 'Inner glow color'} onclose={closePicker} />
		{/if}
	</div>
{/if}

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
		width: 52px;
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	/* Labels that wrap onto two lines ("Outer glow") within the fixed row height. */
	.label.two-line {
		line-height: 1.1;
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
		outline: 1px solid var(--color-accent);
		outline-offset: 1px;
	}

	.divider {
		height: 1px;
		background: var(--color-border);
		margin: var(--space-xs) 0;
	}

	.width-input {
		width: 56px;
	}

	/* Notched field label — sits on the input's top border, like an outlined
	   Material text field. The background masks the border segment behind it. */
	.notched-field {
		position: relative;
	}

	.notch-label {
		position: absolute;
		top: 0;
		left: 6px;
		transform: translateY(-50%);
		padding: 0 3px;
		background: var(--color-surface-primary);
		color: var(--color-text-tertiary);
		font-family: var(--font-sans);
		font-size: 10px;
		font-weight: 400;
		line-height: 1;
		white-space: nowrap;
		pointer-events: none;
	}

	/* Floating color picker — just a positioned wrapper; card styling is in ColorPickerPopup */
	.floating-picker {
		position: fixed;
		z-index: 50;
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
