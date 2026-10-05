// Per-layer blend modes. Ids are the CSS mix-blend-mode names, so they pass straight through
// to SVG export; the canvas needs the globalCompositeOperation equivalent ('normal' is
// 'source-over'; every other CSS name is the same string).

export type BlendMode =
	| 'normal'
	| 'multiply'
	| 'screen'
	| 'overlay'
	| 'darken'
	| 'lighten'
	| 'color-dodge'
	| 'color-burn'
	| 'hard-light'
	| 'soft-light'
	| 'difference'
	| 'exclusion'
	| 'hue'
	| 'saturation'
	| 'color'
	| 'luminosity';

export const blendModeOptions: { id: BlendMode; label: string }[] = [
	{ id: 'normal', label: 'Normal' },
	{ id: 'multiply', label: 'Multiply' },
	{ id: 'screen', label: 'Screen' },
	{ id: 'overlay', label: 'Overlay' },
	{ id: 'darken', label: 'Darken' },
	{ id: 'lighten', label: 'Lighten' },
	{ id: 'color-dodge', label: 'Color dodge' },
	{ id: 'color-burn', label: 'Color burn' },
	{ id: 'hard-light', label: 'Hard light' },
	{ id: 'soft-light', label: 'Soft light' },
	{ id: 'difference', label: 'Difference' },
	{ id: 'exclusion', label: 'Exclusion' },
	{ id: 'hue', label: 'Hue' },
	{ id: 'saturation', label: 'Saturation' },
	{ id: 'color', label: 'Color' },
	{ id: 'luminosity', label: 'Luminosity' },
];

export function toCompositeOperation(mode: BlendMode): GlobalCompositeOperation {
	return mode === 'normal' ? 'source-over' : mode;
}
