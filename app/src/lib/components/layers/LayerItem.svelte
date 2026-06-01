<script lang="ts">
	import { getContext } from 'svelte';
	import { Eye, EyeSlash, X, SlidersHorizontal, CircleNotch } from 'phosphor-svelte';
	import type { Layer } from '$lib/types';
	import { removeLayer, toggleVisibility, renameLayer } from '$lib/stores/layers.svelte';
	import { pushSnapshot, historyVersion } from '$lib/stores/history.svelte';
	import LayerStylePanel from './LayerStylePanel.svelte';
	import LayerProcessingPanel from './LayerProcessingPanel.svelte';

	let { layer }: { layer: Layer } = $props();

	interface StylePanelCtx {
		readonly openId: string | null;
		toggle(id: string): void;
	}
	const styleCtx = getContext<StylePanelCtx>('stylePanel');
	let styleOpen = $derived(styleCtx.openId === layer.id);

	let activeTab = $state<'style' | 'simplification'>('style');
	let editing = $state(false);

	let showSpinner = $state(false);
	let spinnerTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		if (layer.loading) {
			spinnerTimer = setTimeout(() => { showSpinner = true; }, 300);
		} else {
			if (spinnerTimer) { clearTimeout(spinnerTimer); spinnerTimer = null; }
			showSpinner = false;
		}
		return () => {
			if (spinnerTimer) { clearTimeout(spinnerTimer); spinnerTimer = null; }
		};
	});
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
		pushSnapshot();
	}

	function cancelEdit() {
		editing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') commitEdit();
		if (e.key === 'Escape') cancelEdit();
	}
</script>

<div class="layer-item-wrapper" class:open={styleOpen}>
	<div class="layer-item" class:selected={styleOpen}>
		{#if showSpinner}
			<div class="style-spinner" aria-label="Loading">
				<CircleNotch size={14} color="var(--color-text-tertiary)" />
			</div>
		{:else}
			<button
				class="style-swatch"
				style="
					--fill: {layer.style.fill === 'none' ? 'transparent' : layer.style.fill};
					--stroke: {layer.style.stroke};
				"
				onclick={() => styleCtx.toggle(layer.id)}
				onpointerdown={(e) => e.stopPropagation()}
				aria-label="Edit layer style"
			></button>
		{/if}

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
				title={layer.name}
				ondblclick={startEditing}
				onpointerdown={(e) => e.stopPropagation()}
			>{layer.name}</span>
		{/if}

		<div class="actions">
			<button
				class="icon-btn"
				class:active={styleOpen}
				aria-label="Edit layer style"
				onclick={() => styleCtx.toggle(layer.id)}
			>
				<SlidersHorizontal size={16} color="var(--color-icon-primary)" />
			</button>

			<button
				class="icon-btn"
				aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
				onclick={() => { toggleVisibility(layer.id); pushSnapshot(); }}
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
				onclick={() => { removeLayer(layer.id); pushSnapshot(); }}
			>
				<X size={16} color="var(--color-icon-secondary)" />
			</button>
		</div>
	</div>

	{#if styleOpen}
		<div class="style-accordion">
			<div class="tab-bar">
				<button
					class="tab-btn"
					class:active={activeTab === 'style'}
					onclick={() => activeTab = 'style'}
				>Style</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'simplification'}
					onclick={() => activeTab = 'simplification'}
				>Simplification</button>
			</div>
			{#key historyVersion()}
				{#if activeTab === 'style'}
					<LayerStylePanel {layer} onclose={() => { pushSnapshot(); styleCtx.toggle(layer.id); }} />
				{:else}
					<LayerProcessingPanel {layer} />
				{/if}
			{/key}
		</div>
	{/if}
</div>

<style>
	.layer-item-wrapper {
		border-radius: var(--radius);
		overflow: hidden;
		transition: box-shadow 150ms;
	}

	.layer-item-wrapper.open {
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
	}

	.style-accordion {
		padding: 0;
	}

	.tab-bar {
		display: flex;
		border-bottom: 1px solid var(--color-border);
	}

	.tab-btn {
		flex: 1;
		padding: var(--space-l) var(--space-m) var(--space-m);
		border: none;
		background: transparent;
		color: var(--color-text-tertiary);
		cursor: pointer;
		font-size: 14px;
		font-family: var(--font-mono);
		transition: color 150ms, background 150ms;
	}

	.tab-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-surface-secondary);
	}

	.tab-btn.active {
		color: var(--color-accent);
		border-bottom: 2px solid var(--color-accent);
		margin-bottom: -1px;
	}

	.layer-item {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		padding: 0 var(--space-l);
		height: 36px;
		cursor: grab;
	}

	.layer-item:active {
		cursor: grabbing;
	}

	.layer-item:hover {
		background-color: var(--color-surface-secondary);
	}

	.layer-item.selected {
		background-color: var(--color-accent-subtle);
		position: relative;
		z-index: 1;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
	}

	.style-swatch {
		position: relative;
		width: 14px;
		height: 14px;
		border-radius: 2px;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		/* Checkerboard shows through when fill is transparent */
		background-color: white;
		background-image:
			linear-gradient(45deg, #ccc 25%, transparent 25%),
			linear-gradient(-45deg, #ccc 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #ccc 75%),
			linear-gradient(-45deg, transparent 75%, #ccc 75%);
		background-size: 6px 6px;
		background-position: 0 0, 0 3px, 3px -3px, -3px 0px;
		outline: 1.5px solid var(--stroke, #161819);
		outline-offset: -1px;
	}

	.style-spinner {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.style-swatch::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 2px;
		background: var(--fill, transparent);
	}

	.name {
		flex: 1;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name.muted {
		color: var(--color-text-tertiary);
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
		display: none;
		align-items: center;
		gap: var(--space-xs);
		flex-shrink: 0;
	}

	.layer-item:hover .actions,
	.layer-item.selected .actions {
		display: flex;
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

	.icon-btn.active {
		color: var(--color-accent);
		background-color: var(--color-accent-subtle);
	}
</style>
