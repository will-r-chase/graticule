<script lang="ts">
	import { layers, workingTopologyData, dissolveLayer, explodeLayer, clipLayers, differenceLayers, unionLayers, mergeLayers } from '$lib/stores/layers.svelte';
	import { layerSelection, clearLayerSelection } from '$lib/stores/layerSelection.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { tooltip } from '$lib/actions/tooltip';
	import { UniteSquare, DiamondsFour, Crop, SubtractSquare, Unite, GitMerge, X } from 'phosphor-svelte';

	const count = $derived(layerSelection.ids.length);
	const visible = $derived(count > 0 && layerSelection.enteredId === null);

	// Ordered selected layers (by stack position, top first).
	const selectedLayers = $derived(
		layers.filter(l => layerSelection.ids.includes(l.id))
	);

	// Single-layer context.
	const singleLayer = $derived(count === 1 ? selectedLayers[0] : null);
	const hasMultiTypes = $derived(
		singleLayer?.geometryTypes.some(t => t.startsWith('Multi')) ?? false
	);

	// Fields available for dissolve grouping.
	const dissolveFields = $derived.by(() => {
		if (!singleLayer) return [];
		const topo = workingTopologyData.get(singleLayer.id);
		if (!topo) return [];
		const objectName = Object.keys(topo.objects)[0];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const geoms = (topo.objects[objectName] as any).geometries as any[] | undefined;
		const first = geoms?.find((g: any) => g.properties);
		return first ? Object.keys(first.properties) : [];
	});

	// Two-layer context: top layer is mask, bottom is target (by stack order).
	const twoLayerOps = $derived.by(() => {
		if (count !== 2) return null;
		const [a, b] = selectedLayers; // already ordered by stack position (top first)
		if (!a || !b) return null; // transient: layer removed but selection ids not yet cleared
		return { maskId: a.id, maskName: a.name, targetId: b.id, targetName: b.name };
	});

	function isPolygon(layer: { geometryTypes: string[] }): boolean {
		return layer.geometryTypes.some(t => t === 'Polygon' || t === 'MultiPolygon');
	}

	// Clip and Subtract require the mask (top layer) to be a polygon.
	const maskIsPolygon = $derived(selectedLayers.length >= 1 && isPolygon(selectedLayers[0]));
	// Mosaic requires all selected layers to be polygon.
	const allPolygon = $derived(selectedLayers.every(isPolygon));

	// Dissolve popover state.
	let dissolveOpen = $state(false);
	let dissolveField = $state('');
	let dissolveBtn = $state<HTMLButtonElement | null>(null);

	function openDissolve() {
		dissolveField = '';
		dissolveOpen = true;
	}

	function handleDissolve() {
		if (!singleLayer) return;
		dissolveOpen = false;
		dissolveLayer(singleLayer.id, dissolveField || null, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleExplode() {
		if (!singleLayer) return;
		explodeLayer(singleLayer.id, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleClip() {
		if (!twoLayerOps) return;
		clipLayers(twoLayerOps.targetId, twoLayerOps.maskId, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleDifference() {
		if (!twoLayerOps) return;
		differenceLayers(twoLayerOps.targetId, twoLayerOps.maskId, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleUnion() {
		unionLayers(layerSelection.ids, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleMerge() {
		mergeLayers(layerSelection.ids, () => {
			clearLayerSelection();
			pushSnapshot();
		});
	}

	function handleDissolveKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleDissolve();
		if (e.key === 'Escape') { dissolveOpen = false; }
	}
</script>

{#if visible}
<div class="layer-action-bar">
	{#if count === 1}
		<!-- Dissolve -->
		<div class="popover-anchor">
			<button
				class="bar-btn"
				bind:this={dissolveBtn}
				onclick={openDissolve}
				use:tooltip={{ text: 'Merge features into one', placement: 'up' }}
			>
				<UniteSquare size={14} />
				Dissolve
			</button>

			{#if dissolveOpen}
			<div class="dissolve-popover" onkeydown={handleDissolveKeydown} role="dialog" aria-label="Dissolve options">
				<label class="popover-label" for="dissolve-field">Group by field</label>
				<select id="dissolve-field" class="field-select" bind:value={dissolveField}>
					<option value="">All features (merge all)</option>
					{#each dissolveFields as field}
						<option value={field}>{field}</option>
					{/each}
				</select>
				<div class="popover-actions">
					<button class="popover-cancel" onclick={() => dissolveOpen = false}>Cancel</button>
					<button class="popover-confirm" onclick={handleDissolve}>Dissolve</button>
				</div>
			</div>
			{/if}
		</div>

		<!-- Explode — only relevant when Multi- geometry types are present -->
		{#if hasMultiTypes}
		<button
			class="bar-btn"
			onclick={handleExplode}
			use:tooltip={{ text: 'Split multi-part features into individual features', placement: 'up' }}
		>
			<DiamondsFour size={14} />
			Explode
		</button>
		{/if}

	{:else if count === 2}
		<button
			class="bar-btn"
			class:bar-btn--disabled={!maskIsPolygon}
			disabled={!maskIsPolygon}
			onclick={handleClip}
			use:tooltip={{
				text: maskIsPolygon
					? `Clip ${twoLayerOps?.targetName} to shape of ${twoLayerOps?.maskName}`
					: `Clip requires the mask layer (${twoLayerOps?.maskName}) to be a polygon layer`,
				placement: 'up'
			}}
		>
			<Crop size={14} />
			Clip
		</button>
		<button
			class="bar-btn"
			class:bar-btn--disabled={!maskIsPolygon}
			disabled={!maskIsPolygon}
			onclick={handleDifference}
			use:tooltip={{
				text: maskIsPolygon
					? `Subtract ${twoLayerOps?.maskName} from ${twoLayerOps?.targetName}`
					: `Subtract requires the mask layer (${twoLayerOps?.maskName}) to be a polygon layer`,
				placement: 'up'
			}}
		>
			<SubtractSquare size={14} />
			Subtract
		</button>
		<button
			class="bar-btn"
			class:bar-btn--disabled={!allPolygon}
			disabled={!allPolygon}
			onclick={handleUnion}
			use:tooltip={{
				text: allPolygon
					? 'Create a polygon mosaic from all selected layers'
					: 'Mosaic requires all selected layers to be polygon layers',
				placement: 'up'
			}}
		>
			<Unite size={14} />
			Mosaic
		</button>
		<button
			class="bar-btn"
			onclick={handleMerge}
			use:tooltip={{ text: 'Combine features from all selected layers into one layer', placement: 'up' }}
		>
			<GitMerge size={14} />
			Merge
		</button>

	{:else}
		<button
			class="bar-btn"
			class:bar-btn--disabled={!allPolygon}
			disabled={!allPolygon}
			onclick={handleUnion}
			use:tooltip={{
				text: allPolygon
					? 'Create a polygon mosaic from all selected layers'
					: 'Mosaic requires all selected layers to be polygon layers',
				placement: 'up'
			}}
		>
			<Unite size={14} />
			Mosaic
		</button>
		<button
			class="bar-btn"
			onclick={handleMerge}
			use:tooltip={{ text: 'Combine features from all selected layers into one layer', placement: 'up' }}
		>
			<GitMerge size={14} />
			Merge
		</button>
	{/if}

	<div class="bar-divider"></div>
	<span class="count">{count} {count === 1 ? 'layer' : 'layers'}</span>
	<button
		class="bar-btn bar-btn--icon"
		onclick={clearLayerSelection}
		aria-label="Clear selection"
		use:tooltip={{ text: 'Clear selection', shortcut: 'Esc', placement: 'up' }}
	>
		<X size={14} />
	</button>
</div>
{/if}

<style>
	.layer-action-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface-primary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		overflow: visible;
		white-space: nowrap;
	}

	.bar-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		font-weight: 400;
		cursor: pointer;
	}

	.bar-btn:hover {
		background: var(--color-surface-secondary);
	}

	.bar-btn--icon {
		padding: 0 10px;
	}

	.bar-btn--disabled,
	.bar-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.bar-btn--disabled:hover,
	.bar-btn:disabled:hover {
		background: transparent;
	}

	.bar-divider {
		width: 1px;
		align-self: stretch;
		background: var(--color-border);
		flex-shrink: 0;
	}

	.count {
		padding: 0 10px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.popover-anchor {
		position: relative;
	}

	.dissolve-popover {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 0;
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		padding: var(--space-m);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
		min-width: 220px;
		z-index: 20;
	}

	.popover-label {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.field-select {
		height: 28px;
		padding: 0 var(--space-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		cursor: pointer;
	}

	.popover-actions {
		display: flex;
		gap: var(--space-s);
		justify-content: flex-end;
	}

	.popover-cancel,
	.popover-confirm {
		height: 28px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 12px;
		cursor: pointer;
	}

	.popover-cancel {
		background: transparent;
		color: var(--color-text-secondary);
	}

	.popover-cancel:hover {
		background: var(--color-surface-secondary);
	}

	.popover-confirm {
		background: var(--color-accent);
		color: white;
		border-color: var(--color-accent);
	}

	.popover-confirm:hover {
		opacity: 0.9;
	}
</style>
