<script lang="ts">
	import { MagnifyingGlass } from 'phosphor-svelte';
	import type { Dataset } from '$lib/types';
	import { TYPE_FILTERS, REGION_FILTERS, SOURCE_ORDER, SOURCE_CONFIG } from '$lib/config';
	import DatasetItem from './DatasetItem.svelte';

	let { datasets }: { datasets: Dataset[] } = $props();

	let search = $state('');
	let activeType = $state<string | null>(null);
	let activeRegion = $state<string | null>(null);

	function getType(dataset: Dataset): string | null {
		for (const filter of TYPE_FILTERS) {
			if (dataset.tags.some((tag) => filter.tags.includes(tag))) {
				return filter.label;
			}
		}
		return null;
	}

	let filtered = $derived(
		datasets.filter((d) => {
			const matchesSearch = d.name.toLowerCase().includes(search.toLowerCase());
			const matchesType = activeType === null || getType(d) === activeType;
			const matchesRegion = activeRegion === null || d.region.toLowerCase() === activeRegion.toLowerCase();
			return matchesSearch && matchesType && matchesRegion;
		})
	);

	// Group filtered datasets by source, maintaining SOURCE_ORDER.
	// Only includes sources that have at least one result.
	let grouped = $derived(
		SOURCE_ORDER
			.map((source) => ({
				source,
				label: SOURCE_CONFIG[source]?.label ?? source,
				datasets: filtered.filter((d) => d.source === source),
			}))
			.filter((g) => g.datasets.length > 0)
	);

	function toggleType(label: string) {
		activeType = activeType === label ? null : label;
	}

	function toggleRegion(label: string) {
		activeRegion = activeRegion === label ? null : label;
	}
</script>

<div class="catalog-panel">
	<div class="panel-header">
		<h3>Data</h3>
	</div>

	<div class="search-bar">
		<div class="search-input-wrapper">
			<MagnifyingGlass size={16} color="var(--color-icon-secondary)" />
			<input
				type="text"
				placeholder="Search datasets..."
				bind:value={search}
			/>
		</div>
	</div>

	<div class="filters">
		<div class="filter-group">
			<span class="filter-label h4">Type</span>
			<div class="chips">
				{#each TYPE_FILTERS as filter}
					<button
						class="chip"
						class:active={activeType === filter.label}
						onclick={() => toggleType(filter.label)}
					>
						{filter.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="filter-group">
			<span class="filter-label h4">Region</span>
			<div class="chips">
				{#each REGION_FILTERS as region}
					<button
						class="chip"
						class:active={activeRegion === region}
						onclick={() => toggleRegion(region)}
					>
						{region}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<div class="dataset-list">
		{#each grouped as group}
			<div class="source-section">
				<span class="source-heading h4">{group.label}</span>
				<ul>
					{#each group.datasets as dataset}
						<DatasetItem {dataset} />
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</div>

<style>
	.catalog-panel {
		width: 280px;
		height: 100%;
		background-color: var(--color-surface-primary);
		border-right: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* --- Header --- */

	.panel-header {
		padding: var(--space-l) var(--space-l) var(--space-s);
		flex-shrink: 0;
	}

	/* --- Search --- */

	.search-bar {
		padding: var(--space-s) var(--space-l);
		flex-shrink: 0;
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 32px;
		padding: 0 var(--space-m);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.search-input-wrapper input {
		flex: 1;
		border: none;
		outline: none;
		background: transparent;
		font-family: var(--font-mono);
		color: var(--color-text-primary);
	}

	.search-input-wrapper input::placeholder {
		color: var(--color-text-secondary);
	}

	.search-input-wrapper:focus-within {
		border-color: var(--color-accent);
	}

	/* --- Filters --- */

	.filters {
		padding: var(--space-l) var(--space-l) var(--space-l);
		display: flex;
		flex-direction: column;
		gap: var(--space-l);
		flex-shrink: 0;
		border-bottom: 1px solid var(--color-border);
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.chip {
		height: 24px;
		padding: 0 var(--space-s);
		border-radius: var(--radius);
		border: 1px solid var(--color-border);
		background: transparent;
		font-family: var(--font-mono);
		font-size: 12px; /* mono-small */
		color: var(--color-text-secondary);
		cursor: pointer;
		white-space: nowrap;
	}

	.chip:hover {
		border-color: var(--color-text-primary);
		color: var(--color-text-primary);
	}

	.chip.active {
		background-color: var(--color-text-primary);
		border-color: var(--color-text-primary);
		color: var(--color-text-invert);
	}

	/* --- Dataset list --- */

	.dataset-list {
		overflow-y: auto;
		flex: 1;
		padding: var(--space-l) 0;
	}

	.source-section {
		margin-bottom: var(--space-xl);
	}

	.source-heading {
		display: block;
		padding: var(--space-s) var(--space-l);
	}

	ul {
		list-style: none;
		padding: 0;
	}
</style>
