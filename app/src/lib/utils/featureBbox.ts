// Computes geographic bounding boxes for each geometry in a TopoJSON topology.
// Handles both quantized (transform present) and pre-decoded topologies.
// Used by marquee selection to hit-test features against the drag rectangle.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectArcIndices(geom: any, result: Set<number>): void {
	if (!geom) return;
	const norm = (i: number) => (i < 0 ? ~i : i);
	switch (geom.type) {
		case 'LineString':
			for (const i of geom.arcs) result.add(norm(i));
			break;
		case 'MultiLineString':
		case 'Polygon':
			for (const ring of geom.arcs) for (const i of ring) result.add(norm(i));
			break;
		case 'MultiPolygon':
			for (const poly of geom.arcs) for (const ring of poly) for (const i of ring) result.add(norm(i));
			break;
		case 'GeometryCollection':
			for (const g of geom.geometries ?? []) collectArcIndices(g, result);
			break;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodedVertices(topo: any, arcIndex: number): [number, number][] {
	const raw: number[][] = topo.arcs[arcIndex];
	if (!topo.transform) {
		return raw as [number, number][];
	}
	const [sx, sy] = topo.transform.scale;
	const [tx, ty] = topo.transform.translate;
	let x = 0, y = 0;
	return raw.map(([dx, dy]) => {
		x += dx; y += dy;
		return [x * sx + tx, y * sy + ty];
	});
}

// Returns [minLon, minLat, maxLon, maxLat] for each geometry in the topology's
// first object, in the same order as the geometries array. Returns null for
// geometries that have no coordinate data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeFeatureBboxes(topo: any): Array<[number, number, number, number] | null> {
	const objectName = Object.keys(topo.objects)[0];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const geometries: any[] = topo.objects[objectName].geometries ?? [];

	// When a transform is present the topology is quantized: coordinates are stored
	// as integers that must be scaled and translated to get real geographic values.
	// Arcs delta-decode via decodedVertices, but Point/MultiPoint coordinates are
	// stored as absolute quantized values and need the same scale+translate step.
	const scale  = topo.transform?.scale     as [number, number] | undefined;
	const translate = topo.transform?.translate as [number, number] | undefined;

	function dequantize(x: number, y: number): [number, number] {
		if (!scale || !translate) return [x, y];
		return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
	}

	return geometries.map((geom) => {
		if (!geom) return null;

		// Point geometries carry coordinates directly — apply transform if quantized.
		if (geom.type === 'Point') {
			const [gx, gy] = dequantize(geom.coordinates[0], geom.coordinates[1]);
			return [gx, gy, gx, gy] as [number, number, number, number];
		}
		if (geom.type === 'MultiPoint') {
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const [rx, ry] of geom.coordinates) {
				const [x, y] = dequantize(rx, ry);
				if (x < minX) minX = x; if (x > maxX) maxX = x;
				if (y < minY) minY = y; if (y > maxY) maxY = y;
			}
			return [minX, minY, maxX, maxY] as [number, number, number, number];
		}

		const arcIndices = new Set<number>();
		collectArcIndices(geom, arcIndices);
		if (arcIndices.size === 0) return null;

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const idx of arcIndices) {
			for (const [x, y] of decodedVertices(topo, idx)) {
				if (x < minX) minX = x; if (x > maxX) maxX = x;
				if (y < minY) minY = y; if (y > maxY) maxY = y;
			}
		}
		return [minX, minY, maxX, maxY] as [number, number, number, number];
	});
}
