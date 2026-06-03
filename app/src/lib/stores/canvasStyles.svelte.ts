// Reactive store for all canvas-level visual styles.
// Read by MapCanvas for rendering, written by StylePanel.
// Replaces the old background.svelte and globeStyles.svelte stores.
export const canvasStyles = $state({
	background: {
		enabled: true,
		hex:     '#f7f7f4',
		alpha:   1,
	},
	graticule: {
		enabled: false,
		hex:     '#888888',
		alpha:   0.4,
		step:    10,
	},
	// Globe-only styles — only rendered when the active projection is a globe.
	ocean: {
		enabled: true,
		hex:     '#f7f7f4', // seeded from background default on first init
		alpha:   1,
	},
	shadow: {
		enabled:   false,
		intensity: 0.5,
	},
	halo: {
		enabled: false,
		hex:     '#a8c8e0',
		alpha:   0.5,
	},
});
