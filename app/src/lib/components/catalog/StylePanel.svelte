<script lang="ts">
	import { CaretDown } from 'phosphor-svelte';
	import ColorPickerPopup from '$lib/components/ui/ColorPickerPopup.svelte';
	import { globeStyles } from '$lib/stores/globeStyles.svelte';
	import { background } from '$lib/stores/background.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { PROJECTIONS } from '$lib/config';

	const projectionEntry = $derived(PROJECTIONS.find(p => p.id === projectionStore.id) ?? PROJECTIONS[0]);
	const isGlobe = $derived(projectionEntry.isGlobe === true);

	let open = $state(true); // open by default

	type PickerTarget = 'background' | 'ocean' | 'halo';
	let activePicker = $state<PickerTarget | null>(null);

	let panelEl          = $state<HTMLDivElement | null>(null);
	let floatingPickerEl = $state<HTMLDivElement | null>(null);
	let pickerPos        = $state({ left: 0, top: 0 });

	// Position the floating picker to the right of the catalog panel,
	// clamping vertically so it never extends below the viewport.
	$effect(() => {
		if (activePicker === null || !panelEl) return;
		const rect    = panelEl.getBoundingClientRect();
		const gap     = 8;
		const left    = rect.right + gap;
		const pickerH = floatingPickerEl?.getBoundingClientRect().height ?? 400;
		const top     = Math.min(Math.max(gap, rect.top), window.innerHeight - pickerH - gap);
		pickerPos = { left, top };
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

	function closePicker() {
		activePicker = null;
		pushSnapshot();
	}

	function togglePicker(which: PickerTarget) {
		if (activePicker === which) { closePicker(); return; }
		activePicker = which;
	}

	function toRgba(hex: string, alpha: number): string {
		const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
		if (!m) return 'transparent';
		return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
	}
</script>

<div bind:this={panelEl} class="panel-root">
	<!-- Collapsible heading -->
	<button class="heading h4" onclick={() => (open = !open)}>
		<span class="caret" class:open><CaretDown size={8} weight="bold" /></span>
		Style
	</button>

	{#if open}
		<div class="rows">
			<!-- Background -->
			<div class="style-row">
				<span class="label mono-small">Background</span>
				<div class="controls">
					<button
						class="toggle-track"
						class:on={background.enabled}
						role="switch"
						aria-checked={background.enabled}
						onclick={() => {
							background.enabled = !background.enabled;
							if (!background.enabled) activePicker = null;
							pushSnapshot();
						}}
					><span class="toggle-thumb"></span></button>

					<button
						class="swatch"
						class:ring={activePicker === 'background'}
						style="--c: {toRgba(background.hex, background.alpha)}; visibility: {background.enabled ? 'visible' : 'hidden'}"
						onpointerdown={(e) => { e.stopPropagation(); togglePicker('background'); }}
						aria-label="Edit background color"
						tabindex={background.enabled ? 0 : -1}
					></button>
				</div>
			</div>

			<!-- Globe-only styles -->
			{#if isGlobe}
				<!-- Ocean -->
				<div class="style-row">
					<span class="label mono-small">Ocean</span>
					<div class="controls">
						<button
							class="toggle-track"
							class:on={globeStyles.ocean.enabled}
							role="switch"
							aria-checked={globeStyles.ocean.enabled}
							onclick={() => {
								globeStyles.ocean.enabled = !globeStyles.ocean.enabled;
								if (!globeStyles.ocean.enabled) activePicker = null;
							}}
						><span class="toggle-thumb"></span></button>

						<button
							class="swatch"
							class:ring={activePicker === 'ocean'}
							style="--c: {toRgba(globeStyles.ocean.hex, globeStyles.ocean.alpha)}; visibility: {globeStyles.ocean.enabled ? 'visible' : 'hidden'}"
							onpointerdown={(e) => { e.stopPropagation(); togglePicker('ocean'); }}
							aria-label="Edit ocean color"
							tabindex={globeStyles.ocean.enabled ? 0 : -1}
						></button>
					</div>
				</div>

				<!-- Shadow -->
				<div class="style-row">
					<span class="label mono-small">Shadow</span>
					<div class="controls">
						<button
							class="toggle-track"
							class:on={globeStyles.shadow.enabled}
							role="switch"
							aria-checked={globeStyles.shadow.enabled}
							onclick={() => { globeStyles.shadow.enabled = !globeStyles.shadow.enabled; }}
						><span class="toggle-thumb"></span></button>

						{#if globeStyles.shadow.enabled}
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								bind:value={globeStyles.shadow.intensity}
								class="slider"
								aria-label="Shadow intensity"
							/>
						{/if}
					</div>
				</div>

				<!-- Halo -->
				<div class="style-row">
					<span class="label mono-small">Halo</span>
					<div class="controls">
						<button
							class="toggle-track"
							class:on={globeStyles.halo.enabled}
							role="switch"
							aria-checked={globeStyles.halo.enabled}
							onclick={() => {
								globeStyles.halo.enabled = !globeStyles.halo.enabled;
								if (!globeStyles.halo.enabled) activePicker = null;
							}}
						><span class="toggle-thumb"></span></button>

						<button
							class="swatch"
							class:ring={activePicker === 'halo'}
							style="--c: {toRgba(globeStyles.halo.hex, globeStyles.halo.alpha)}; visibility: {globeStyles.halo.enabled ? 'visible' : 'hidden'}"
							onpointerdown={(e) => { e.stopPropagation(); togglePicker('halo'); }}
							aria-label="Edit halo color"
							tabindex={globeStyles.halo.enabled ? 0 : -1}
						></button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Floating color picker — position: fixed so it escapes the panel -->
{#if activePicker !== null}
	<div
		class="floating-picker"
		bind:this={floatingPickerEl}
		style="left: {pickerPos.left}px; top: {pickerPos.top}px"
	>
		{#if activePicker === 'background'}
			<ColorPickerPopup
				bind:hex={background.hex}
				bind:alpha={background.alpha}
				title="Background color"
				onclose={closePicker}
			/>
		{:else if activePicker === 'ocean'}
			<ColorPickerPopup
				bind:hex={globeStyles.ocean.hex}
				bind:alpha={globeStyles.ocean.alpha}
				title="Ocean color"
				onclose={closePicker}
			/>
		{:else if activePicker === 'halo'}
			<ColorPickerPopup
				bind:hex={globeStyles.halo.hex}
				bind:alpha={globeStyles.halo.alpha}
				title="Halo color"
				onclose={closePicker}
			/>
		{/if}
	</div>
{/if}

<style>
	.panel-root {
		margin-top: var(--space-m);
		margin-bottom: var(--space-m);
	}

	.heading {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-s);
		background: none;
		border: none;
		margin-left: calc(-1 * var(--space-l));
		width: calc(100% + 2 * var(--space-l));
		padding: var(--space-s) var(--space-l);
		cursor: pointer;
		text-align: left;
		color: var(--color-text-secondary);
	}

	.caret {
		position: absolute;
		left: calc(var(--space-l) - 14px);
		display: flex;
		color: var(--color-icon-secondary);
		opacity: 0;
		transition: opacity 150ms, transform 150ms;
		transform: rotate(-90deg);
	}

	.heading:hover .caret {
		opacity: 1;
	}

	.caret.open {
		transform: rotate(0deg);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
		padding-top: var(--space-s);
		padding-left: var(--space-m);
	}

	.style-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 24px;
	}

	.label {
		width: 72px;
		flex-shrink: 0;
		color: var(--color-text-tertiary);
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

	.toggle-track.on { background: var(--color-accent); }

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

	.toggle-track.on .toggle-thumb { transform: translateX(12px); }

	/* Color swatch */
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

	/* Intensity slider */
	.slider {
		flex: 1;
		height: 4px;
		cursor: pointer;
		accent-color: var(--color-accent);
	}

	.floating-picker {
		position: fixed;
		z-index: 50;
	}
</style>
