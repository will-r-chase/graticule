import { getIssues } from '@placemarkio/check-geojson';
import { rewindFeatureCollection } from '@placemarkio/geojson-rewind';
import { kml, gpx } from '@tmcw/togeojson';
// shpjs has no TypeScript types
// @ts-expect-error no type declarations
import { parseZip } from 'shpjs';
// @ts-expect-error no type declarations available for d3-dsv at current Node version
import { csvParse } from 'd3-dsv';
import { feature as topoFeature } from 'topojson-client';
import { unzipSync } from 'fflate';
import type { Feature, FeatureCollection, GeoJsonGeometryTypes, Geometry, Position } from 'geojson';
import type { Topology } from 'topojson-specification';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssueLevel = 'error' | 'warning' | 'info';

export interface UploadIssue {
	level: IssueLevel;
	code: string;
	message: string;
	fixable: boolean; // true = user can resolve it via UserChoices
}

export interface CsvColumns {
	detected: { lat: string; lon: string } | null;
	all: string[];
}

export interface UploadResult {
	geojson: FeatureCollection | null;
	// Set instead of geojson when the uploaded file was already TopoJSON — passed
	// straight through without round-tripping to GeoJSON and back.
	topology?: Topology;
	issues: UploadIssue[];
	/** False only when there are unfixable blocking errors */
	canProceed: boolean;
	featureCount: number;
	geometryTypes: GeoJsonGeometryTypes[];
	hasMixedGeometries: boolean;
	// CSV-specific — kept so applyFixes can re-convert with different columns
	csvRows?: Record<string, string>[];
	csvColumns?: CsvColumns;
}

