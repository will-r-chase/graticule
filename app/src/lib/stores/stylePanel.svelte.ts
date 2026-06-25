let openStyleLayerId = $state<string | null>(null);
// One-shot: the id of a layer whose accordion should open straight to the Data tab (a
// freshly-created empty layer). Consumed once by that LayerItem on mount, then cleared.
let pendingDataTabId: string | null = null;

export const stylePanel = {
	get openId() { return openStyleLayerId; },
	toggle(id: string) {
		openStyleLayerId = openStyleLayerId === id ? null : id;
	},
	// Open a layer's accordion directly on the Data tab.
	openWithDataTab(id: string) {
		openStyleLayerId = id;
		pendingDataTabId = id;
	},
	// Returns true once for the layer flagged by openWithDataTab, then forgets it.
	consumePendingDataTab(id: string): boolean {
		if (pendingDataTabId === id) {
			pendingDataTabId = null;
			return true;
		}
		return false;
	},
};
