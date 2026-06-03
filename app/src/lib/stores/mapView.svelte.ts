// Reactive store for the current map viewport.
// MapCanvas writes here after any projection, pan, or zoom change.
// CatalogPanel (projection details) and the future minimap read from it.
export const mapView = $state({
	// Geographic center of the current view: [longitude, latitude].
	// null until the first projection is computed.
	center: null as [number, number] | null,

	// Geographic bounding box of the current view: [west, south, east, north].
	// null until the first projection is computed.
	// Note: west may be > east when the view crosses the antimeridian.
	extent: null as [number, number, number, number] | null,

	// Current pan/zoom scale factor. 1 = projection fitted to canvas (default).
	// Used by Minimap to compute the visible angular radius for globe mode.
	mapScale: 1,
});
