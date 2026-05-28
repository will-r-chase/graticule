<script lang="ts">
	import { MagnifyingGlass, CaretDown, Plus } from 'phosphor-svelte';
	import type { Dataset } from '$lib/types';
	import { TYPE_FILTERS, REGION_FILTERS, SOURCE_ORDER, SOURCE_CONFIG } from '$lib/config';
	import DatasetItem from './DatasetItem.svelte';
	import { uploadedDatasets } from '$lib/stores/uploadedDatasets.svelte';
	import { layers, addUploadedLayer } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';

	let { datasets, onOpenUpload }: { datasets: Dataset[]; onOpenUpload: () => void } = $props();

	let filtersOpen = $state(false);
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

	let collapsedSections = $state(new Set<string>());

	function toggleSection(source: string) {
		const next = new Set(collapsedSections);
		if (next.has(source)) next.delete(source);
		else next.add(source);
		collapsedSections = next;
	}
</script>

<div class="catalog-panel">
	<div class="panel-header">
		<h3>Data</h3>
		<div class="header-actions">
			<button class="filter-toggle mono-small" class:active={filtersOpen} onclick={() => filtersOpen = !filtersOpen}>
				Filter
			</button>
			<button class="icon-btn" onclick={onOpenUpload} aria-label="Upload data">
				<Plus size={14} weight="bold" />
			</button>
		</div>
	</div>

	{#if filtersOpen}
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
	{/if}

	<div class="dataset-list">
		{#if uploadedDatasets.length > 0}
			<div class="source-section" class:collapsed={collapsedSections.has('__uploaded')}>
				<button class="source-heading h4" onclick={() => toggleSection('__uploaded')}>
					<span class="caret" class:collapsed={collapsedSections.has('__uploaded')}>
						<CaretDown size={8} weight="bold" />
					</span>
					Uploaded
					{#if collapsedSections.has('__uploaded')}
						<span class="dataset-count">({uploadedDatasets.length})</span>
					{/if}
				</button>
				{#if !collapsedSections.has('__uploaded')}
					<ul>
						{#each uploadedDatasets as dataset}
							{@const added = layers.some(l => l.datasetId === dataset.id)}
							<li
								class="dataset-item"
								onclick={() => { pushSnapshot(); addUploadedLayer(dataset.name, dataset.topology, dataset.id); pushSnapshot(); }}
							>
								<span class="name">{dataset.name}</span>
								{#if added}
									<span class="dot" aria-label="Added to map"></span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#each grouped as group}
			<div class="source-section" class:collapsed={collapsedSections.has(group.source)}>
				<button
					class="source-heading h4"
					onclick={() => toggleSection(group.source)}
				>
					<span class="caret" class:collapsed={collapsedSections.has(group.source)}>
						<CaretDown size={8} weight="bold" />
					</span>
					{group.label}
					{#if collapsedSections.has(group.source)}
						<span class="dataset-count">({group.datasets.length})</span>
					{/if}
				</button>
				{#if !collapsedSections.has(group.source)}
					<ul>
						{#each group.datasets as dataset}
							<DatasetItem {dataset} />
						{/each}
					</ul>
				{/if}
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
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		border-radius: var(--radius);
		cursor: pointer;
		padding: 0;
		color: var(--color-icon-primary);
	}

	.icon-btn:hover {
		background: var(--color-surface-tertiary);
		color: var(--color-icon-primary);
	}

	.filter-toggle {
		height: 28px;
		padding: 0 var(--space-m);
		border-radius: var(--radius);
		border: none;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		cursor: pointer;
	}

	.filter-toggle:hover {
		background-color: var(--color-surface-tertiary);
	}

	.filter-toggle.active {
		background-color: var(--color-accent-subtle);
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
		color: var(--color-text-tertiary);
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
		color: var(--color-text-primary);
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

	.source-section.collapsed {
		margin-bottom: var(--space-xs);
	}

	.source-heading {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-s);
		width: 100%;
		padding: var(--space-s) var(--space-l);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.caret {
		position: absolute;
		left: calc(var(--space-l) - 14px);
		display: flex;
		color: var(--color-icon-secondary);
		opacity: 0;
		transition: opacity 150ms, transform 150ms;
	}

	.source-heading:hover .caret {
		opacity: 1;
	}

	.caret.collapsed {
		transform: rotate(-90deg);
	}

	.dataset-count {
		color: var(--color-text-tertiary);
		font-size: 11px;
	}

	ul {
		list-style: none;
		padding: 0;
	}

	.dataset-item {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: var(--space-s) var(--space-l) var(--space-s) calc(var(--space-l) + 4px);
		cursor: pointer;
		list-style: none;
	}

	.dataset-item:hover {
		background-color: var(--color-surface-secondary);
	}

	.dataset-item .name {
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 0 1 auto;
		min-width: 0;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--pear-500);
		flex-shrink: 0;
	}
</style>
