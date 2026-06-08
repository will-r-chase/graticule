<script lang="ts">
	import { Hand, Cursor } from 'phosphor-svelte';
	import { toolState } from '$lib/stores/tool.svelte';
</script>

<div class="toolbar">
	<button
		class="tool-btn"
		class:active={toolState.active === 'pan'}
		aria-label="Pan tool"
		onclick={() => toolState.active = 'pan'}
	>
		<Hand size={24} />
	</button>
	<button
		class="tool-btn"
		class:active={toolState.active === 'select'}
		aria-label="Select tool"
		onclick={() => toolState.active = 'select'}
	>
		<Cursor size={24} />
	</button>
</div>

<style>
	.toolbar {
		display: flex;
		flex-direction: row;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface-primary);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
		overflow: hidden;
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--color-icon-primary);
		cursor: pointer;
		padding: 0;
	}

	.tool-btn:hover:not(.active) {
		background: var(--color-surface-secondary);
	}

	.tool-btn.active {
		background: var(--color-accent);
		color: #ffffff;
	}
</style>
