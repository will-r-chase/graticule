<script lang="ts">
	import { MagnifyingGlass, CaretDown, X } from 'phosphor-svelte';
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

	let datasetListEl = $state<HTMLDivElement | null>(null);
	let hasBottomScroll = $state(false);

	$effect(() => {
		const el = datasetListEl;
		if (!el) return;
		function update() {
			hasBottomScroll = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
		}
		update();
		el.addEventListener('scroll', update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(el);
		const mo = new MutationObserver(update);
		mo.observe(el, { childList: true, subtree: true });
		return () => {
			el.removeEventListener('scroll', update);
			ro.disconnect();
			mo.disconnect();
		};
	});

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

	// Floating filter panel
	let catalogPanelEl   = $state<HTMLDivElement | null>(null);
	let floatingFilterEl = $state<HTMLDivElement | null>(null);
	let filterBtnEl      = $state<HTMLDivElement | null>(null);
	let filterPos = $state({ left: 0, top: 0 });

	// Position the floating filter panel to the right of the catalog panel,
	// vertically aligned with the Filter button.
	$effect(() => {
		if (!filtersOpen || !catalogPanelEl || !filterBtnEl) return;
		const panelRect = catalogPanelEl.getBoundingClientRect();
		const btnRect   = filterBtnEl.getBoundingClientRect();
		filterPos = { left: panelRect.right + 8, top: btnRect.top };
	});

	// Close only when clicking outside both the floating panel and the catalog panel.
	// Clicks within the catalog (e.g. adding a dataset) should not dismiss the filter.
	$effect(() => {
		if (!filtersOpen) return;
		function onPointerDown(e: PointerEvent) {
			if (floatingFilterEl?.contains(e.target as Node)) return;
			if (catalogPanelEl?.contains(e.target as Node)) return;
			filtersOpen = false;
		}
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

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

<div class="catalog-panel" bind:this={catalogPanelEl}>
	<div class="panel-header">
		<h3>Data</h3>
		<div class="header-actions">
			<!-- Wrapper stops the document pointerdown listener from firing when the
			     Filter button is clicked while the panel is already open, which would
			     cause the document listener to close it and then onclick re-open it. -->
			<div bind:this={filterBtnEl} onpointerdown={(e) => { if (filtersOpen) e.stopPropagation(); }}>
				<Button size="sm" active={filtersOpen} onclick={() => filtersOpen = !filtersOpen}>Filter</Button>
			</div>
			<Button size="sm" onclick={onOpenUpload}>Upload</Button>
		</div>
	</div>

	<div class="dataset-list-wrapper">
	<div class="dataset-list" bind:this={datasetListEl}>
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
	{#if hasBottomScroll}
		<div class="scroll-fade-bottom" aria-hidden="true"></div>
	{/if}
	</div>

	<div class="canvas-section">
		<h3>Canvas</h3>

		<div class="proj-field">
			<span class="section-label h4">Projection</span>
			<Combobox options={PROJECTIONS} bind:value={projectionStore.id} placeholder="Search projections…" direction="up" />
		</div>

		<StylePanel />

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

		<Minimap />
	</div>

	<div class="attribution mono-small">
		Made with 💚 by <a href="https://www.williamrchase.com/" target="_blank" rel="noopener noreferrer">Will Chase</a>
	</div>
</div>

<!-- Floating search + filter panel — position: fixed so it escapes the catalog panel -->
{#if filtersOpen}
	<div
		class="floating-filters"
		bind:this={floatingFilterEl}
		style="left: {filterPos.left}px; top: {filterPos.top}px"
	>
		<div class="filter-header">
			<span class="body-regular">Search and Filter</span>
			<button class="close-btn" onclick={() => filtersOpen = false} aria-label="Close filter panel">
				<X size={14} />
			</button>
		</div>

		<div class="filter-search">
			<div class="search-input-wrapper">
				<MagnifyingGlass size={16} color="var(--color-icon-secondary)" />
				<input
					class="mono-regular"
					type="text"
					placeholder="Search datasets..."
					bind:value={search}
				/>
				{#if search}
					<button class="search-clear" onclick={() => search = ''} aria-label="Clear search">
						<X size={12} />
					</button>
				{/if}
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
	</div>
{/if}

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

	/* --- Floating filter panel --- */

	.floating-filters {
		position: fixed;
		z-index: 50;
		width: 260px;
		background: var(--color-surface-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		display: flex;
		flex-direction: column;
	}

	.filter-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-m) var(--space-l);
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-icon-secondary);
		padding: 2px;
		border-radius: var(--radius-sm);
		transition: color 150ms;
	}

	.close-btn:hover {
		color: var(--color-text-primary);
	}

	.filter-search {
		padding: var(--space-m) var(--space-l) var(--space-s);
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

	.search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--color-icon-secondary);
		padding: 2px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
		transition: color 150ms;
	}

	.search-clear:hover {
		color: var(--color-text-primary);
	}

	/* --- Filters --- */

	.filters {
		padding: var(--space-m) var(--space-l) var(--space-l);
		display: flex;
		flex-direction: column;
		gap: var(--space-l);
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

	.dataset-list-wrapper {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.dataset-list {
		overflow-y: auto;
		height: 100%;
		padding: var(--space-l) 0;
	}

	.scroll-fade-bottom {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 32px;
		pointer-events: none;
		z-index: 10;
		background: linear-gradient(to top, var(--color-surface-primary) 0%, transparent 100%);
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
		padding: var(--space-m) var(--space-l) var(--space-m);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.proj-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
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

	/* --- Attribution --- */

	.attribution {
		flex-shrink: 0;
		padding: 0 var(--space-l) var(--space-s);
		text-align: center;
		color: var(--color-text-tertiary);
	}

	.attribution a {
		color: var(--color-text-tertiary);
		text-decoration: none;
	}

	.attribution a:hover {
		color: var(--color-text-secondary);
		text-decoration: underline;
	}

</style>
