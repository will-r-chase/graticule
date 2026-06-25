<script lang="ts">
	import { setContext } from 'svelte';
	import { dragHandleZone, DRAGGED_ELEMENT_ID } from 'svelte-dnd-action';
	import type { Layer } from '$lib/types';
	import { layers, reorderLayers, layerDrag, addEmptyLayer } from '$lib/stores/layers.svelte';
	import { layerSelection, clearLayerSelection, selectLayer, startLayerEdit } from '$lib/stores/layerSelection.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import LayerItem from './LayerItem.svelte';
	import FeaturesPanel from './FeaturesPanel.svelte';
	import { toolState } from '$lib/stores/tool.svelte';
	import { featuresTable, openFeaturesTable, closeFeaturesTable } from '$lib/stores/featuresTable.svelte';
	import { stylePanel } from '$lib/stores/stylePanel.svelte';
	import { Table, Plus } from 'phosphor-svelte';

	let layerListEl = $state<HTMLDivElement | null>(null);
	let hasBottomScroll = $state(false);

	$effect(() => {
		const el = layerListEl;
		if (!el) return;
		function update() {
			hasBottomScroll = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
		}
		update();
		el.addEventListener('scroll', update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(el);
		const mo = new MutationObserver(update);
		mo.observe(el, { childList: true, subtree: true });
		return () => {
			el.removeEventListener('scroll', update);
			ro.disconnect();
			mo.disconnect();
		};
	});

	// Create an empty layer, select it, open its Data tab, and start renaming with the
	// default name highlighted so the user can immediately rename and pick a source.
	function createEmptyLayer(): void {
		const id = addEmptyLayer();
		selectLayer(id);
		stylePanel.openWithDataTab(id);
		startLayerEdit(id);
		pushSnapshot();
	}

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
		consumePendingDataTab(id: string) { return stylePanel.consumePendingDataTab(id); },
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
		<div class="panel-header layers-header">
			<h3>Layers</h3>
			<button
				class="icon-btn"
				title="New layer"
				aria-label="New layer"
				onclick={(e) => { e.stopPropagation(); createEmptyLayer(); }}
			>
				<Plus size={16} />
			</button>
		</div>

		{#if layers.length === 0}
			<div class="empty-state">
				<p>No layers yet.</p>
				<p>Add a dataset from the Data panel.</p>
			</div>
		{:else}
			<div
				class="layer-list"
				bind:this={layerListEl}
				use:dragHandleZone={{ items: layers, flipDurationMs: 150, dropTargetStyle: {}, dragDisabled: pickerOpen, transformDraggedElement: collapseGhostAccordion }}
				onconsider={handleConsider}
				onfinalize={handleFinalize}
			>
				{#each layers as layer (layer.id)}
					<LayerItem {layer} />
				{/each}
			</div>
		{/if}
		{#if hasBottomScroll}
			<div class="scroll-fade-bottom" aria-hidden="true"></div>
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
		position: relative;
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

	.features-header,
	.layers-header {
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

	.scroll-fade-bottom {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 32px;
		pointer-events: none;
		z-index: 10;
		background: linear-gradient(to top, var(--color-surface-primary) 0%, transparent 100%);
	}

</style>
