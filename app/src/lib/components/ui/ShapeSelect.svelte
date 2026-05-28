<script lang="ts">
	import * as d3shape from 'd3-shape';
	import { POINT_SHAPES } from '$lib/config';

	let { value = $bindable('symbolCircle'), onchange }: { value?: string; onchange?: (id: string) => void } = $props();

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let dropdownTop  = $state(0);
	let dropdownLeft = $state(0);
	let dropdownWidth = $state(0);

	function openDropdown() {
		if (triggerEl) {
			const rect = triggerEl.getBoundingClientRect();
			dropdownTop   = rect.bottom + 4;
			dropdownLeft  = rect.left;
			dropdownWidth = rect.width;
		}
		open = !open;
	}

	const shapeMap: Record<string, d3shape.SymbolType> = {
		symbolCircle:   d3shape.symbolCircle,
		symbolSquare:   d3shape.symbolSquare,
		symbolDiamond:  d3shape.symbolDiamond,
		symbolTriangle: d3shape.symbolTriangle,
		symbolCross:    d3shape.symbolCross,
		symbolStar:     d3shape.symbolStar,
		symbolWye:      d3shape.symbolWye,
	};

	const PREVIEW_SIZE = 64;

	function symbolPath(id: string): string {
		const sym = shapeMap[id];
		if (!sym) return '';
		return d3shape.symbol(sym, PREVIEW_SIZE)() ?? '';
	}

	function select(id: string) {
		value = id;
		open = false;
		onchange?.(id);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}

	let selectedLabel = $derived(POINT_SHAPES.find(s => s.id === value)?.label ?? 'Circle');
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="shape-select" class:open>
	<button
		class="trigger body-small"
		bind:this={triggerEl}
		onclick={openDropdown}
		aria-haspopup="listbox"
		aria-expanded={open}
	>
		<svg class="preview-icon" viewBox="-8 -8 16 16" width="14" height="14">
			<path d={symbolPath(value)} fill="var(--color-text-primary)" />
		</svg>
		<span>{selectedLabel}</span>
		<svg class="caret" viewBox="0 0 8 8" width="8" height="8">
			<path d="M1 2.5 L4 5.5 L7 2.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="backdrop" onclick={() => open = false} role="presentation"></div>
		<ul class="dropdown" role="listbox" style="top: {dropdownTop}px; left: {dropdownLeft}px; min-width: {dropdownWidth}px;">
			{#each POINT_SHAPES as shape}
				<li role="option" aria-selected={value === shape.id}>
					<button
						class="option body-small"
						class:selected={value === shape.id}
						onclick={() => select(shape.id)}
					>
						<svg class="preview-icon" viewBox="-8 -8 16 16" width="14" height="14">
							<path d={symbolPath(shape.id)} fill="var(--color-text-primary)" />
						</svg>
						{shape.label}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.shape-select {
		position: relative;
	}

	.trigger {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 26px;
		padding: 0 var(--space-m);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		cursor: pointer;
		width: 100%;
	}

	.trigger span {
		flex: 1;
		text-align: left;
	}

	.trigger:hover {
		border-color: var(--color-text-primary);
	}

	.open .trigger {
		border-color: var(--color-accent);
	}

	.caret {
		color: var(--color-icon-secondary);
		flex-shrink: 0;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 9;
	}

	.dropdown {
		position: fixed;
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		list-style: none;
		padding: var(--space-s);
		z-index: 10;
		margin: 0;
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		width: 100%;
		padding: var(--space-s) var(--space-m);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		text-align: left;
	}

	.option:hover {
		background: var(--color-surface-secondary);
	}

	.option.selected {
		color: var(--color-accent);
	}

	.option.selected path {
		fill: var(--color-accent);
	}

	.preview-icon {
		flex-shrink: 0;
	}
</style>
