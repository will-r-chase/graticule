<script lang="ts">
	import Modal from './Modal.svelte';

	let { title, message, confirmLabel = 'Confirm', onconfirm, oncancel }: {
		title: string;
		message: string;
		confirmLabel?: string;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<Modal {title} onclose={oncancel}>
	{#snippet children()}
		<p class="body-regular message">{message}</p>
	{/snippet}

	{#snippet footer()}
		<button class="text-btn mono-small" onclick={oncancel}>Cancel</button>
		<button class="primary-btn mono-small" onclick={onconfirm}>{confirmLabel}</button>
	{/snippet}
</Modal>

<style>
	.message {
		color: var(--color-text-secondary);
		margin: 0;
	}

	.text-btn {
		height: 32px;
		padding: 0 var(--space-m);
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		border-radius: var(--radius);
	}

	.text-btn:hover {
		background: var(--color-surface-secondary);
	}

	.primary-btn {
		height: 32px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: none;
		background: var(--color-accent);
		color: var(--color-text-invert);
		cursor: pointer;
	}

	.primary-btn:hover {
		filter: brightness(1.1);
	}
</style>
