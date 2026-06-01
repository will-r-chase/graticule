<script lang="ts">
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';

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
		<Button onclick={oncancel}>Cancel</Button>
		<Button variant="filled" onclick={onconfirm}>{confirmLabel}</Button>
	{/snippet}
</Modal>

<style>
	.message {
		color: var(--color-text-secondary);
		margin: 0;
	}

</style>
