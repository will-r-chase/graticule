<script lang="ts">
	import { Eye, EyeSlash, X } from 'phosphor-svelte';
	import type { Layer } from '$lib/types';
	import { removeLayer, toggleVisibility, renameLayer } from '$lib/stores/layers.svelte';

	let { layer }: { layer: Layer } = $props();

	let editing = $state(false);
	let draft = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// Focus the input as soon as it appears in the DOM.
	$effect(() => {
		if (editing && inputEl) inputEl.focus();
	});

	function startEditing() {
		draft = layer.name;
		editing = true;
	}

	function commitEdit() {
		renameLayer(layer.id, draft);
		editing = false;
	}

	function cancelEdit() {
		editing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commitEdit();
		if (e.key === 'Escape') cancelEdit();
	}
</script>

<div class="layer-item">
	{#if editing}
		<input
			class="name-input"
			bind:this={inputEl}
			bind:value={draft}
			onblur={commitEdit}
			onkeydown={handleKeydown}
		/>
	{:else}
		<span
			class="name"
			class:muted={!layer.visible}
			ondblclick={startEditing}
			onpointerdown={(e) => e.stopPropagation()}
		>{layer.name}</span>
	{/if}

	<div class="actions">
		<button
			class="icon-btn"
			aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
			onclick={() => toggleVisibility(layer.id)}
		>
			{#if layer.visible}
				<Eye size={16} color="var(--color-icon-primary)" />
			{:else}
				<EyeSlash size={16} color="var(--color-icon-secondary)" />
			{/if}
		</button>

		<button
			class="icon-btn"
			aria-label="Remove layer"
			onclick={() => removeLayer(layer.id)}
		>
			<X size={16} color="var(--color-icon-secondary)" />
		</button>
	</div>
</div>

<style>
	.layer-item {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		padding: var(--space-s) var(--space-l);
		border-radius: var(--radius);
		cursor: grab;
	}

	.layer-item:active {
		cursor: grabbing;
	}

	.layer-item:hover {
		background-color: var(--color-surface-secondary);
	}

	.name {
		flex: 1;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name.muted {
		color: var(--color-text-secondary);
	}

	.name-input {
		flex: 1;
		color: var(--color-text-primary);
		border: none;
		border-bottom: 1px solid var(--color-accent);
		background: transparent;
		outline: none;
		padding: 0;
		cursor: text;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
		flex-shrink: 0;
		opacity: 0;
	}

	.layer-item:hover .actions {
		opacity: 1;
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
	}

	.icon-btn:hover {
		background-color: var(--color-surface-tertiary);
	}
</style>
