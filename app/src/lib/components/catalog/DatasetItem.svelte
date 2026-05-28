<script lang="ts">
	import type { Dataset } from '$lib/types';
	import { addLayer, layers } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import DatasetTooltip from './DatasetTooltip.svelte';

	let { dataset }: { dataset: Dataset } = $props();

	// True if this dataset is already in the layers list.
	let added = $derived(layers.some((l) => l.datasetId === dataset.id));

	let hovering = $state(false);
	let tooltipX = $state(0);
	let tooltipY = $state(0);

	function handleMouseEnter(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		tooltipX = rect.right + 8;
		tooltipY = rect.top;
		hovering = true;
	}

	function handleMouseLeave() {
		hovering = false;
	}
</script>

<li
	class="dataset-item"
	onmouseenter={handleMouseEnter}
	onmouseleave={handleMouseLeave}
	onclick={() => addLayer(dataset, pushSnapshot, pushSnapshot)}
>
	<span class="name">{dataset.name}</span>
	{#if added}
		<span class="dot" aria-label="Added to map"></span>
	{/if}

	{#if hovering}
		<DatasetTooltip {dataset} x={tooltipX} y={tooltipY} />
	{/if}
</li>

<style>
	.dataset-item {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: var(--space-s) var(--space-l) var(--space-s) calc(var(--space-l) + 4px);
		border-radius: var(--radius);
		cursor: pointer;
		list-style: none;
	}

	.dataset-item:hover {
		background-color: var(--color-surface-secondary);
	}

	.name {
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 0 1 auto;
		min-width: 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--pear-500);
		flex-shrink: 0;
	}
</style>
