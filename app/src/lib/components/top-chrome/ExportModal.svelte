<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import { exportPNG, exportSVG } from '$lib/utils/export';

	let { onclose }: { onclose: () => void } = $props();

	let format = $state<'svg' | 'png'>('svg');
	let clipToViewport = $state(false);
	let includeBackground = $state(false);

	function handleExport() {
		if (format === 'svg') exportSVG(includeBackground);
		else exportPNG(clipToViewport, includeBackground);
		onclose();
	}
</script>

<Modal title="Export" {onclose} width="360px">
	{#snippet children()}
		<div class="format-options mono-small">
			<label class="radio-row">
				<input type="radio" name="format" value="svg" bind:group={format} />
				SVG
			</label>
			<label class="radio-row">
				<input type="radio" name="format" value="png" bind:group={format} />
				PNG
			</label>
		</div>
		{#if format === 'png'}
			<label class="checkbox-row mono-small">
				<input type="checkbox" bind:checked={clipToViewport} />
				Clip to current viewport
			</label>
		{/if}
		<label class="checkbox-row mono-small">
			<input type="checkbox" bind:checked={includeBackground} />
			Include background
		</label>
	{/snippet}

	{#snippet footer()}
		<button class="text-btn mono-regular" onclick={onclose}>Cancel</button>
		<button class="primary-btn mono-regular" onclick={handleExport}>Export</button>
	{/snippet}
</Modal>

<style>
	.format-options {
		display: flex;
		gap: var(--space-l);
	}

	.radio-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		color: var(--color-text-primary);
		cursor: pointer;
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

	.text-btn:hover { background: var(--color-surface-secondary); }

	.primary-btn {
		height: 32px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: none;
		background: var(--color-accent);
		color: white;
		cursor: pointer;
	}

	.primary-btn:hover { filter: brightness(1.1); }
</style>
