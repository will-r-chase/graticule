<script lang="ts">
	import type { Dataset } from '$lib/types';
	import { SOURCE_CONFIG, ADMIN_LEVEL_LABELS } from '$lib/config';

	let { dataset, x, y }: { dataset: Dataset; x: number; y: number } = $props();

	const source = SOURCE_CONFIG[dataset.source] ?? SOURCE_CONFIG['custom'];
	const adminLabel = ADMIN_LEVEL_LABELS[dataset.adminLevel] ?? `Level ${dataset.adminLevel}`;
	const bbox = dataset.bbox.map((n) => n.toFixed(1)).join(', ');

	const OFFSET = 12;
	const WIDTH = 240;

	let tooltipEl = $state<HTMLDivElement | null>(null);
	let posStyle = $state(`left: ${x + OFFSET}px; top: ${y + OFFSET}px`);

	$effect(() => {
		if (!tooltipEl) return;
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		const h = tooltipEl.offsetHeight;

		const flipY = y + h + OFFSET > vh;
		const flipX = x + WIDTH + OFFSET > vw;

		const top  = flipY ? y - h + 12 : y + OFFSET;
		const left = flipX ? x - WIDTH - OFFSET : x + OFFSET;

		posStyle = `left: ${left}px; top: ${top}px`;
	});
</script>

<div class="tooltip" bind:this={tooltipEl} style={posStyle}>
	<p class="description body-small">{dataset.description}</p>

	{#if dataset.coverage}
		<p class="coverage body-small">{dataset.coverage}</p>
	{/if}

	<div class="fields">
		<div class="field">
			<span class="label">Source</span>
			<span class="value mono-small">{source.label}</span>
		</div>
		{#if dataset.geometryType}
			<div class="field">
				<span class="label">Geometry</span>
				<span class="value mono-small">{dataset.geometryType}</span>
			</div>
		{/if}
		<div class="field">
			<span class="label">Region</span>
			<span class="value mono-small">{dataset.region}</span>
		</div>
		{#if !dataset.coverage}
			<div class="field">
				<span class="label">Admin level</span>
				<span class="value mono-small">{adminLabel}</span>
			</div>
		{/if}
		<div class="field">
			<span class="label">Features</span>
			<span class="value mono-small">{dataset.featureCount.toLocaleString()}</span>
		</div>
		<div class="field">
			<span class="label">Bbox</span>
			<span class="value mono-small">{bbox}</span>
		</div>
	</div>
</div>

<style>
	.tooltip {
		position: fixed;
		z-index: 50;
		width: 240px;
		background-color: var(--color-surface-invert);
		border-radius: var(--radius);
		padding: var(--space-m);
		pointer-events: none;
	}

	.description {
		color: var(--color-text-invert);
		margin-bottom: var(--space-s);
	}

	.coverage {
		color: var(--grey-300);
		margin-bottom: var(--space-m);
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.field {
		display: flex;
		justify-content: space-between;
		gap: var(--space-m);
	}

	.label {
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--grey-300);
		white-space: nowrap;
	}

	.value {
		color: var(--color-text-invert);
		text-align: right;
	}
</style>
