<script lang="ts">
	import { fade } from 'svelte/transition';
	import { toasts, dismissToast } from '$lib/stores/toast.svelte';
	import { WarningCircle } from 'phosphor-svelte';
</script>

{#each toasts as toast (toast.id)}
	<div class="toast body-small" class:toast--error={toast.variant === 'error'} transition:fade={{ duration: 200 }}>
		{#if toast.variant === 'error'}
			<WarningCircle size={16} class="toast-icon" weight="fill" />
		{/if}
		<span class="toast-message">{toast.message}</span>
		<button class="toast-dismiss" onclick={() => dismissToast(toast.id)} aria-label="Dismiss">✕</button>
	</div>
{/each}

<style>
	.toast {
		background: var(--color-surface-invert);
		border-radius: var(--radius);
		border: 1px solid transparent;
		padding: var(--space-l);
		color: var(--color-text-invert);
		max-width: 260px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		display: flex;
		align-items: flex-start;
		gap: var(--space-m);
	}

	.toast--error {
		border-color: var(--color-error);
	}

	:global(.toast-icon) {
		flex-shrink: 0;
		color: var(--color-error);
		margin-top: 1px;
	}

	.toast-message {
		flex: 1;
	}

	.toast-dismiss {
		background: none;
		border: none;
		color: var(--color-text-invert);
		cursor: pointer;
		padding: 0;
		line-height: 1;
		opacity: 0.6;
		flex-shrink: 0;
		font-size: 12px;
	}

	.toast-dismiss:hover {
		opacity: 1;
	}
</style>
