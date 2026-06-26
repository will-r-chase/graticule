<script lang="ts">
	import { Crosshair, Plus, Check, X } from 'phosphor-svelte';
	import { drawSession, setDrawTarget, startPicking, cancelPicking, commitDraw, cancelDraw } from '$lib/stores/drawSession.svelte';
	import { layers } from '$lib/stores/layers.svelte';
	import { tooltip } from '$lib/actions/tooltip';

	const targetName = $derived(
		drawSession.targetLayerId
			? layers.find((l) => l.id === drawSession.targetLayerId)?.name ?? null
			: null
	);

	const statusText = $derived(targetName ? `Drawing to ${targetName}` : 'Drawing to new layer');
	const hasPoints = $derived(drawSession.count > 0);
</script>

<div class="draw-bar">
	{#if drawSession.picking}
		<span class="status">Select a layer from the layers panel</span>
		<div class="bar-divider"></div>
		<button
			class="bar-btn"
			onclick={cancelPicking}
			aria-label="Cancel picking a layer"
			use:tooltip={{ text: 'Cancel', shortcut: 'Esc', placement: 'up' }}
		>
			<X size={14} weight="regular" />
			<span>Cancel</span>
		</button>
	{:else}
		<span class="status status--strong">{statusText}</span>
		<div class="bar-divider"></div>
		<button
			class="bar-btn"
			onclick={startPicking}
			aria-label="Draw to existing layer"
			use:tooltip={{ text: 'Pick a layer to draw into', placement: 'up' }}
		>
			<Crosshair size={16} weight="regular" />
			<span>Target layer</span>
		</button>
		{#if drawSession.targetLayerId !== null}
			<button
				class="bar-btn"
				onclick={() => setDrawTarget(null)}
				aria-label="Draw to a new layer"
				use:tooltip={{ text: 'Start a new layer', placement: 'up' }}
			>
				<Plus size={16} weight="regular" />
				<span>New layer</span>
			</button>
		{/if}
		{#if hasPoints}
			<div class="bar-divider"></div>
			<button
				class="bar-btn"
				onclick={commitDraw}
				aria-label="Finish drawing"
				use:tooltip={{ text: 'Commit the drawn points', shortcut: 'Enter', placement: 'up' }}
			>
				<Check size={16} weight="regular" />
				<span>Done</span>
			</button>
			<button
				class="bar-btn"
				onclick={cancelDraw}
				aria-label="Discard drawn points"
				use:tooltip={{ text: 'Discard the drawn points', shortcut: 'Esc', placement: 'up' }}
			>
				<X size={14} weight="regular" />
				<span>Cancel</span>
			</button>
		{/if}
	{/if}
</div>

<style>
	.draw-bar {
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

	.status {
		padding: 0 12px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 18px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	.status--strong {
		font-weight: 700;
		color: var(--color-text-primary);
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

	.bar-btn:hover {
		background: var(--color-surface-secondary);
	}

	.bar-btn[aria-disabled='true'] {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.bar-btn[aria-disabled='true']:hover {
		background: transparent;
	}

	.bar-divider {
		width: 1px;
		align-self: stretch;
		background: var(--color-border);
		flex-shrink: 0;
	}
</style>
