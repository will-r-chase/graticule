<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		top,
		left,
		alignRight = false,
		el = $bindable<HTMLDivElement | null>(null),
		children,
	}: {
		top: number;
		left: number;
		alignRight?: boolean;
		el?: HTMLDivElement | null;
		children: Snippet;
	} = $props();
</script>

<div
	class="dropdown-menu"
	class:align-right={alignRight}
	style="top: {top}px; left: {left}px"
	bind:this={el}
>
	{@render children()}
</div>

<style>
	.dropdown-menu {
		position: fixed;
		z-index: 50;
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		padding: var(--space-s);
	}

	.align-right {
		transform: translateX(-100%);
	}

	/* ── Shared item styles used by all dropdown consumers ── */

	:global(.dropdown-item) {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		width: 100%;
		padding: var(--space-s) var(--space-m);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		cursor: pointer;
		text-align: left;
		white-space: nowrap;
		border-radius: var(--radius);
	}

	:global(.dropdown-item:hover) {
		background: var(--color-surface-secondary);
	}

	:global(.dropdown-item.selected) {
		color: var(--color-accent);
	}

	:global(.dropdown-item.selected path) {
		fill: var(--color-accent);
	}

	:global(.dropdown-item.danger) {
		color: var(--color-error);
	}

	:global(.dropdown-divider) {
		height: 1px;
		background: var(--color-border);
		margin: var(--space-xs) 0;
	}
</style>
