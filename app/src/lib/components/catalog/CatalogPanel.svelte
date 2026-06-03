<script lang="ts">
	import { MagnifyingGlass, CaretDown } from 'phosphor-svelte';
	import type { Dataset } from '$lib/types';
	import { TYPE_FILTERS, REGION_FILTERS, SOURCE_ORDER, SOURCE_CONFIG, PROJECTIONS } from '$lib/config';
	import DatasetItem from './DatasetItem.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import { projection as projectionStore } from '$lib/stores/projection.svelte';
	import { mapView } from '$lib/stores/mapView.svelte';
	import { uploadedDatasets } from '$lib/stores/uploadedDatasets.svelte';
	import { layers, addUploadedLayer } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import type { ProjectionProperty } from '$lib/config';
	import Minimap from './Minimap.svelte';
	import StylePanel from './StylePanel.svelte';

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
	let detailsOpen = $state(false);

	function toggleSection(source: string) {
		const next = new Set(collapsedSections);
		if (next.has(source)) next.delete(source);
		else next.add(source);
		collapsedSections = next;
	}

	// Projection details — derived from the active projection entry + live mapView store.
	const projectionEntry = $derived(PROJECTIONS.find(p => p.id === projectionStore.id) ?? PROJECTIONS[0]);

	const PROPERTY_LABELS: Record<ProjectionProperty, string> = {
		'equal-area':  'Equal Area',
		'conformal':   'Conformal',
		'compromise':  'Compromise',
		'perspective': 'Perspective',
		'equidistant': 'Equidistant',
	};

	// Geographic center: for rotate-mode projections use the rotation store directly
	// (inversion is reliable at the screen center, but this is simpler and always accurate).
	// For pan-mode projections use mapView.center which is computed by inverting the canvas center.
	const projCenter = $derived.by((): [number, number] | null => {
		if (projectionEntry.interactionMode === 'rotate') {
			const [λ, φ] = projectionStore.rotate;
			return [-λ, -φ];
		}
		return mapView.center;
	});

	function fmtCoord(v: number, posLabel: string, negLabel: string): string {
		return `${Math.abs(v).toFixed(1)}° ${v >= 0 ? posLabel : negLabel}`;
	}
</script>

<div class="catalog-panel">
	<div class="panel-header">
		<h3>Data</h3>
		<div class="header-actions">
			<Button size="sm" active={filtersOpen} onclick={() => filtersOpen = !filtersOpen}>Filter</Button>
			<Button size="sm" onclick={onOpenUpload}>Upload</Button>
		</div>
	</div>

	{#if filtersOpen}
	<div class="search-bar">
		<div class="search-input-wrapper">
			<MagnifyingGlass size={16} color="var(--color-icon-secondary)" />
			<input
				class="mono-regular"
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
						class="chip mono-small"
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
						class="chip mono-small"
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

	<div class="canvas-section">
		<h3>Canvas</h3>

		<span class="section-label h4">Projection</span>
		<Combobox options={PROJECTIONS} bind:value={projectionStore.id} placeholder="Search projections…" direction="up" />

		<!-- Details: collapsible projection metadata -->
		<button class="sub-heading h4" onclick={() => (detailsOpen = !detailsOpen)}>
			<span class="sub-caret" class:open={detailsOpen}><CaretDown size={8} weight="bold" /></span>
			Details
		</button>
		{#if detailsOpen}
			<div class="proj-details">
				<div class="proj-detail-row">
					<span class="detail-label mono-small">Property</span>
					<span class="detail-value mono-small">{PROPERTY_LABELS[projectionEntry.property]}</span>
				</div>

				{#if projectionEntry.parallels}
					<div class="proj-detail-row">
						<span class="detail-label mono-small">Parallels</span>
						<span class="detail-value mono-small">{projectionEntry.parallels[0]}° / {projectionEntry.parallels[1]}°</span>
					</div>
				{/if}

				<div class="proj-detail-row">
					<span class="detail-label mono-small">Center</span>
					<span class="detail-value mono-small">
						{#if projCenter}
							{fmtCoord(projCenter[0], 'E', 'W')}, {fmtCoord(projCenter[1], 'N', 'S')}
						{:else}
							—
						{/if}
					</span>
				</div>

				<div class="proj-detail-row">
					<span class="detail-label mono-small">Extent</span>
					<span class="detail-value mono-small">
						{#if mapView.extent}
							W {mapView.extent[0].toFixed(1)}°&ensp;E {mapView.extent[2].toFixed(1)}°<br>
							S {mapView.extent[1].toFixed(1)}°&ensp;N {mapView.extent[3].toFixed(1)}°
						{:else}
							—
						{/if}
					</span>
				</div>

				<div class="proj-detail-row">
					<span class="detail-label mono-small">Datum</span>
					<span class="detail-value mono-small">WGS84 / EPSG:4326</span>
				</div>
			</div>
		{/if}

		<StylePanel />

		<Minimap />
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
		background-color: var(--color-accent);
		flex-shrink: 0;
	}

	/* --- Canvas section --- */

	.canvas-section {
		flex-shrink: 0;
		border-top: 1px solid var(--color-border);
		padding: var(--space-m) var(--space-l) var(--space-l);
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
	}

	.section-label {
		color: var(--color-text-secondary);
	}

	/* Details collapsible heading */
	.sub-heading {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-s);
		background: none;
		border: none;
		margin-left: calc(-1 * var(--space-l));
		width: calc(100% + 2 * var(--space-l));
		padding: var(--space-s) var(--space-l);
		cursor: pointer;
		text-align: left;
		color: var(--color-text-secondary);
	}

	.sub-caret {
		position: absolute;
		left: calc(var(--space-l) - 14px);
		display: flex;
		color: var(--color-icon-secondary);
		opacity: 0;
		transition: opacity 150ms, transform 150ms;
		transform: rotate(-90deg);
	}

	.sub-heading:hover .sub-caret {
		opacity: 1;
	}

	.sub-caret.open {
		transform: rotate(0deg);
	}

	/* --- Projection details --- */

	.proj-details {
		display: flex;
		flex-direction: column;
		gap: var(--space-s);
		padding-top: var(--space-s);
		padding-left: var(--space-m);
	}

	.proj-detail-row {
		display: flex;
		align-items: baseline;
		gap: var(--space-s);
	}

	.detail-label {
		color: var(--color-text-tertiary);
		flex-shrink: 0;
		width: 56px;
	}

	.detail-value {
		color: var(--color-text-secondary);
	}

</style>
