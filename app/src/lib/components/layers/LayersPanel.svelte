<script lang="ts">
	import { setContext } from 'svelte';
	import { dndzone } from 'svelte-dnd-action';
	import type { Layer } from '$lib/types';
	import { layers, reorderLayers } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import LayerItem from './LayerItem.svelte';

	// Track which layer's style panel is open. Stored here (not inside the
	// dndzone subtree) so the ColorPicker is never a descendant of the drag
	// container — keeping pointer events fully isolated from the drag handler.
	let openStyleLayerId = $state<string | null>(null);
	let pickerOpen = $state(false);

	setContext('stylePanel', {
		get openId() { return openStyleLayerId; },
		toggle(id: string) {
			openStyleLayerId = openStyleLayerId === id ? null : id;
		},
		get pickerOpen() { return pickerOpen; },
		setPickerOpen(open: boolean) { pickerOpen = open; },
	});

	function handleConsider(e: CustomEvent<{ items: Layer[] }>) {
		reorderLayers(e.detail.items);
	}

	function handleFinalize(e: CustomEvent<{ items: Layer[] }>) {
		reorderLayers(e.detail.items);
		pushSnapshot();
	}
</script>

<div class="layers-panel">
	<div class="panel-header">
		<h3>Layers</h3>
	</div>

	{#if layers.length === 0}
		<div class="empty-state">
			<p>No layers yet.</p>
			<p>Add a dataset from the Data panel.</p>
		</div>
	{:else}
		<div
			class="layer-list"
			use:dndzone={{ items: layers, flipDurationMs: 150, dropTargetStyle: {}, dragDisabled: pickerOpen }}
			onconsider={handleConsider}
			onfinalize={handleFinalize}
		>
			{#each layers as layer (layer.id)}
				<LayerItem {layer} />
			{/each}
		</div>
	{/if}

</div>

<style>
	.layers-panel {
		width: 280px;
		height: 100%;
		background-color: var(--color-surface-primary);
		border-left: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.panel-header {
		padding: var(--space-l) var(--space-l) var(--space-s);
		flex-shrink: 0;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-s);
		padding: var(--space-xl);
		text-align: center;
	}

	.empty-state p {
		color: var(--color-text-tertiary);
	}

	.empty-state p:first-child {
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.layer-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-m) 0;
	}

</style>
