export const featuresTable = $state({
	open: false,
	activeLayerId: null as string | null,
});

export function openFeaturesTable(layerId: string): void {
	featuresTable.activeLayerId = layerId;
	featuresTable.open = true;
}

export function closeFeaturesTable(): void {
	featuresTable.open = false;
}
