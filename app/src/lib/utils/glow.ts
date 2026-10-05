// Inner/outer glow for polygon layers. Values are in screen pixels, so a glow keeps the same
// look at any zoom (like the label halo).

export interface Glow {
	color: string;
	opacity: number;
	// Gaussian blur radius in px.
	blur: number;
	// Hardens the glow before blurring: dilates the silhouette outward (outer glow) or
	// chokes the glow further into the shape (inner glow), in px.
	spread: number;
}

export const defaultGlow: Glow = { color: '#ffffff', opacity: 0.8, blur: 8, spread: 0 };
