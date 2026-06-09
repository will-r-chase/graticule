<script lang="ts">
	import { Check, Minus } from 'phosphor-svelte';

	let {
		checked = false,
		indeterminate = false,
		onchange,
		'aria-label': ariaLabel = '',
	}: {
		checked?: boolean;
		indeterminate?: boolean;
		onchange?: () => void;
		'aria-label'?: string;
	} = $props();
</script>

<label class="checkbox-wrap" aria-label={ariaLabel}>
	<input
		type="checkbox"
		class="checkbox-native"
		checked={checked}
		onchange={onchange}
	/>
	<div class="checkbox-visual" class:checked class:indeterminate>
		{#if checked}
			<Check size={9} weight="bold" />
		{:else if indeterminate}
			<Minus size={9} weight="bold" />
		{/if}
	</div>
</label>

<style>
	.checkbox-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		margin-top: 4px;
	}

	/* Visually hidden but still in the accessibility tree */
	.checkbox-native {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
		margin: 0;
		pointer-events: none;
	}

	.checkbox-visual {
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--color-border);
		border-radius: 3px;
		background: var(--color-surface-primary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-invert);
		transition: background 80ms ease, border-color 80ms ease;
		flex-shrink: 0;
	}

	.checkbox-wrap:hover .checkbox-visual:not(.checked):not(.indeterminate) {
		border-color: var(--color-text-tertiary);
	}

	.checkbox-visual.checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.checkbox-visual.indeterminate {
		background: var(--color-surface-secondary);
		border-color: var(--color-text-tertiary);
		color: var(--color-text-secondary);
	}
</style>
