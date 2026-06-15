const clipBbox = $state({
	open: false,
	mode: 'layer' as 'layer' | 'bbox',
	maskId: null as string | null,
	north: 45,
	south: -45,
	east: 90,
	west: -90,
});

export function openClipPopover(mode: 'layer' | 'bbox', bbox: [number, number, number, number], maskId: string | null = null) {
	const [west, south, east, north] = bbox;
	clipBbox.open = true;
	clipBbox.mode = mode;
	clipBbox.maskId = maskId;
	clipBbox.north = north;
	clipBbox.south = south;
	clipBbox.east = east;
	clipBbox.west = west;
}

export function closeClipPopover() {
	clipBbox.open = false;
	clipBbox.maskId = null;
}

export function setClipMode(mode: 'layer' | 'bbox') {
	clipBbox.mode = mode;
}

export function setClipBbox(west: number, south: number, east: number, north: number) {
	clipBbox.west = west;
	clipBbox.south = south;
	clipBbox.east = east;
	clipBbox.north = north;
}

export { clipBbox };
