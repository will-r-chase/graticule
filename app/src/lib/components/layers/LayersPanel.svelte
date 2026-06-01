<script lang="ts">
	import { setContext } from 'svelte';
	import { dragHandleZone, DRAGGED_ELEMENT_ID } from 'svelte-dnd-action';
	import type { Layer } from '$lib/types';
	import { layers, reorderLayers, layerDrag } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { debug } from '$lib/stores/debug.svelte';
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

	{#if debug.enabled}
		<div class="debug-stats">
			<div class="debug-header mono-small">Debug</div>
			<label class="debug-row mono-small debug-checkbox-row">
				<span class="debug-label">bboxes</span>
				<input type="checkbox" checked={debug.showBboxes} onchange={(e) => { debug.showBboxes = (e.currentTarget as HTMLInputElement).checked; }} />
			</label>
			<label class="debug-row mono-small debug-checkbox-row">
				<span class="debug-label">no chunking</span>
				<input type="checkbox" checked={debug.noChunking} onchange={(e) => { debug.noChunking = (e.currentTarget as HTMLInputElement).checked; }} />
			</label>
			<label class="debug-row mono-small">
				<span class="debug-label">chunk verts</span>
				<select class="debug-select" value={debug.maxChunkVertices} onchange={(e) => { debug.maxChunkVertices = +(e.currentTarget as HTMLSelectElement).value; }}>
					<option value={500}>500</option>
					<option value={2_000}>2k</option>
					<option value={10_000}>10k</option>
					<option value={50_000}>50k</option>
					<option value={150_000}>150k</option>
				</select>
			</label>
			{#if debug.chunkStats.length > 0}
				<div class="debug-divider"></div>
				{#each debug.chunkStats as stat (stat.layerId)}
					<div class="debug-row mono-small">
						<span class="debug-layer-name" title={stat.layerName}>{stat.layerName}</span>
						<span class="debug-chunk-count">{stat.visible}/{stat.total}</span>
					</div>
				{/each}
			{/if}
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

	.debug-stats {
		flex-shrink: 0;
		border-top: 1px solid var(--color-border);
		padding: var(--space-s) var(--space-l);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.debug-header {
		color: var(--color-accent);
		font-weight: 600;
		margin-bottom: var(--space-xs);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.debug-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		color: var(--color-text-secondary);
		gap: var(--space-s);
	}

	.debug-label {
		color: var(--color-text-tertiary);
	}

	.debug-checkbox-row {
		cursor: pointer;
	}

	.debug-checkbox-row input {
		cursor: pointer;
	}

	.debug-layer-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.debug-chunk-count {
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	.debug-divider {
		height: 1px;
		background: var(--color-border);
		margin: var(--space-xs) 0;
	}

	.debug-select {
		background: var(--color-surface-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: inherit;
		font-family: inherit;
		padding: 1px 4px;
	}

</style>
