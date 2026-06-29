<script lang="ts">
	import { Crosshair, Plus, Check, X, Circle, LineSegment, Polygon, Magnet } from 'phosphor-svelte';
	import { drawSession, setDrawTarget, setDrawType, lockedDrawType, startPicking, cancelPicking, commitDraw, discardDraw, toggleSnapping, type DrawType } from '$lib/stores/drawSession.svelte';
	import { layers } from '$lib/stores/layers.svelte';
	import { tooltip } from '$lib/actions/tooltip';

	const TYPES: { type: DrawType; label: string }[] = [
		{ type: 'polygon', label: 'Polygon' },
		{ type: 'line', label: 'Line' },
		{ type: 'point', label: 'Point' },
	];

	const targetName = $derived(
		drawSession.targetLayerId
			? layers.find((l) => l.id === drawSession.targetLayerId)?.name ?? null
			: null
	);

	const statusText = $derived(targetName ? `Drawing to ${targetName}` : 'Drawing to new layer');
	const hasDrawing = $derived(drawSession.committedCount > 0 || drawSession.activeCount > 0);
	// Once committed to a layer type (or a session is underway), the type can't be swapped.
	const locked = $derived(lockedDrawType());
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
		<div class="seg">
			{#each TYPES as { type, label }}
				<button
					class="seg-btn"
					class:active={drawSession.drawType === type}
					disabled={locked !== null && locked !== type}
					onclick={() => setDrawType(type)}
					aria-label="Draw {label.toLowerCase()}s"
					use:tooltip={{ text: label, placement: 'up' }}
				>
					{#if type === 'point'}<Circle size={15} weight="fill" />
					{:else if type === 'line'}<LineSegment size={16} />
					{:else}<Polygon size={16} />{/if}
				</button>
			{/each}
		</div>
		<div class="bar-divider"></div>
		<button
			class="bar-btn bar-btn--icon"
			class:active={drawSession.snapping}
			onclick={toggleSnapping}
			aria-label="Toggle snapping to existing vertices"
			use:tooltip={{ text: drawSession.snapping ? 'Snapping on' : 'Snap to vertices', placement: 'up' }}
		>
			<Magnet size={16} weight="regular" />
		</button>
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
		<div class="bar-divider"></div>
		<span class="status status--strong">{statusText}</span>
		{#if hasDrawing}
			<button
				class="bar-btn"
				onclick={() => commitDraw()}
				aria-label="Finish drawing"
				use:tooltip={{ text: 'Commit the drawn geometry', shortcut: 'Enter', placement: 'up' }}
			>
				<Check size={16} weight="regular" />
				<span>Done</span>
			</button>
			<button
				class="bar-btn"
				onclick={discardDraw}
				aria-label="Discard drawn geometry"
				use:tooltip={{ text: 'Discard the drawn geometry', shortcut: 'Esc', placement: 'up' }}
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

	.seg {
		display: flex;
		flex-direction: row;
		align-self: stretch;
	}

	.seg-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		border: none;
		background: transparent;
		color: var(--color-icon-primary);
		cursor: pointer;
		padding: 0;
	}

	.seg-btn:hover:not(.active):not(:disabled) {
		background: var(--color-surface-secondary);
	}

	.seg-btn.active {
		background: var(--color-accent);
		color: #ffffff;
	}

	.seg-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
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
		font-style: italic;
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

	.bar-btn--icon {
		padding: 0;
		width: 36px;
		justify-content: center;
	}

	.bar-btn.active {
		background: var(--color-accent);
		color: #ffffff;
	}

	.bar-btn.active :global(svg) {
		color: #ffffff;
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