export interface UserChoices {
	swapCoordinates?: boolean;
	splitGeometryTypes?: boolean;
	csvLatColumn?: string;
	csvLonColumn?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type Format = 'geojson' | 'topojson' | 'shapefile' | 'kml' | 'kmz' | 'gpx' | 'csv';

function detectFormat(file: File): Format | null {
	const name = file.name.toLowerCase();
	if (name.endsWith('.geojson')) return 'geojson';
	if (name.endsWith('.topojson')) return 'topojson';
	if (name.endsWith('.zip')) return 'shapefile';
	if (name.endsWith('.kml')) return 'kml';
	if (name.endsWith('.kmz')) return 'kmz';
	if (name.endsWith('.gpx')) return 'gpx';
	if (name.endsWith('.csv')) return 'csv';
	if (name.endsWith('.json')) return 'json-sniff' as Format; // resolved after reading
	return null;
}

function makeError(code: string, message: string): UploadIssue {
	return { level: 'error', code, message, fixable: false };
}

function makeWarning(code: string, message: string, fixable = false): UploadIssue {
	return { level: 'warning', code, message, fixable };
}

function makeInfo(code: string, message: string): UploadIssue {
	return { level: 'info', code, message, fixable: false };
}

function blockingResult(issue: UploadIssue, priorIssues: UploadIssue[] = []): UploadResult {
	return {
		geojson: null,
		issues: [...priorIssues, issue],
		canProceed: false,
		featureCount: 0,
		geometryTypes: [],
		hasMixedGeometries: false,
	};
}

// Recursively yield every [x, y] position in a geometry.
function* coordsOf(geom: Geometry): Generator<Position> {
	switch (geom.type) {
		case 'Point':
			yield geom.coordinates;
			break;
		case 'MultiPoint':
		case 'LineString':
			yield* geom.coordinates;
			break;
		case 'MultiLineString':
		case 'Polygon':
			for (const ring of geom.coordinates) yield* ring;
			break;
		case 'MultiPolygon':
			for (const poly of geom.coordinates)
				for (const ring of poly) yield* ring;
			break;
		case 'GeometryCollection':
			for (const g of geom.geometries) yield* coordsOf(g);
			break;
	}
}

function checkCoordinates(fc: FeatureCollection): { outOfRange: boolean; likelySwapped: boolean } {
	let minX = Infinity, maxX = -Infinity;
	let minY = Infinity, maxY = -Infinity;
	let count = 0;

	for (const feature of fc.features) {
		if (!feature.geometry) continue;
		for (const [x, y] of coordsOf(feature.geometry)) {
			if (minX > x) minX = x;
			if (maxX < x) maxX = x;
			if (minY > y) minY = y;
			if (maxY < y) maxY = y;
			count++;
		}
	}

	if (count === 0) return { outOfRange: false, likelySwapped: false };

	// Detect swapped coordinates: x values look like latitudes [-90,90]
	// but y values exceed the valid latitude range.
	if (minX >= -90 && maxX <= 90 && (maxY > 90 || minY < -90)) {
		return { outOfRange: true, likelySwapped: true };
	}

	// Straightforward out-of-range (likely projected CRS)
	const outOfRange = minX < -180 || maxX > 180 || minY < -90 || maxY > 90;
	return { outOfRange, likelySwapped: false };
}

function getGeometryTypes(fc: FeatureCollection): GeoJsonGeometryTypes[] {
	const types = new Set<GeoJsonGeometryTypes>();
	for (const f of fc.features) {
		if (f.geometry) types.add(f.geometry.type as GeoJsonGeometryTypes);
	}
	return [...types];
}

function countNullGeometries(fc: FeatureCollection): number {
	return fc.features.filter((f) => !f.geometry).length;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const LAT_NAMES = new Set(['lat', 'latitude', 'y', 'ylat', 'ycoord', 'y_coord', 'y_wgs84']);
const LON_NAMES = new Set(['lon', 'lng', 'long', 'longitude', 'x', 'xlon', 'xcoord', 'x_coord', 'x_wgs84']);

function detectCsvColumns(cols: string[]): { lat: string; lon: string } | null {
	const lower = cols.map((c) => c.toLowerCase());
	const latIdx = lower.findIndex((c) => LAT_NAMES.has(c));
	const lonIdx = lower.findIndex((c) => LON_NAMES.has(c));
	if (latIdx === -1 || lonIdx === -1) return null;
	return { lat: cols[latIdx], lon: cols[lonIdx] };
}

function csvRowsToGeoJSON(
	rows: Record<string, string>[],
	latCol: string,
	lonCol: string
): { geojson: FeatureCollection; nullCount: number } {
	let nullCount = 0;
	const features: Feature[] = rows.map((row) => {
		const lat = Number(row[latCol]);
		const lon = Number(row[lonCol]);
		if (isNaN(lat) || isNaN(lon)) {
			nullCount++;
			return { type: 'Feature', geometry: null, properties: { ...row } } as unknown as Feature;
		}
		return {
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [lon, lat] },
			properties: { ...row },
		};
	});
	return { geojson: { type: 'FeatureCollection', features }, nullCount };
}

// ---------------------------------------------------------------------------
// Validation — runs after parsing and silent fixes
// ---------------------------------------------------------------------------

function validateGeoJSON(fc: FeatureCollection): UploadIssue[] {
	const issues: UploadIssue[] = [];

	// check-geojson structural check — deduplicated and with human-friendly message transforms
	try {
		const structuralIssues = getIssues(JSON.stringify(fc));
		const seen = new Set<string>();
		for (const issue of structuralIssues) {
			// Deduplicate by message (check-geojson can emit the same message twice for a single error)
			if (seen.has(issue.message)) continue;
			seen.add(issue.message);

			let message = issue.message;
			// Transform known cryptic messages into plain English
			if (message.includes('First and last positions')) {
				message = 'This file contains an unclosed ring: the first and last position of a Polygon or MultiPolygon ring must be identical.';
			}

			issues.push({
				level: 'warning', // non-blocking per design decision
				code: 'geojson-structural',
				message,
				fixable: false,
			});
		}
	} catch {
		// getIssues shouldn't throw but guard anyway
	}

	// Coordinate range / swap check
	const { outOfRange, likelySwapped } = checkCoordinates(fc);
	if (likelySwapped) {
		issues.push(makeWarning(
			'coordinate-swap',
			'Coordinates appear to have latitude and longitude swapped. ' +
			'If the data appears in the wrong location, use "Swap coordinates" to fix it.',
			true
		));
	} else if (outOfRange) {
		issues.push(makeError(
			'wrong-projection',
			'This file\'s coordinates are outside the valid WGS84 range (longitude ±180, latitude ±90). ' +
			'It is likely in a projected coordinate system (e.g. UTM or State Plane). ' +
			'Re-export as WGS84 / EPSG:4326 to use it in Graticule.'
		));
	}

	// Null geometry check
	const nullCount = countNullGeometries(fc);
	const total = fc.features.length;
	if (nullCount === total) {
		issues.push(makeError(
			'all-null-geometries',
			'All features in this file have no geometry. There is nothing to render.'
		));
	} else if (nullCount > 0) {
		issues.push(makeWarning(
			'some-null-geometries',
			`${nullCount} of ${total} feature${nullCount === 1 ? '' : 's'} have no geometry and will not be visible.`
		));
	}

	// Mixed geometry types
	const types = getGeometryTypes(fc);
	if (types.length > 1) {
		issues.push({
			level: 'info',
			code: 'mixed-geometry-types',
			message: `This file contains ${types.join(', ')} features. Import as one layer or split into separate layers by geometry type?`,
			fixable: true,
		});
	}

	// Large file
	if (total > 10000) {
		issues.push(makeInfo(
			'large-file',
			`This file contains ${total.toLocaleString()} features and may affect performance.`
		));
	}

	return issues;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function parseFile(file: File): Promise<UploadResult> {
	const issues: UploadIssue[] = [];

	// 1. Detect format
	let format = detectFormat(file);
	if (!format) {
		return blockingResult(makeError(
			'unknown-format',
			`Unrecognised file type: "${file.name}". ` +
			'Supported formats: GeoJSON, TopoJSON, Shapefile (.zip), KML, KMZ, GPX, CSV.'
		));
	}

	// 2. Read file
	let text = '';
	let buffer: ArrayBuffer | null = null;

	try {
		if (format === 'shapefile' || format === 'kmz') {
			buffer = await file.arrayBuffer();
		} else {
			text = await file.text();
		}
	} catch {
		return blockingResult(makeError('read-error', 'The file could not be read. It may be damaged or inaccessible.'));
	}

	// 3. Parse to GeoJSON
	let geojson: FeatureCollection | null = null;

	// --- GeoJSON / TopoJSON / JSON sniff ---
	if (format === 'geojson' || format === 'topojson' || (format as string) === 'json-sniff') {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			const syntaxMsg = e instanceof SyntaxError ? e.message : String(e);
			// Extract character position from the error message (V8: "at position N", Safari: "at index N")
			const posMatch = syntaxMsg.match(/(?:position|index)\s+(\d+)/i);
			const pos = posMatch ? parseInt(posMatch[1]) : null;
			let message = `This file contains invalid JSON: ${syntaxMsg}`;
			if (pos !== null && pos <= text.length) {
				const start = Math.max(0, pos - 25);
				const end = Math.min(text.length, pos + 10);
				const snippet = text.slice(start, end).replace(/\n/g, '↵').replace(/\t/g, '→');
				const arrow = ' '.repeat(Math.min(pos - start, snippet.length)) + '↑';
				message += `\n\n…${snippet}…\n ${arrow}`;
			}
			return blockingResult(makeError('parse-error', message));
		}

		const obj = parsed as Record<string, unknown>;

		// Sniff .json extension
		if ((format as string) === 'json-sniff') {
			if (obj.type === 'Topology') format = 'topojson';
			else format = 'geojson';
		}

		if (format === 'topojson') {
			try {
				const topology = obj as unknown as Topology;
				const objectNames = Object.keys(topology.objects);
				if (objectNames.length === 0) {
					return blockingResult(makeError('topojson-empty', 'This TopoJSON file contains no objects.'));
				}
				// Derive GeoJSON only for feature count / geometry type display —
				// the topology itself is returned as-is and used for import.
				const allFeatures: Feature[] = [];
				for (const name of objectNames) {
					const fc = topoFeature(topology, topology.objects[name]) as FeatureCollection | Feature;
					if (fc.type === 'FeatureCollection') {
						allFeatures.push(...fc.features);
					} else {
						allFeatures.push(fc);
					}
				}
				if (objectNames.length > 1) {
					issues.push(makeInfo(
						'topojson-multi-object',
						`This TopoJSON file contained ${objectNames.length} objects (${objectNames.join(', ')}), imported as a single layer.`
					));
				}
				const derivedGeoJSON: FeatureCollection = { type: 'FeatureCollection', features: allFeatures };
				const geometryTypes = getGeometryTypes(derivedGeoJSON);
				const blocking = issues.some((i) => i.level === 'error');
				return {
					geojson: null,         // not used for import — topology is the source
					topology,              // passed straight through
					issues,
					canProceed: !blocking,
					featureCount: allFeatures.length,
					geometryTypes,
					hasMixedGeometries: false, // topology is imported as-is; split doesn't apply
				};
			} catch (e) {
				return blockingResult(makeError('parse-error', 'This TopoJSON file could not be parsed. It may be malformed.'));
			}
		} else {
			// GeoJSON
			if (!obj.type) {
				return blockingResult(makeError('parse-error', 'This JSON file does not appear to be GeoJSON (missing "type" field).'));
			}
			if (obj.type !== 'FeatureCollection') {
				// Wrap bare geometries or features
				if (obj.type === 'Feature') {
					geojson = { type: 'FeatureCollection', features: [obj as unknown as Feature] };
				} else {
					return blockingResult(makeError(
						'parse-error',
						`Expected a GeoJSON FeatureCollection, got "${obj.type}". Only FeatureCollections are supported.`
					));
				}
			} else {
				geojson = obj as unknown as FeatureCollection;
			}
		}
	}

	// --- Shapefile ---
	else if (format === 'shapefile') {
		// Inspect zip contents before parsing
		try {
			const zipFiles = unzipSync(new Uint8Array(buffer!));
			const fileNames = Object.keys(zipFiles).map((f) => f.toLowerCase());
			const hasShp = fileNames.some((f) => f.endsWith('.shp'));
			const hasDbf = fileNames.some((f) => f.endsWith('.dbf'));
			const hasPrj = fileNames.some((f) => f.endsWith('.prj'));

			if (!hasShp) {
				return blockingResult(makeError(
					'shapefile-missing-shp',
					'This zip file does not contain a .shp file. ' +
					`Found: ${Object.keys(zipFiles).join(', ') || 'nothing'}.`
				));
			}
			if (!hasDbf) {
				issues.push(makeWarning(
					'shapefile-missing-dbf',
					'No .dbf file found in this zip. Feature attributes will be unavailable.'
				));
			}
			if (!hasPrj) {
				issues.push(makeWarning(
					'shapefile-missing-prj',
					'No .prj file found in this zip. We\'ll assume WGS84, but if the data appears ' +
					'in the wrong location, re-export with coordinate system information included.'
				));
			}
		} catch {
			return blockingResult(makeError('shapefile-bad-zip', 'This zip file could not be opened. It may be corrupted.'));
		}

		try {
			const result = await parseZip(buffer!);
			const collections: FeatureCollection[] = Array.isArray(result) ? result : [result];
			const allFeatures: Feature[] = collections.flatMap((fc) => fc.features);
			geojson = { type: 'FeatureCollection', features: allFeatures };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// Pass prior issues (e.g. missing .dbf warning) so they're not lost
			return blockingResult(makeError('shapefile-parse-error', `Shapefile could not be parsed: ${msg}`), issues);
		}
	}

	// --- KML ---
	else if (format === 'kml') {
		const dom = new DOMParser().parseFromString(text, 'text/xml');
		const parseError = dom.querySelector('parsererror');
		if (parseError) {
			return blockingResult(makeError('parse-error', 'This KML file contains invalid XML and could not be parsed.'));
		}
		geojson = kml(dom) as FeatureCollection;
	}

	// --- KMZ ---
	else if (format === 'kmz') {
		try {
			const zipFiles = unzipSync(new Uint8Array(buffer!));
			const kmlEntry = Object.entries(zipFiles).find(([name]) => name.toLowerCase().endsWith('.kml'));
			if (!kmlEntry) {
				return blockingResult(makeError('kmz-no-kml', 'This KMZ file does not contain a .kml file.'));
			}
			const kmlText = new TextDecoder().decode(kmlEntry[1]);
			const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
			const parseError = dom.querySelector('parsererror');
			if (parseError) {
				return blockingResult(makeError('parse-error', 'The KML inside this KMZ file is invalid and could not be parsed.'));
			}
			geojson = kml(dom) as FeatureCollection;
		} catch {
			return blockingResult(makeError('kmz-parse-error', 'This KMZ file could not be opened. It may be corrupted.'));
		}
	}

	// --- GPX ---
	else if (format === 'gpx') {
		const dom = new DOMParser().parseFromString(text, 'text/xml');
		const parseError = dom.querySelector('parsererror');
		if (parseError) {
			return blockingResult(makeError('parse-error', 'This GPX file contains invalid XML and could not be parsed.'));
		}
		geojson = gpx(dom) as FeatureCollection;
	}

	// --- CSV ---
	else if (format === 'csv') {
		// d3-dsv returns array with a `.columns` property
		const rows = csvParse(text) as unknown as Record<string, string>[] & { columns: string[] };

		if (rows.length === 0) {
			return blockingResult(makeError('csv-empty', 'This CSV file contains no data rows.'));
		}

		const allCols: string[] = rows.columns ?? Object.keys(rows[0]);
		const detected = detectCsvColumns(allCols);

		if (!detected) {
			// Can't produce geojson yet — user must pick columns
			issues.push(makeWarning(
				'csv-no-latlon',
				'No latitude/longitude columns could be detected. ' +
				'Please select which columns contain the coordinates.',
				true
			));
			return {
				geojson: null,
				issues,
				canProceed: false,
				featureCount: rows.length,
				geometryTypes: [],
				hasMixedGeometries: false,
				csvRows: rows,
				csvColumns: { detected: null, all: allCols },
			};
		}

		// Produce a preliminary geojson with detected columns
		const { geojson: csvGeoJSON, nullCount } = csvRowsToGeoJSON(rows, detected.lat, detected.lon);
		geojson = csvGeoJSON;

		if (nullCount === rows.length) {
			issues.push(makeError(
				'csv-all-invalid-coords',
				`The "${detected.lat}" and "${detected.lon}" columns don't appear to contain valid numbers.`
			));
		} else if (nullCount > 0) {
			issues.push(makeWarning(
				'csv-some-invalid-coords',
				`${nullCount} of ${rows.length} row${nullCount === 1 ? '' : 's'} had invalid coordinate values and will have no geometry.`
			));
		}

		// Always surface detected columns so user can confirm or override
		issues.push(makeInfo(
			'csv-columns-detected',
			`Using "${detected.lat}" for latitude and "${detected.lon}" for longitude.`
		));

		const blocking = issues.some((i) => i.level === 'error');
		return {
			geojson: blocking ? null : geojson,
			issues,
			canProceed: !blocking,
			featureCount: rows.length,
			geometryTypes: ['Point'],
			hasMixedGeometries: false,
			csvRows: rows,
			csvColumns: { detected, all: allCols },
		};
	}

	if (!geojson) {
		return blockingResult(makeError('unknown-error', 'The file could not be converted to GeoJSON.'));
	}

	// 4. Silent auto-fix: winding order
	const beforeRewind = JSON.stringify(geojson);
	const rewound = rewindFeatureCollection(geojson);
	geojson = rewound as FeatureCollection;
	if (JSON.stringify(geojson) !== beforeRewind) {
		issues.push(makeInfo('winding-order-fixed', 'Polygon winding order was corrected automatically.'));
	}

	// 5. Validate
	const validationIssues = validateGeoJSON(geojson);
	issues.push(...validationIssues);

	// 6. Build result
	const geometryTypes = getGeometryTypes(geojson);
	const blocking = issues.some((i) => i.level === 'error');

	return {
		geojson: blocking ? null : geojson,
		issues,
		canProceed: !blocking,
		featureCount: geojson.features.length,
		geometryTypes,
		hasMixedGeometries: geometryTypes.length > 1,
	};
}

// ---------------------------------------------------------------------------
// Apply user choices after initial parse
// ---------------------------------------------------------------------------

export function applyFixes(result: UploadResult, choices: UserChoices): FeatureCollection[] {
	let geojson = result.geojson;

	// CSV: re-convert with user-selected columns
	if (result.csvRows && choices.csvLatColumn && choices.csvLonColumn) {
		const { geojson: csvGeoJSON } = csvRowsToGeoJSON(
			result.csvRows,
			choices.csvLatColumn,
			choices.csvLonColumn
		);
		geojson = csvGeoJSON;
	}

	if (!geojson) return [];

	// Coordinate swap
	if (choices.swapCoordinates) {
		geojson = swapCoordinates(geojson);
	}

	// Split by geometry type, or return as single collection
	if (choices.splitGeometryTypes) {
		return splitByGeometryType(geojson);
	}

	return [geojson];
}

export function swapCoordinates(fc: FeatureCollection): FeatureCollection {
	const swapPositions = (positions: Position[]): Position[] =>
		positions.map(([x, y, ...rest]) => [y, x, ...rest]);

	const swapGeometry = (geom: Geometry): Geometry => {
		switch (geom.type) {
			case 'Point':
				return { ...geom, coordinates: [geom.coordinates[1], geom.coordinates[0]] };
			case 'MultiPoint':
			case 'LineString':
				return { ...geom, coordinates: swapPositions(geom.coordinates) };
			case 'MultiLineString':
			case 'Polygon':
				return { ...geom, coordinates: geom.coordinates.map(swapPositions) };
			case 'MultiPolygon':
				return { ...geom, coordinates: geom.coordinates.map((p) => p.map(swapPositions)) };
			case 'GeometryCollection':
				return { ...geom, geometries: geom.geometries.map(swapGeometry) };
		}
	};

	return {
		...fc,
		features: fc.features.map((f) =>
			f.geometry ? { ...f, geometry: swapGeometry(f.geometry) } : f
		),
	};
}

export function splitByGeometryType(fc: FeatureCollection): FeatureCollection[] {
	const byType = new Map<string, Feature[]>();
	for (const feature of fc.features) {
		const type = feature.geometry?.type ?? 'null';
		if (!byType.has(type)) byType.set(type, []);
		byType.get(type)!.push(feature);
	}
	return [...byType.entries()]
		.filter(([type]) => type !== 'null')
		.map(([, features]) => ({ type: 'FeatureCollection' as const, features }));
}
