<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'phosphor-svelte';

	let { title, onclose, width = '480px', children, footer }: {
		title: string;
		onclose: () => void;
		width?: string;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}
</script>

<div class="backdrop" onclick={handleBackdropClick} role="presentation">
	<div class="modal" style="width: {width}" role="dialog" aria-modal="true" aria-labelledby="modal-title">

		<div class="modal-header">
			<span class="h3" id="modal-title">{title}</span>
			<button class="icon-btn" onclick={onclose} aria-label="Close">
				<X size={14} />
			</button>
		</div>

		<div class="modal-body">
			{@render children()}
		</div>

		{#if footer}
			<div class="modal-footer">
				{@render footer()}
			</div>
		{/if}

	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
		max-height: 80vh;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-l);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.modal-body {
		padding: var(--space-l);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
		overflow-y: auto;
	}

	.modal-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-l);
		padding: var(--space-m) var(--space-l);
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		color: var(--color-icon-secondary);
	}

	.icon-btn:hover {
		background: var(--color-surface-tertiary);
		color: var(--color-icon-primary);
	}
</style>
