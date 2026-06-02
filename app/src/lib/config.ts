// All available projections. The `id` matches the d3-geo / d3-geo-projection
// function name (except `geoGlobe` which maps to `geoOrthographic` with visual
// decoration). `group` is used by the Combobox to render section headers.
export type ProjectionEntry = {
	id: string;
	label: string;
	group: string;
	interactionMode: 'pan' | 'rotate';
	isGlobe?: true;
};

export const PROJECTIONS: ProjectionEntry[] = [
	// Globe
	{ id: 'geoGlobe', label: 'Globe', group: 'Globe', interactionMode: 'rotate', isGlobe: true },

	// Cylindrical
	{ id: 'geoMercator', label: 'Mercator', group: 'Cylindrical', interactionMode: 'pan' },
	{ id: 'geoEquirectangular', label: 'Equirectangular', group: 'Cylindrical', interactionMode: 'pan' },
	{ id: 'geoMiller', label: 'Miller', group: 'Cylindrical', interactionMode: 'pan' },
	{ id: 'geoTransverseMercator', label: 'Transverse Mercator', group: 'Cylindrical', interactionMode: 'pan' },
	{ id: 'geoCylindricalEqualArea', label: 'Cylindrical Equal Area', group: 'Cylindrical', interactionMode: 'pan' },
	{ id: 'geoCylindricalStereographic', label: 'Cylindrical Stereographic', group: 'Cylindrical', interactionMode: 'pan' },

	// Pseudocylindrical
	{ id: 'geoNaturalEarth1', label: 'Natural Earth', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoNaturalEarth2', label: 'Natural Earth II', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEqualEarth', label: 'Equal Earth', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoRobinson', label: 'Robinson', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoWinkel3', label: 'Winkel Tripel', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoMollweide', label: 'Mollweide', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEckert1', label: 'Eckert I', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEckert2', label: 'Eckert II', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEckert3', label: 'Eckert III', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEckert4', label: 'Eckert IV', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEckert5', label: 'Eckert V', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoEckert6', label: 'Eckert VI', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoPatterson', label: 'Patterson', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoKavrayskiy7', label: 'Kavrayskiy VII', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoSinusoidal', label: 'Sinusoidal', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoSinuMollweide', label: 'Sinu-Mollweide', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoBoggs', label: 'Boggs Eumorphic', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoBromley', label: 'Bromley', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoCraster', label: 'Craster Parabolic', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoHomolosine', label: 'Goode Homolosine', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoMtFlatPolarParabolic', label: 'McBryde–Thomas Flat-Polar Parabolic', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoMtFlatPolarQuartic', label: 'McBryde–Thomas Flat-Polar Quartic', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoMtFlatPolarSinusoidal', label: 'McBryde–Thomas Flat-Polar Sinusoidal', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoNellHammer', label: 'Nell–Hammer', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoCollignon', label: 'Collignon', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoFahey', label: 'Fahey', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoLoximuthal', label: 'Loximuthal', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoTimes', label: 'Times', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoWagner4', label: 'Wagner IV', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoWagner6', label: 'Wagner VI', group: 'Pseudocylindrical', interactionMode: 'pan' },
	{ id: 'geoWagner', label: 'Wagner VII', group: 'Pseudocylindrical', interactionMode: 'pan' },

	// Azimuthal
	{ id: 'geoOrthographic', label: 'Orthographic', group: 'Azimuthal', interactionMode: 'rotate' },
	{ id: 'geoAzimuthalEqualArea', label: 'Azimuthal Equal Area', group: 'Azimuthal', interactionMode: 'rotate' },
	{ id: 'geoAzimuthalEquidistant', label: 'Azimuthal Equidistant', group: 'Azimuthal', interactionMode: 'rotate' },
	{ id: 'geoStereographic', label: 'Stereographic', group: 'Azimuthal', interactionMode: 'rotate' },
	{ id: 'geoGnomonic', label: 'Gnomonic', group: 'Azimuthal', interactionMode: 'rotate' },
	{ id: 'geoAiry', label: 'Airy', group: 'Azimuthal', interactionMode: 'rotate' },
	{ id: 'geoWiechel', label: 'Wiechel', group: 'Azimuthal', interactionMode: 'rotate' },

	// Conic
	{ id: 'geoConicEqualArea', label: 'Conic Equal Area', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoConicConformal', label: 'Conic Conformal', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoConicEquidistant', label: 'Conic Equidistant', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoAlbers', label: 'Albers', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoAlbersUsa', label: 'Albers USA', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoBonne', label: 'Bonne', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoPolyconic', label: 'Polyconic', group: 'Conic', interactionMode: 'rotate' },
	{ id: 'geoRectangularPolyconic', label: 'Rectangular Polyconic', group: 'Conic', interactionMode: 'rotate' },

	// Other
	{ id: 'geoHammer', label: 'Hammer', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoAitoff', label: 'Aitoff', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoAugust', label: 'August', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoBaker', label: 'Baker Dinomic', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoBertin1953', label: 'Bertin 1953', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoEisenlohr', label: 'Eisenlohr', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoFoucaut', label: 'Foucaut', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoGilbert', label: 'Gilbert', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoGinzburg4', label: 'Ginzburg IV', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoGinzburg5', label: 'Ginzburg V', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoGinzburg6', label: 'Ginzburg VI', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoGinzburg8', label: 'Ginzburg VIII', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoGinzburg9', label: 'Ginzburg IX', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoLagrange', label: 'Lagrange', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoLarrivee', label: 'Larrivée', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoLaskowski', label: 'Laskowski', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoNicolosi', label: 'Nicolosi', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoSatellite', label: 'Satellite', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoVanDerGrinten', label: 'Van der Grinten', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoVanDerGrinten2', label: 'Van der Grinten II', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoVanDerGrinten3', label: 'Van der Grinten III', group: 'Other', interactionMode: 'pan' },
	{ id: 'geoVanDerGrinten4', label: 'Van der Grinten IV', group: 'Other', interactionMode: 'pan' },

	// Interrupted
	{ id: 'geoInterruptedHomolosine', label: 'Interrupted Homolosine', group: 'Interrupted', interactionMode: 'pan' },
	{ id: 'geoInterruptedMollweide', label: 'Interrupted Mollweide', group: 'Interrupted', interactionMode: 'pan' },
	{ id: 'geoInterruptedMollweideHemispheres', label: 'Interrupted Mollweide Hemispheres', group: 'Interrupted', interactionMode: 'pan' },
	{ id: 'geoInterruptedBoggs', label: 'Interrupted Boggs', group: 'Interrupted', interactionMode: 'pan' },
	{ id: 'geoInterruptedSinusoidal', label: 'Interrupted Sinusoidal', group: 'Interrupted', interactionMode: 'pan' },
	{ id: 'geoInterruptedSinuMollweide', label: 'Interrupted Sinu-Mollweide', group: 'Interrupted', interactionMode: 'pan' },
	{ id: 'geoInterruptedQuarticAuthalic', label: 'Interrupted Quartic Authalic', group: 'Interrupted', interactionMode: 'pan' },

	// Polyhedral
	{ id: 'geoPolyhedralWaterman', label: 'Waterman Butterfly', group: 'Polyhedral', interactionMode: 'pan' },
	{ id: 'geoPolyhedralCollignon', label: 'Polyhedral Collignon', group: 'Polyhedral', interactionMode: 'pan' },
	{ id: 'geoPolyhedralButterfly', label: 'Polyhedral Butterfly', group: 'Polyhedral', interactionMode: 'pan' },
];

// Maps dataset tags to friendly filter labels.
// A dataset's type is determined by the first tag that matches any entry here.
export const TYPE_FILTERS: { label: string; tags: string[] }[] = [
	{ label: 'Regions', tags: ['countries', 'states', 'provinces', 'counties', 'districts', 'regions', 'nuts', 'sovereignty', 'boundaries', 'disputed'] },
	{ label: 'Cities & Places', tags: ['cities', 'towns', 'places', 'urban'] },
	{ label: 'Physical Geography', tags: ['coastline', 'rivers', 'lakes', 'ocean', 'reefs', 'glaciers', 'ice', 'islands', 'land'] },
	{ label: 'Infrastructure', tags: ['roads', 'railroads', 'airports', 'ports', 'transport'] },
	{ label: 'Utilities', tags: ['time-zones', 'geographic', 'reference'] },
];

// Source badge display config — label and colors per data source.
export const SOURCE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
	'natural-earth': { label: 'Natural Earth', bg: 'var(--grey-200)', text: 'var(--grey-700)' },
	'tiger': { label: 'US Census', bg: 'var(--grey-200)', text: 'var(--grey-700)' },
	'eurostat': { label: 'Eurostat', bg: 'var(--grey-200)', text: 'var(--grey-700)' },
	'project-linework': { label: 'Project Linework', bg: 'var(--grey-200)', text: 'var(--grey-700)' },
	'custom': { label: 'Custom', bg: 'var(--grey-200)', text: 'var(--grey-700)' },
};

// Friendly labels for admin levels.
export const ADMIN_LEVEL_LABELS: Record<number, string> = {
	0: 'Country',
	1: 'State / Province',
	2: 'County / District',
	3: 'Sub-district',
};

// Defines the display order of sources in the catalog list.
export const SOURCE_ORDER: string[] = [
	'natural-earth',
	'tiger',
	'eurostat',
	'project-linework',
	'custom',
];

export const POINT_SHAPES: { id: string; label: string }[] = [
	{ id: 'symbolCircle',   label: 'Circle'   },
	{ id: 'symbolSquare',   label: 'Square'   },
	{ id: 'symbolDiamond',  label: 'Diamond'  },
	{ id: 'symbolTriangle', label: 'Triangle' },
	{ id: 'symbolCross',    label: 'Cross'    },
	{ id: 'symbolStar',     label: 'Star'     },
	{ id: 'symbolWye',      label: 'Wye'      },
];

export const REGION_FILTERS: string[] = [
	'World',
	'Africa',
	'Asia',
	'Europe',
	'North America',
	'South America',
	'Oceania',
	'USA',
];
