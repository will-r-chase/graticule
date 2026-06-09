<script lang="ts">
	import { Trash, StackPlus, X } from 'phosphor-svelte';
	import { selection, clearSelection } from '$lib/stores/selection.svelte';
	import { deleteSelectedFeatures, extractSelectedFeatures, mergeSelectedFeatures, isMergeCompatible } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { tooltip } from '$lib/actions/tooltip';

	const count = $derived(
		[...selection.features.values()].reduce((sum, s) => sum + s.size, 0)
	);
	const isMultiLayer = $derived(selection.features.size > 1);
	const canMerge = $derived(!isMultiLayer || isMergeCompatible(selection.features));

	const copyTooltipText = $derived(
		canMerge
			? (isMultiLayer ? 'Merge to new layer' : 'Copy to new layer')
			: 'Cannot merge features of different geometry types'
	);
	const copyTooltipShortcut = $derived(canMerge ? 'E' : undefined);

	function handleCopyToLayer() {
		if (!canMerge || count === 0) return;
		const snapshot = new Map(
			[...selection.features.entries()].map(([k, v]) => [k, new Set(v)])
		);
		clearSelection();
		if (snapshot.size > 1) {
			mergeSelectedFeatures(snapshot, () => pushSnapshot());
		} else {
			const [layerId, indices] = [...snapshot.entries()][0];
			extractSelectedFeatures(layerId, indices, () => pushSnapshot());
		}
	}

	function handleDelete() {
		if (count === 0) return;
		const snapshot = new Map(
			[...selection.features.entries()].map(([k, v]) => [k, new Set(v)])
		);
		clearSelection();
		let remaining = snapshot.size;
		for (const [layerId, indices] of snapshot) {
			deleteSelectedFeatures(layerId, indices, () => {
				remaining--;
				if (remaining === 0) pushSnapshot();
			});
		}
	}
</script>

{#if count > 0}
<div class="selection-bar">
	<button
		class="bar-btn"
		onclick={handleCopyToLayer}
		aria-disabled={!canMerge}
		aria-label="Copy to new layer"
		use:tooltip={{ text: copyTooltipText, shortcut: copyTooltipShortcut, placement: 'up' }}
	>
		<StackPlus size={16} weight="regular" />
		<span>{isMultiLayer ? 'Merge to new layer' : 'Copy to layer'}</span>
	</button>
	<button
		class="bar-btn bar-btn--danger"
		onclick={handleDelete}
		aria-label="Delete selected features"
		use:tooltip={{ text: 'Delete selected', shortcut: 'Del', placement: 'up' }}
	>
		<Trash size={16} weight="regular" />
		<span>Delete</span>
	</button>
	<div class="bar-divider"></div>
	<span class="count">{count} selected</span>
	<button
		class="bar-btn bar-btn--icon"
		onclick={clearSelection}
		aria-label="Clear selection"
		use:tooltip={{ text: 'Clear selection', shortcut: 'Esc', placement: 'up' }}
	>
		<X size={14} />
	</button>
</div>
{/if}

<style>
	.selection-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface-primary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		overflow: hidden;
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

	.bar-btn :global(svg) {
		color: var(--color-icon-primary);
		flex-shrink: 0;
	}

	.bar-btn[aria-disabled='true'] {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.bar-btn:hover {
		background: var(--color-surface-secondary);
	}

	.bar-btn[aria-disabled='true']:hover {
		background: transparent;
	}

	.bar-btn--danger:hover {
		background: #fef2f2;
		color: #dc2626;
	}

	.bar-btn--danger:hover :global(svg) {
		color: #dc2626;
	}

	.bar-btn--icon {
		padding: 0;
		width: 36px;
		justify-content: center;
		color: var(--color-icon-primary);
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
</style>
