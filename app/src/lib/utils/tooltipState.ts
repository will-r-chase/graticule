// Shared warm-up state for all tooltips in the app.
// First hover → 500ms delay. Once a tooltip has shown, subsequent ones appear
// instantly. After 500ms of no active tooltip the state resets to cold.

const COLD_DELAY = 600;
const COOL_DOWN  = 500;

let warm = false;
let coolTimer: ReturnType<typeof setTimeout> | null = null;

export const tooltipState = {
	get isWarm() { return warm; },

	// Call on mouseenter — cancels any pending cool-down so moving between
	// tooltip targets doesn't accidentally reset to cold mid-gesture.
	onEnter() {
		if (coolTimer) { clearTimeout(coolTimer); coolTimer = null; }
	},

	// Call when the tooltip actually becomes visible.
	onShow() {
		warm = true;
	},

	// Call on mouseleave — starts the cool-down clock.
	onHide() {
		if (coolTimer) clearTimeout(coolTimer);
		coolTimer = setTimeout(() => { warm = false; coolTimer = null; }, COOL_DOWN);
	},

	get delay() { return warm ? 0 : COLD_DELAY; },
};
