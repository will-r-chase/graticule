export const selection = $state({
	features: new Map<string, Set<number>>(),
});

export function clearSelection(): void {
	selection.features = new Map();
}

export function selectFeature(layerId: string, featureIndex: number, addToExisting: boolean): void {
	if (!addToExisting) {
		selection.features = new Map([[layerId, new Set([featureIndex])]]);
	} else {
		const next = new Map(selection.features);
		const layerSet = new Set(next.get(layerId) ?? []);
		if (layerSet.has(featureIndex)) {
			layerSet.delete(featureIndex);
			if (layerSet.size === 0) next.delete(layerId);
			else next.set(layerId, layerSet);
		} else {
			layerSet.add(featureIndex);
			next.set(layerId, layerSet);
		}
		selection.features = next;
	}
}
