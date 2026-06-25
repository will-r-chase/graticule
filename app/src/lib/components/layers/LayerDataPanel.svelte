<script lang="ts">
	import { workingTopologyData, setLayerDatasource } from '$lib/stores/layers.svelte';
	import { pushSnapshot } from '$lib/stores/history.svelte';
	import { catalog } from '$lib/stores/catalog.svelte';
	import { uploadedDatasets } from '$lib/stores/uploadedDatasets.svelte';
	import { SOURCE_CONFIG, SOURCE_ORDER } from '$lib/config';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import type { Layer } from '$lib/types';

	let { layer }: { layer: Layer } = $props();

	// Switch targets: user uploads + single-layer catalog datasets. Multi-layer catalog
	// datasets are excluded — setLayerDatasource can't repoint to them in place. Catalog
	// datasets are grouped by source (Natural Earth, US Census, …) in SOURCE_ORDER, matching
	// the data sidebar's grouping.
	const sourceOptions = $derived([
		...uploadedDatasets
			.filter((u) => !u.internal)
			.map((u) => ({ id: u.id, label: u.name, group: 'Uploads' })),
		...SOURCE_ORDER.flatMap((source) =>
			catalog.datasets
				.filter((d) => d.source === source && !d.layers?.length)
				.map((d) => ({ id: d.id, label: d.name, group: SOURCE_CONFIG[source]?.label ?? source }))
		),
	]);

	// Edited/derived layers (geometryEdited) no longer match any real source, so we show a
	// synthetic "Derived dataset" entry instead. The real sources stay listed — picking the
	// original one re-fetches clean source geometry and clears geometryEdited.
	const DERIVED_OPTION_ID = '__derived__';

	const displayOptions = $derived(
		layer.geometryEdited
			? [{ id: DERIVED_OPTION_ID, label: 'Derived dataset', italic: true }, ...sourceOptions]
			: sourceOptions
	);

	// Display value flows one-way from layer state, so undo/redo update the box for free.
	const displayValue = $derived(layer.geometryEdited ? DERIVED_OPTION_ID : layer.datasetId);

	// Repoint the layer to a different dataset.
	function handleSourceChange(newId: string) {
		if (newId === DERIVED_OPTION_ID) return; // re-selecting the synthetic entry is a no-op
		if (newId === layer.datasetId && !layer.geometryEdited) return; // already this source, unedited
		setLayerDatasource(layer.id, newId, () => pushSnapshot());
	}

	// Feature count, read from the layer's working topology. Depends on hasTopology so
	// it recomputes once the pipeline has produced geometry (the Map itself isn't reactive).
	const featureCount = $derived.by(() => {
		void layer.hasTopology;
		const topo = workingTopologyData.get(layer.id);
		if (!topo) return 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anyTopo = topo as any;
		const objName = Object.keys(anyTopo.objects)[0];
		return anyTopo.objects[objName]?.geometries?.length ?? 0;
	});

	const geometryLabel = $derived(
		layer.geometryTypes.length > 0 ? layer.geometryTypes.join(', ') : '—'
	);
</script>

<div class="data-panel">
	<div class="row">
		<span class="label mono-small">Source</span>
		<div class="controls">
			<Combobox options={displayOptions} value={displayValue} placeholder="None selected" disabled={layer.loading} onchange={handleSourceChange} />
		</div>
	</div>
	<div class="row">
		<span class="label mono-small">Type</span>
		<div class="controls">
			<span class="value mono-regular">{geometryLabel}</span>
		</div>
	</div>
	<div class="row">
		<span class="label mono-small">Features</span>
		<div class="controls">
			<span class="value mono-regular">{featureCount}</span>
		</div>
	</div>
</div>

<style>
	.data-panel {
		padding: var(--space-m) var(--space-m) var(--space-m);
		background: var(--color-surface-primary);
		display: flex;
		flex-direction: column;
		gap: var(--space-m);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-s);
		height: 28px;
	}

	.label {
		width: 60px;
		flex-shrink: 0;
		color: var(--color-text-primary);
	}

	.controls {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}

	.value {
		color: var(--color-text-primary);
	}
</style>
