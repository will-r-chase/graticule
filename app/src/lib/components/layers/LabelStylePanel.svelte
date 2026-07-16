<script lang="ts">
	import { getContext } from 'svelte';
	import { X, TextAlignLeft, TextAlignCenter, TextAlignRight } from 'phosphor-svelte';
	import ColorPickerPopup from '$lib/components/ui/ColorPickerPopup.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import { updateLayerLabelStyle } from '$lib/stores/layers.svelte';
	import { fonts, ensureFontLoaded, loadGoogleFontList, requestLocalFonts, variantsForFamily, CURATED_SYSTEM_FONTS } from '$lib/stores/fonts.svelte';
	import type { FontVariant } from '$lib/stores/fonts.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import type { Layer, LabelAnchor, LabelTextTransform } from '$lib/types';

	let { layer, onclose }: { layer: Layer; onclose: () => void } = $props();

	const styleCtx = getContext<{ setPickerOpen(open: boolean): void }>('stylePanel');

	// Fetch the Google catalog when the panel first opens (memoized in the store).
	loadGoogleFontList();

	const fontOptions = $derived.by(() => {
		const system = (fonts.localLoaded ? fonts.localFamilies : CURATED_SYSTEM_FONTS)
			.map((f) => ({ id: f, label: f, group: 'System' }));
		const google = fonts.googleFamilies.map((f) => ({ id: f, label: f, group: 'Google Fonts' }));
		// The current family may come from neither list (typed before the picker existed,
		// missing API key, …) — prepend it so the closed box still shows it.
		const known = new Set([...system, ...google].map((o) => o.id));
		const current = fontFamily && !known.has(fontFamily)
			? [{ id: fontFamily, label: fontFamily, group: 'Current' }]
			: [];
		return [...current, ...system, ...google];
	});

	const transformOptions: { id: LabelTextTransform; label: string }[] = [
		{ id: 'none', label: 'As written' },
		{ id: 'uppercase', label: 'UPPERCASE' },
		{ id: 'lowercase', label: 'lowercase' },
		{ id: 'sentence', label: 'Sentence case' },
		{ id: 'capitalize', label: 'Capitalize Each Word' },
	];

	// Row-major 3×3 anchor grid.
	const anchorGrid: LabelAnchor[] = [
		'top-left', 'top', 'top-right',
		'left', 'center', 'right',
		'bottom-left', 'bottom', 'bottom-right',
	];

	// Local state seeded from the layer (same pattern as LayerStylePanel — plain
	// $state, not derived, so there's no reactive loop).
	let fontFamily = $state(layer.labelStyle.fontFamily);
	let fontSize = $state(layer.labelStyle.fontSize);
	let fontWeight = $state(layer.labelStyle.fontWeight);
	let italic = $state(layer.labelStyle.italic);
	let letterSpacing = $state(layer.labelStyle.letterSpacing);
	let textTransform = $state(layer.labelStyle.textTransform);
	let colorHex = $state(layer.labelStyle.color);
	let colorAlpha = $state(layer.labelStyle.colorOpacity);
	let haloEnabled = $state(layer.labelStyle.haloWidth > 0);
	let haloHex = $state(layer.labelStyle.haloColor);
	// Remembered while the halo is toggled off so re-enabling restores it.
	let haloWidth = $state(layer.labelStyle.haloWidth > 0 ? layer.labelStyle.haloWidth : 2);
	let anchor = $state(layer.labelStyle.anchor);
	let lineHeight = $state(layer.labelStyle.lineHeight);
	let textAlign = $state(layer.labelStyle.textAlign);

	// Weight/style options for the current family, encoded as "weight|italic" ids
	// so the Combobox (string-only value/id) can round-trip both fields at once.
	const styleOptions = $derived(
		variantsForFamily(fontFamily).map((v) => ({
			id: `${v.weight}|${v.italic}`,
			label: v.label,
			italic: v.italic,
		}))
	);
	const styleValue = $derived(`${fontWeight}|${italic}`);

	// Picks the closest available variant when the current weight/italic combo
	// doesn't exist in a newly-selected family (prefers matching italic, then
	// closest weight).
	function nearestVariant(variants: FontVariant[], weight: number, italic: boolean): FontVariant {
		const pool = variants.filter((v) => v.italic === italic);
		const candidates = pool.length > 0 ? pool : variants;
		return candidates.reduce((best, v) =>
			Math.abs(v.weight - weight) < Math.abs(best.weight - weight) ? v : best
		);
	}

	function selectStyle(id: string) {
		const [weightStr, italicStr] = id.split('|');
		const weight = Number(weightStr);
		const isItalic = italicStr === 'true';
		// Same pattern as the family picker: wait for the face to be usable before
		// applying, so the label never repaints in a fallback weight mid-load.
		ensureFontLoaded(fontFamily, weight, isItalic).then(() => {
			fontWeight = weight;
			italic = isItalic;
			updateLayerLabelStyle(layer.id, { fontWeight, italic });
			pushSnapshot();
		});
	}

	let activePicker = $state<'color' | 'halo' | null>(null);
	let panelEl = $state<HTMLDivElement | null>(null);
	let floatingPickerEl = $state<HTMLDivElement | null>(null);
	let pickerPos = $state({ left: 0, top: 0 });

	$effect(() => () => styleCtx.setPickerOpen(false));

	$effect(() => {
		if (activePicker !== null && panelEl) {
			const rect = panelEl.getBoundingClientRect();
			const pickerWidth = 236;
			const gap = 8;
			pickerPos = {
				left: Math.max(8, rect.left - pickerWidth - gap),
				top: Math.max(8, rect.top),
			};
		}
	});

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

	// Push local state → store live (spinner clicks and picker drags update the map
	// immediately); blur/close handlers push the history snapshot. Number inputs are
	// guarded so an empty field mid-typing doesn't push NaN into the renderer.
	$effect(() => {
		updateLayerLabelStyle(layer.id, { color: colorHex, colorOpacity: colorAlpha });
	});

	$effect(() => {
		if (!Number.isFinite(haloWidth)) return;
		updateLayerLabelStyle(layer.id, {
			haloColor: haloHex,
			haloWidth: haloEnabled ? haloWidth : 0,
		});
	});

	$effect(() => {
		if (!Number.isFinite(fontSize) || fontSize <= 0) return;
		updateLayerLabelStyle(layer.id, { fontSize });
	});

	$effect(() => {
		if (!Number.isFinite(letterSpacing)) return;
		updateLayerLabelStyle(layer.id, { letterSpacing });
	});

	$effect(() => {
		if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
		updateLayerLabelStyle(layer.id, { lineHeight });
	});

	$effect(() => {
		if (fontFamily.trim() === '') return;
		updateLayerLabelStyle(layer.id, { fontFamily });
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

	function togglePicker(which: 'color' | 'halo') {
		const wasOpen = activePicker === which;
		activePicker = wasOpen ? null : which;
		styleCtx.setPickerOpen(activePicker !== null);
		if (wasOpen) pushSnapshot();
	}
</script>

<div class="style-panel" bind:this={panelEl}>
	<!-- Font family -->
	<div class="style-row">
		<span class="label mono-small">Font</span>
		<div class="controls">
			<Combobox
				options={fontOptions}
				value={fontFamily}
				placeholder="Search fonts"
				onchange={(id) => {
					// The new family may not offer the current weight/italic combo —
					// snap to the closest one it does have.
					const match = nearestVariant(variantsForFamily(id), fontWeight, italic);
					// Wait for the webfont before applying, so labels never repaint
					// in the fallback font mid-load.
					ensureFontLoaded(id, match.weight, match.italic).then(() => {
						fontFamily = id;
						fontWeight = match.weight;
						italic = match.italic;
						updateLayerLabelStyle(layer.id, { fontWeight, italic });
						pushSnapshot();
					});
				}}
			/>
		</div>
		<button class="icon-btn" onclick={onclose} aria-label="Close style panel">
			<X size={12} />
		</button>
	</div>

	{#if fonts.localSupported && !fonts.localLoaded}
		<div class="style-row local-fonts-row">
			<span class="label mono-small"></span>
			<div class="controls">
				<button class="link-btn body-small" onclick={() => requestLocalFonts()}>
					Load installed fonts…
				</button>
			</div>
		</div>
	{/if}

	<!-- Weight + italic -->
	<div class="style-row">
		<span class="label mono-small">Style</span>
		<div class="controls">
			<Combobox
				options={styleOptions}
				value={styleValue}
				onchange={selectStyle}
			/>
		</div>
	</div>

	<!-- Size -->
	<div class="style-row">
		<span class="label mono-small">Size</span>
		<div class="controls">
			<input
				class="width-input number-input"
				type="number" min="4" step="1"
				bind:value={fontSize}
				onblur={() => pushSnapshot()}
			/>
		</div>
	</div>

	<!-- Color -->
	<div class="style-row">
		<span class="label mono-small">Color</span>
		<div class="controls">
			<button
				class="swatch"
				class:ring={activePicker === 'color'}
				style="--c: {toRgba(colorHex, colorAlpha)}"
				onpointerdown={(e) => { e.stopPropagation(); togglePicker('color'); }}
				aria-label="Edit text color"
			></button>
		</div>
	</div>

	<!-- Halo -->
	<div class="style-row">
		<span class="label mono-small">Halo</span>
		<div class="controls">
			<button
				class="toggle-track"
				class:on={haloEnabled}
				role="switch"
				aria-checked={haloEnabled}
				onclick={() => {
					haloEnabled = !haloEnabled;
					if (!haloEnabled && activePicker === 'halo') { activePicker = null; styleCtx.setPickerOpen(false); }
					pushSnapshot();
				}}
			>
				<span class="toggle-thumb"></span>
			</button>
			<button
				class="swatch"
				class:ring={activePicker === 'halo'}
				style="--c: {toRgba(haloHex, 1)}; visibility: {haloEnabled ? 'visible' : 'hidden'}"
				onpointerdown={(e) => { e.stopPropagation(); togglePicker('halo'); }}
				aria-label="Edit halo color"
				tabindex={haloEnabled ? 0 : -1}
			></button>
			<input
				class="width-input number-input"
				type="number" min="0.5" step="0.5"
				bind:value={haloWidth}
				onblur={() => pushSnapshot()}
				style="visibility: {haloEnabled ? 'visible' : 'hidden'}"
				tabindex={haloEnabled ? 0 : -1}
			/>
		</div>
	</div>

	<div class="divider"></div>

	<!-- Text transform -->
	<div class="style-row">
		<span class="label mono-small">Case</span>
		<div class="controls">
			<Combobox
				options={transformOptions}
				value={textTransform}
				onchange={(id) => { textTransform = id as LabelTextTransform; updateLayerLabelStyle(layer.id, { textTransform }); pushSnapshot(); }}
			/>
		</div>
	</div>

	<!-- Letter spacing -->
	<div class="style-row">
		<span class="label mono-small">Spacing</span>
		<div class="controls">
			<input
				class="width-input number-input"
				type="number" step="0.5"
				bind:value={letterSpacing}
				onblur={() => pushSnapshot()}
			/>
		</div>
	</div>

	<!-- Anchor position -->
	<div class="style-row anchor-row">
		<span class="label mono-small">Anchor</span>
		<div class="controls">
			<div class="anchor-grid" role="radiogroup" aria-label="Label anchor position">
				{#each anchorGrid as a (a)}
					<button
						class="anchor-cell"
						class:on={anchor === a}
						role="radio"
						aria-checked={anchor === a}
						aria-label={a}
						title={a}
						onclick={() => { anchor = a; updateLayerLabelStyle(layer.id, { anchor }); pushSnapshot(); }}
					>
						<span class="anchor-dot"></span>
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- Multi-line: line height + alignment -->
	<div class="style-row">
		<span class="label mono-small">Lines</span>
		<div class="controls">
			<input
				class="width-input number-input"
				type="number" min="0.5" step="0.1"
				bind:value={lineHeight}
				onblur={() => pushSnapshot()}
				title="Line height"
			/>
			<div class="align-group">
				<button
					class="glyph-btn" class:on={textAlign === 'left'}
					aria-label="Align left" title="Align left"
					onclick={() => { textAlign = 'left'; updateLayerLabelStyle(layer.id, { textAlign }); pushSnapshot(); }}
				><TextAlignLeft size={14} /></button>
				<button
					class="glyph-btn" class:on={textAlign === 'center'}
					aria-label="Align center" title="Align center"
					onclick={() => { textAlign = 'center'; updateLayerLabelStyle(layer.id, { textAlign }); pushSnapshot(); }}
				><TextAlignCenter size={14} /></button>
				<button
					class="glyph-btn" class:on={textAlign === 'right'}
					aria-label="Align right" title="Align right"
					onclick={() => { textAlign = 'right'; updateLayerLabelStyle(layer.id, { textAlign }); pushSnapshot(); }}
				><TextAlignRight size={14} /></button>
			</div>
		</div>
	</div>
</div>

<!-- Floating color picker — outside the panel div so position: fixed escapes cleanly -->
{#if activePicker !== null}
	<div
		class="floating-picker"
		bind:this={floatingPickerEl}
		style="left: {pickerPos.left}px; top: {pickerPos.top}px"
	>
		{#if activePicker === 'color'}
			<ColorPickerPopup bind:hex={colorHex} bind:alpha={colorAlpha} title="Text color" onclose={closePicker} />
		{:else}
			<ColorPickerPopup bind:hex={haloHex} alpha={1} title="Halo color" onclose={closePicker} />
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

	.style-row.anchor-row {
		height: auto;
		align-items: flex-start;
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
		min-width: 0;
	}

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

	.width-input {
		width: 56px;
	}

	.style-row.local-fonts-row {
		height: 20px;
		margin-top: calc(-1 * var(--space-s));
	}

	.link-btn {
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		color: var(--color-text-tertiary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.link-btn:hover {
		color: var(--color-text-primary);
	}

	.glyph-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		color: var(--color-icon-primary);
	}

	.glyph-btn:hover {
		background: var(--color-surface-secondary);
	}

	.glyph-btn.on {
		background: var(--color-accent-subtle);
		color: var(--color-text-primary);
	}

	.align-group {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
	}

	.anchor-grid {
		display: grid;
		grid-template-columns: repeat(3, 20px);
		grid-template-rows: repeat(3, 20px);
		gap: 2px;
	}

	.anchor-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: 3px;
		background: var(--color-surface-primary);
		cursor: pointer;
		padding: 0;
	}

	.anchor-cell:hover {
		background: var(--color-surface-secondary);
	}

	.anchor-cell.on {
		background: var(--color-accent-subtle);
		border-color: var(--color-accent);
	}

	.anchor-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--color-icon-primary);
	}

	.anchor-cell.on .anchor-dot {
		background: var(--color-accent);
	}

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
