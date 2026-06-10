const layerSelection = $state({ ids: [] as string[], pivotId: null as string | null });

export function selectLayer(id: string): void {
	layerSelection.ids = [id];
	layerSelection.pivotId = id;
}

export function toggleLayerSelection(id: string): void {
	if (layerSelection.ids.includes(id)) {
		layerSelection.ids = layerSelection.ids.filter((x) => x !== id);
	} else {
		layerSelection.ids = [...layerSelection.ids, id];
	}
}

export function rangeSelectLayers(id: string, orderedIds: string[]): void {
	const pivot = layerSelection.pivotId ?? id;
	const pivotIdx = orderedIds.indexOf(pivot);
	const targetIdx = orderedIds.indexOf(id);
	if (pivotIdx === -1 || targetIdx === -1) {
		selectLayer(id);
		return;
	}
	const start = Math.min(pivotIdx, targetIdx);
	const end = Math.max(pivotIdx, targetIdx);
	layerSelection.ids = orderedIds.slice(start, end + 1);
}

export function clearLayerSelection(): void {
	layerSelection.ids = [];
	layerSelection.pivotId = null;
}

export { layerSelection };
