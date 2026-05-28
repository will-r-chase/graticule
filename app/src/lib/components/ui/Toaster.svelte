<script lang="ts">
	import { toasts } from '$lib/stores/toast.svelte';
</script>

{#each toasts as toast (toast.id)}
	<div class="toast mono-small">{toast.message}</div>
{/each}

<style>
	.toast {
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-s) var(--space-m);
		color: var(--color-text-primary);
		max-width: 260px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	}
</style>
