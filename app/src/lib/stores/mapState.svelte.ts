// Plain (non-reactive) object that MapCanvas writes to imperatively.
// Export reads these values at click time — no reactivity needed.
export const mapState = {
	width: 0,
	height: 0,
	tx: 0,
	ty: 0,
	mapScale: 1,
};
