let openStyleLayerId = $state<string | null>(null);

export const stylePanel = {
	get openId() { return openStyleLayerId; },
	toggle(id: string) {
		openStyleLayerId = openStyleLayerId === id ? null : id;
	},
};
