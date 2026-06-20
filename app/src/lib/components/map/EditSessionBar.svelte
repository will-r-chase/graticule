<script lang="ts">
	import { Check, X, Trash, LineSegments } from 'phosphor-svelte';
	import { editSession, exitEditing, cancelEditing, deleteSelectedVertices, getSelectedVertexKeys } from '$lib/stores/editSession.svelte';
	import { layers } from '$lib/stores/layers.svelte';
	import { tooltip } from '$lib/actions/tooltip';

	const layerName = $derived(
		layers.find((l) => l.id === editSession.activeLayerId)?.name ?? ''
	);
	// Re-read on every version bump (selection changes bump editSession.version).
	const selectedCount = $derived.by(() => {
		void editSession.version;
		return getSelectedVertexKeys().size;
	});
</script>

{#if editSession.activeLayerId}
<div class="edit-bar">
	<span class="label">
		<LineSegments size={16} weight="regular" />
		Editing: {layerName}
	</span>
	{#if selectedCount > 0}
	<div class="bar-divider"></div>
	<button
		class="bar-btn bar-btn--danger"
		onclick={deleteSelectedVertices}
		aria-label="Delete selected vertices"
		use:tooltip={{ text: 'Delete selected', shortcut: 'Del', placement: 'up' }}
	>
		<Trash size={16} weight="regular" />
		<span>Delete {selectedCount === 1 ? 'point' : `${selectedCount} points`}</span>
	</button>
	{/if}
	<div class="bar-divider"></div>
	<button
		class="bar-btn"
		onclick={cancelEditing}
		aria-label="Discard edits"
		use:tooltip={{ text: 'Discard edits', shortcut: 'Esc', placement: 'up' }}
	>
		<X size={16} weight="regular" />
		<span>Cancel</span>
	</button>
	<button
		class="bar-btn"
		onclick={exitEditing}
		aria-label="Done editing"
		use:tooltip={{ text: 'Commit edits', shortcut: 'Enter', placement: 'up' }}
	>
		<Check size={16} weight="regular" />
		<span>Done</span>
	</button>
</div>
{/if}

<style>
	.edit-bar {
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

	.label {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
	}

	.bar-divider {
		width: 1px;
		align-self: stretch;
		background: var(--color-border);
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
		cursor: pointer;
	}

	.bar-btn:hover {
		background: var(--color-surface-secondary);
	}

	.bar-btn--danger {
		color: var(--color-text-error, #d23f3f);
	}
</style>
