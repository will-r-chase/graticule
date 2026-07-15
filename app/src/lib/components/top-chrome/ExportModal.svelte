<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { exportPNG, exportSVG } from '$lib/utils/export';

	let { onclose }: { onclose: () => void } = $props();

	let format = $state<'svg' | 'png'>('svg');
	let clipToViewport = $state(true);
	// D11: curved labels serialize as exact rotated glyphs, as editable
	// text-on-path runs (Illustrator/Inkscape — Figma drops textPath), or as flat
	// editable text (any tool; curve discarded). PNG always rasterizes exact.
	let curvedText = $state<'glyphs' | 'textpath' | 'flat'>('glyphs');

	function handleExport() {
		if (format === 'svg') exportSVG(clipToViewport, curvedText);
		else exportPNG(clipToViewport);
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
		<label class="checkbox-row mono-small">
			<input type="checkbox" bind:checked={clipToViewport} />
			Clip to current viewport
		</label>
		{#if format === 'svg'}
			<div class="curved-group mono-small">
				<span class="group-label">Curved labels</span>
				<label class="radio-row">
					<input type="radio" name="curvedText" value="glyphs" bind:group={curvedText} />
					Exact (positioned letters)
				</label>
				<label class="radio-row">
					<input type="radio" name="curvedText" value="textpath" bind:group={curvedText} />
					Text on path (Illustrator, Inkscape)
				</label>
				<label class="radio-row">
					<input type="radio" name="curvedText" value="flat" bind:group={curvedText} />
					Flat text (Figma-safe, loses curve)
				</label>
			</div>
		{/if}
	{/snippet}

	{#snippet footer()}
		<Button onclick={onclose}>Cancel</Button>
		<Button variant="filled" onclick={handleExport}>Export</Button>
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

	.curved-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
		margin-top: var(--space-m);
	}

	.group-label {
		color: var(--color-text-secondary);
	}

	.radio-row input[type="radio"],
	.checkbox-row input[type="checkbox"] {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--color-border);
		background: transparent;
		cursor: pointer;
		flex-shrink: 0;
		margin: 0;
		transition: border-color 100ms;
	}

	.radio-row input[type="radio"] {
		border-radius: 50%;
	}

	.checkbox-row input[type="checkbox"] {
		border-radius: 2px;
	}

	.radio-row input[type="radio"]:not(:checked):hover {
		border-color: var(--color-accent);
	}

	.checkbox-row input[type="checkbox"]:not(:checked):hover {
		border-color: var(--color-accent);
	}

	.radio-row input[type="radio"]:checked {
		border-color: var(--color-accent);
		background: radial-gradient(circle, var(--color-accent) 38%, transparent 38%);
	}

	.checkbox-row input[type="checkbox"]:checked {
		border-color: var(--color-accent);
		background-color: var(--color-accent);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M1.5 5l2.5 2.5 4.5-4.5' stroke='%23ffffff' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-size: 10px;
		background-repeat: no-repeat;
		background-position: center;
	}


</style>
