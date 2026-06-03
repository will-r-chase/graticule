// Background color for the map canvas.
// Stored here so the history snapshot can read it without
// reaching into MapCanvas local state.
export const background = $state({ enabled: true, hex: '#f7f7f4', alpha: 1 });
