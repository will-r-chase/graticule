<script lang="ts">
	import CatalogPanel from '$lib/components/catalog/CatalogPanel.svelte';
	import LayersPanel from '$lib/components/layers/LayersPanel.svelte';
	import MapCanvas from '$lib/components/map/MapCanvas.svelte';
	import { initCatalog } from '$lib/stores/catalog.svelte';

	let { data } = $props();

	// Initialise the catalog store as soon as the page data is available.
	initCatalog(data.catalog.baseUrl, data.catalog.datasets);

</script>

<div class="workspace">
	<CatalogPanel datasets={data.catalog.datasets} />
	<MapCanvas />
	<LayersPanel />
</div>

<style>
	.workspace {
		display: flex;
		height: 100%;
	}

</style>
