import type { Dataset } from '$lib/types';

// Single reactive object — properties can be mutated, which Svelte 5 allows.
const catalog = $state({
	baseURL: '',
	datasets: [] as Dataset[],
});

export function initCatalog(url: string, data: Dataset[]): void {
	catalog.baseURL = url;
	catalog.datasets = data;
}

export { catalog };
