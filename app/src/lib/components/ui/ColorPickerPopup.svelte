<script lang="ts">
	import { X } from 'phosphor-svelte';
	import ColorPicker from './ColorPicker.svelte';

	let {
		hex = $bindable('#ffffff'),
		alpha = $bindable(1),
		title,
		onclose,
	}: {
		hex: string;
		alpha: number;
		title: string;
		onclose: () => void;
	} = $props();
</script>

<div class="popup">
	<div class="titlebar">
		<span class="body-regular">{title}</span>
		<button class="icon-btn" onclick={onclose} aria-label="Close color picker">
			<X size={12} />
		</button>
	</div>
	<ColorPicker bind:hex bind:alpha />
</div>

<style>
	.popup {
		width: 236px;
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		padding: var(--space-m);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	/* Strip ColorPicker's own card styling — the popup IS the card */
	.popup :global(.color-picker) {
		width: auto;
		border: none;
		box-shadow: none;
		padding: 0;
		border-radius: 0;
		background: transparent;
	}

	.titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		color: var(--color-icon-secondary);
	}

	.icon-btn:hover {
		background: var(--color-surface-secondary);
		color: var(--color-icon-primary);
	}
</style>
