// All available projections. The `id` matches the d3-geo / d3-geo-projection
// function name. `group` is used by the Combobox to render section headers.
export const PROJECTIONS: { id: string; label: string; group: string }[] = [
	// Cylindrical
	{ id: 'geoMercator', label: 'Mercator', group: 'Cylindrical' },
	{ id: 'geoEquirectangular', label: 'Equirectangular', group: 'Cylindrical' },
	{ id: 'geoMiller', label: 'Miller', group: 'Cylindrical' },
	{ id: 'geoTransverseMercator', label: 'Transverse Mercator', group: 'Cylindrical' },
	{ id: 'geoCylindricalEqualArea', label: 'Cylindrical Equal Area', group: 'Cylindrical' },
	{ id: 'geoCylindricalStereographic', label: 'Cylindrical Stereographic', group: 'Cylindrical' },

	// Pseudocylindrical
	{ id: 'geoNaturalEarth1', label: 'Natural Earth', group: 'Pseudocylindrical' },
	{ id: 'geoNaturalEarth2', label: 'Natural Earth II', group: 'Pseudocylindrical' },
	{ id: 'geoEqualEarth', label: 'Equal Earth', group: 'Pseudocylindrical' },
	{ id: 'geoRobinson', label: 'Robinson', group: 'Pseudocylindrical' },
	{ id: 'geoWinkel3', label: 'Winkel Tripel', group: 'Pseudocylindrical' },
	{ id: 'geoMollweide', label: 'Mollweide', group: 'Pseudocylindrical' },
	{ id: 'geoEckert1', label: 'Eckert I', group: 'Pseudocylindrical' },
	{ id: 'geoEckert2', label: 'Eckert II', group: 'Pseudocylindrical' },
	{ id: 'geoEckert3', label: 'Eckert III', group: 'Pseudocylindrical' },
	{ id: 'geoEckert4', label: 'Eckert IV', group: 'Pseudocylindrical' },
	{ id: 'geoEckert5', label: 'Eckert V', group: 'Pseudocylindrical' },
	{ id: 'geoEckert6', label: 'Eckert VI', group: 'Pseudocylindrical' },
	{ id: 'geoPatterson', label: 'Patterson', group: 'Pseudocylindrical' },
	{ id: 'geoKavrayskiy7', label: 'Kavrayskiy VII', group: 'Pseudocylindrical' },
	{ id: 'geoSinusoidal', label: 'Sinusoidal', group: 'Pseudocylindrical' },
	{ id: 'geoSinuMollweide', label: 'Sinu-Mollweide', group: 'Pseudocylindrical' },
	{ id: 'geoBoggs', label: 'Boggs Eumorphic', group: 'Pseudocylindrical' },
	{ id: 'geoBromley', label: 'Bromley', group: 'Pseudocylindrical' },
	{ id: 'geoCraster', label: 'Craster Parabolic', group: 'Pseudocylindrical' },
	{ id: 'geoHomolosine', label: 'Goode Homolosine', group: 'Pseudocylindrical' },
	{ id: 'geoMtFlatPolarParabolic', label: 'McBryde–Thomas Flat-Polar Parabolic', group: 'Pseudocylindrical' },
	{ id: 'geoMtFlatPolarQuartic', label: 'McBryde–Thomas Flat-Polar Quartic', group: 'Pseudocylindrical' },
	{ id: 'geoMtFlatPolarSinusoidal', label: 'McBryde–Thomas Flat-Polar Sinusoidal', group: 'Pseudocylindrical' },
	{ id: 'geoNellHammer', label: 'Nell–Hammer', group: 'Pseudocylindrical' },
	{ id: 'geoCollignon', label: 'Collignon', group: 'Pseudocylindrical' },
	{ id: 'geoFahey', label: 'Fahey', group: 'Pseudocylindrical' },
	{ id: 'geoLoximuthal', label: 'Loximuthal', group: 'Pseudocylindrical' },
	{ id: 'geoTimes', label: 'Times', group: 'Pseudocylindrical' },
	{ id: 'geoWagner4', label: 'Wagner IV', group: 'Pseudocylindrical' },
	{ id: 'geoWagner6', label: 'Wagner VI', group: 'Pseudocylindrical' },
	{ id: 'geoWagner', label: 'Wagner VII', group: 'Pseudocylindrical' },

	// Azimuthal
	{ id: 'geoOrthographic', label: 'Orthographic', group: 'Azimuthal' },
	{ id: 'geoAzimuthalEqualArea', label: 'Azimuthal Equal Area', group: 'Azimuthal' },
	{ id: 'geoAzimuthalEquidistant', label: 'Azimuthal Equidistant', group: 'Azimuthal' },
	{ id: 'geoStereographic', label: 'Stereographic', group: 'Azimuthal' },
	{ id: 'geoGnomonic', label: 'Gnomonic', group: 'Azimuthal' },
	{ id: 'geoAiry', label: 'Airy', group: 'Azimuthal' },
	{ id: 'geoWiechel', label: 'Wiechel', group: 'Azimuthal' },

	// Conic
	{ id: 'geoConicEqualArea', label: 'Conic Equal Area', group: 'Conic' },
	{ id: 'geoConicConformal', label: 'Conic Conformal', group: 'Conic' },
	{ id: 'geoConicEquidistant', label: 'Conic Equidistant', group: 'Conic' },
	{ id: 'geoAlbers', label: 'Albers', group: 'Conic' },
	{ id: 'geoAlbersUsa', label: 'Albers USA', group: 'Conic' },
	{ id: 'geoBonne', label: 'Bonne', group: 'Conic' },
	{ id: 'geoPolyconic', label: 'Polyconic', group: 'Conic' },
	{ id: 'geoRectangularPolyconic', label: 'Rectangular Polyconic', group: 'Conic' },

	// Other
	{ id: 'geoHammer', label: 'Hammer', group: 'Other' },
	{ id: 'geoAitoff', label: 'Aitoff', group: 'Other' },
	{ id: 'geoAugust', label: 'August', group: 'Other' },
	{ id: 'geoBaker', label: 'Baker Dinomic', group: 'Other' },
	{ id: 'geoBertin1953', label: 'Bertin 1953', group: 'Other' },
	{ id: 'geoEisenlohr', label: 'Eisenlohr', group: 'Other' },
	{ id: 'geoFoucaut', label: 'Foucaut', group: 'Other' },
	{ id: 'geoGilbert', label: 'Gilbert', group: 'Other' },
	{ id: 'geoGinzburg4', label: 'Ginzburg IV', group: 'Other' },
	{ id: 'geoGinzburg5', label: 'Ginzburg V', group: 'Other' },
	{ id: 'geoGinzburg6', label: 'Ginzburg VI', group: 'Other' },
	{ id: 'geoGinzburg8', label: 'Ginzburg VIII', group: 'Other' },
	{ id: 'geoGinzburg9', label: 'Ginzburg IX', group: 'Other' },
	{ id: 'geoLagrange', label: 'Lagrange', group: 'Other' },
	{ id: 'geoLarrivee', label: 'Larrivée', group: 'Other' },
	{ id: 'geoLaskowski', label: 'Laskowski', group: 'Other' },
	{ id: 'geoNicolosi', label: 'Nicolosi', group: 'Other' },
	{ id: 'geoSatellite', label: 'Satellite', group: 'Other' },
	{ id: 'geoVanDerGrinten', label: 'Van der Grinten', group: 'Other' },
	{ id: 'geoVanDerGrinten2', label: 'Van der Grinten II', group: 'Other' },
	{ id: 'geoVanDerGrinten3', label: 'Van der Grinten III', group: 'Other' },
	{ id: 'geoVanDerGrinten4', label: 'Van der Grinten IV', group: 'Other' },

	// Interrupted
	{ id: 'geoInterruptedHomolosine', label: 'Interrupted Homolosine', group: 'Interrupted' },
	{ id: 'geoInterruptedMollweide', label: 'Interrupted Mollweide', group: 'Interrupted' },
	{ id: 'geoInterruptedMollweideHemispheres', label: 'Interrupted Mollweide Hemispheres', group: 'Interrupted' },
	{ id: 'geoInterruptedBoggs', label: 'Interrupted Boggs', group: 'Interrupted' },
	{ id: 'geoInterruptedSinusoidal', label: 'Interrupted Sinusoidal', group: 'Interrupted' },
	{ id: 'geoInterruptedSinuMollweide', label: 'Interrupted Sinu-Mollweide', group: 'Interrupted' },
	{ id: 'geoInterruptedQuarticAuthalic', label: 'Interrupted Quartic Authalic', group: 'Interrupted' },

	// Polyhedral
	{ id: 'geoPolyhedralWaterman', label: 'Waterman Butterfly', group: 'Polyhedral' },
	{ id: 'geoPolyhedralCollignon', label: 'Polyhedral Collignon', group: 'Polyhedral' },
	{ id: 'geoPolyhedralButterfly', label: 'Polyhedral Butterfly', group: 'Polyhedral' },
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
