<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'ghost',
		size = 'md',
		active = false,
		disabled = false,
		type = 'button',
		onclick,
		children,
	}: {
		variant?: 'ghost' | 'outline' | 'filled';
		size?: 'sm' | 'md';
		active?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

<button
	class="btn"
	class:sm={size === 'sm'}
	class:ghost={variant === 'ghost'}
	class:outline={variant === 'outline'}
	class:filled={variant === 'filled'}
	class:active
	{type}
	{disabled}
	{onclick}
>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-s);
		height: 32px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		font-family: var(--font-mono);
		font-size: 14px;
		line-height: 20px;
		font-weight: 400;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* Size modifier — sm (28px) for toolbars and panel headers */
	.btn.sm { height: 28px; }

	/* ── Ghost ── transparent, no border */
	.ghost {
		border: none;
		background: transparent;
		color: var(--color-text-primary);
	}

	.ghost:hover:not(:disabled) {
		background: var(--color-surface-secondary);
	}

	.ghost.active {
		background: var(--color-accent-subtle);
	}

	.ghost:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* ── Outline ── border, surface background */
	.outline {
		border: 1px solid var(--color-border);
		background: var(--color-surface-primary);
		color: var(--color-text-primary);
	}

	.outline:hover:not(:disabled) {
		background: var(--color-surface-secondary);
		border-color: var(--color-text-primary);
	}

	.outline:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── Filled ── accent background, inverted text */
	.filled {
		border: none;
		background: var(--color-accent);
		color: var(--color-text-invert);
	}

	.filled:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.filled:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
