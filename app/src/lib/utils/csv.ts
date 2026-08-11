// Converts a point CSV (one row = one point) into the same inline-coordinate
// TopoJSON that createLabelLayer produces, so a catalog CSV can flow through the
// normal layer pipeline as a label layer. Coordinate columns are hardcoded to
// GeoNames' `latitude`/`longitude`; every column is kept as a feature property.
// All values stay as parsed by d3-dsv (strings) except the two coordinate values,
// which are coerced to numbers for the geometry. Rows with a missing or non-numeric
// coordinate are dropped.
// @ts-expect-error no type declarations available for d3-dsv at current Node version
import { csvParse } from 'd3-dsv';
import type { Topology } from 'topojson-specification';

const LAT_COLUMN = 'latitude';
const LON_COLUMN = 'longitude';

export function csvToPointTopology(csvText: string): Topology {
	const rows = csvParse(csvText) as unknown as Record<string, string>[];

	const geometries: unknown[] = [];
	for (const row of rows) {
		const lon = Number(row[LON_COLUMN]);
		const lat = Number(row[LAT_COLUMN]);
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
		geometries.push({ type: 'Point', coordinates: [lon, lat], properties: { ...row } });
	}

	// Points carry inline coordinates, so no arcs are needed. Same shape as the
	// label topology built in createLabelLayer (layers.svelte.ts).
	return {
		type: 'Topology',
		arcs: [],
		objects: {
			labels: {
				type: 'GeometryCollection',
				geometries,
			},
		},
	} as unknown as Topology;
}
