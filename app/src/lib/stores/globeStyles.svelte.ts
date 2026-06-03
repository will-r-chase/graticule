import { background } from './background.svelte';

// Reactive store for globe-specific visual styles.
// Read by MapCanvas for rendering, written by StylePanel.
export const globeStyles = $state({
	ocean: {
		enabled: true,
		// Seeded from the canvas background colour the first time the store is
		// created. After that it's independent — the user can change it freely.
		hex:   background.hex,
		alpha: 1,
	},
	shadow: {
		enabled:   false,
		intensity: 0.5,   // 0–1: controls shadow opacity/spread
	},
	halo: {
		enabled: false,
		hex:     '#a8c8e0',
		alpha:   0.5,
	},
});
