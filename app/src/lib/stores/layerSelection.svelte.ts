const layerSelection = $state({
	ids: [] as string[],
	pivotId: null as string | null,
	enteredId: null as string | null,
	hoveredLayerId: null as string | null,
	editingId: null as string | null,
});

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

export function enterLayer(id: string): void {
	selectLayer(id);
	layerSelection.enteredId = id;
}

export function exitLayer(): void {
	layerSelection.enteredId = null;
}

export function setHoveredLayer(id: string | null): void {
	layerSelection.hoveredLayerId = id;
}

export function startLayerEdit(id: string): void {
	layerSelection.editingId = id;
}

export function clearLayerEdit(): void {
	layerSelection.editingId = null;
}

export function clearLayerSelection(): void {
	layerSelection.ids = [];
	layerSelection.pivotId = null;
	layerSelection.enteredId = null;
	layerSelection.editingId = null;
}

export { layerSelection };
