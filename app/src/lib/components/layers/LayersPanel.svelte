<script lang="ts">
	import { setContext } from 'svelte';
	import { dragHandleZone, DRAGGED_ELEMENT_ID } from 'svelte-dnd-action';
	import type { Layer } from '$lib/types';
	import { layers, reorderLayers, layerDrag } from '$lib/stores/layers.svelte';
	import { layerSelection, clearLayerSelection } from '$lib/stores/layerSelection.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import LayerItem from './LayerItem.svelte';
	import FeaturesPanel from './FeaturesPanel.svelte';
	import { toolState } from '$lib/stores/tool.svelte';
	import { featuresTable, openFeaturesTable, closeFeaturesTable } from '$lib/stores/featuresTable.svelte';
	import { stylePanel } from '$lib/stores/stylePanel.svelte';
	import { Table } from 'phosphor-svelte';

	function toggleTable(): void {
		if (featuresTable.open) {
			closeFeaturesTable();
		} else {
			const activeId = layerSelection.ids[0];
			const target = activeId
				? layers.find(l => l.id === activeId && l.hasTopology)
				: layers.find(l => l.hasTopology);
			if (target) openFeaturesTable(target.id);
		}
	}

	// Track which layer's style panel is open. Stored here (not inside the
	// dndzone subtree) so the ColorPicker is never a descendant of the drag
	// container — keeping pointer events fully isolated from the drag handler.
	let pickerOpen = $state(false);

	setContext('stylePanel', {
		get openId() { return stylePanel.openId; },
		toggle(id: string) { stylePanel.toggle(id); },
		get pickerOpen() { return pickerOpen; },
		setPickerOpen(open: boolean) { pickerOpen = open; },
	});

	// Lock the drag ghost to vertical movement only.
	// The library moves the ghost via inline translate3d(dx, dy, 0). We watch the
	// ghost's style attribute and zero out the X component before each paint.
	$effect(() => {
		let styleObserver: MutationObserver | null = null;

		const bodyObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node instanceof HTMLElement && node.id === DRAGGED_ELEMENT_ID) {
						styleObserver = new MutationObserver(() => {
							const t = (node as HTMLElement).style.transform;
							if (!t.startsWith('translate3d(0px,')) {
								const m = t.match(/translate3d\([^,]+,\s*([^,]+),/);
								if (m) (node as HTMLElement).style.transform = `translate3d(0px, ${m[1]}, 0)`;
							}
						});
						styleObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
					}
				}
				for (const node of mutation.removedNodes) {
					if (node instanceof HTMLElement && node.id === DRAGGED_ELEMENT_ID) {
						styleObserver?.disconnect();
						styleObserver = null;
					}
				}
			}
		});

		bodyObserver.observe(document.body, { childList: true });
		return () => {
			bodyObserver.disconnect();
			styleObserver?.disconnect();
		};
	});

	function collapseGhostAccordion(ghostEl: HTMLElement) {
		const accordion = ghostEl.querySelector('.style-accordion') as HTMLElement | null;
		if (accordion) accordion.style.display = 'none';
	}

	function handleConsider(e: CustomEvent<{ items: Layer[] }>) {
		layerDrag.active = true;
		reorderLayers(e.detail.items);
	}

	function handleFinalize(e: CustomEvent<{ items: Layer[] }>) {
		layerDrag.active = false;
		reorderLayers(e.detail.items);
		pushSnapshot();
	}
</script>

<div class="layers-panel">
	<div class="layers-section" onclick={clearLayerSelection}>
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
				use:dragHandleZone={{ items: layers, flipDurationMs: 150, dropTargetStyle: {}, dragDisabled: pickerOpen, transformDraggedElement: collapseGhostAccordion }}
				onconsider={handleConsider}
				onfinalize={handleFinalize}
			>
				{#each layers as layer (layer.id)}
					<LayerItem {layer} />
				{/each}
			</div>
		{/if}
	</div>

	{#if toolState.active === 'select'}
		<div class="features-section">
			<div class="panel-header features-header">
				<h3>Features</h3>
				<button
					class="icon-btn"
					class:active={featuresTable.open}
					title="Features table"
					aria-label="Toggle features table"
					onclick={toggleTable}
				>
					<Table size={16} />
				</button>
			</div>
			<FeaturesPanel />
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

	.layers-section {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.features-section {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--color-border);
		overflow: hidden;
	}

	.panel-header {
		padding: var(--space-l) var(--space-l) var(--space-s);
		flex-shrink: 0;
	}

	.features-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		color: var(--color-icon-primary);
		flex-shrink: 0;
	}

	.icon-btn:hover {
		background-color: var(--color-surface-secondary);
	}

	.icon-btn.active {
		background-color: var(--color-accent-subtle);
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

	.layer-list:focus-visible {
		outline: none;
	}


</style>
