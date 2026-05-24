<header class="top-chrome">
	<span class="brand">Mappy</span>

	<div class="actions">
		<button>New</button>
		<button>Open</button>
		<button>Save</button>
		<button>Export</button>
	</div>
</header>

<style>
	.top-chrome {
		height: var(--space-xxl);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 var(--space-l);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-surface-primary);
	}

	.brand {
		font-family: var(--font-sans);
		font-size: 14px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-l);
	}

	button {
		height: 28px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		cursor: pointer;
	}

	button:hover {
		background-color: var(--color-surface-tertiary);
	}
</style>
