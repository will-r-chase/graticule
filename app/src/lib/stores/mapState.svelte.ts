export const mapState = $state<{
	canvas: HTMLCanvasElement | null;
	width: number;
	height: number;
	bgColor: string;
	tx: number;
	ty: number;
	mapScale: number;
}>({
	canvas: null,
	width: 0,
	height: 0,
	bgColor: '#f4f4f5',
	tx: 0,
	ty: 0,
	mapScale: 1,
});
