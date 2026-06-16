// All available projections. The `id` matches the d3-geo / d3-geo-projection
// function name (except `geoGlobe` which maps to `geoOrthographic` with visual
// decoration). `group` is used by the Combobox to render section headers.
export type ProjectionProperty = 'equal-area' | 'conformal' | 'compromise' | 'perspective' | 'equidistant';

export type ProjectionEntry = {
	id: string;
	label: string;
	group: string;
	interactionMode: 'pan' | 'rotate';
	property: ProjectionProperty;
	parallels?: [number, number];
	isGlobe?: true;
};

export const PROJECTIONS: ProjectionEntry[] = [
	// Globe
	{ id: 'geoGlobe', label: 'Globe', group: 'Globe', interactionMode: 'rotate', property: 'perspective', isGlobe: true },

	// Cylindrical
	{ id: 'geoMercator',              label: 'Mercator',              group: 'Cylindrical', interactionMode: 'pan',    property: 'conformal'   },
	{ id: 'geoEquirectangular',       label: 'Equirectangular',       group: 'Cylindrical', interactionMode: 'pan',    property: 'equidistant' },
	{ id: 'geoMiller',                label: 'Miller',                group: 'Cylindrical', interactionMode: 'pan',    property: 'compromise'  },
	{ id: 'geoTransverseMercator',    label: 'Transverse Mercator',   group: 'Cylindrical', interactionMode: 'pan',    property: 'conformal'   },
	{ id: 'geoCylindricalEqualArea',  label: 'Cylindrical Equal Area',group: 'Cylindrical', interactionMode: 'pan',    property: 'equal-area'  },
	{ id: 'geoCylindricalStereographic', label: 'Cylindrical Stereographic', group: 'Cylindrical', interactionMode: 'pan', property: 'perspective' },

	// Pseudocylindrical
	{ id: 'geoNaturalEarth1',           label: 'Natural Earth',                           group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoNaturalEarth2',           label: 'Natural Earth II',                        group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoEqualEarth',              label: 'Equal Earth',                             group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoRobinson',                label: 'Robinson',                                group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoWinkel3',                 label: 'Winkel Tripel',                           group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoMollweide',               label: 'Mollweide',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoEckert1',                 label: 'Eckert I',                                group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoEckert2',                 label: 'Eckert II',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoEckert3',                 label: 'Eckert III',                              group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoEckert4',                 label: 'Eckert IV',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoEckert5',                 label: 'Eckert V',                                group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoEckert6',                 label: 'Eckert VI',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoPatterson',               label: 'Patterson',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoKavrayskiy7',             label: 'Kavrayskiy VII',                          group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoSinusoidal',              label: 'Sinusoidal',                              group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoSinuMollweide',           label: 'Sinu-Mollweide',                          group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoBoggs',                   label: 'Boggs Eumorphic',                         group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoBromley',                 label: 'Bromley',                                 group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoCraster',                 label: 'Craster Parabolic',                       group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoHomolosine',              label: 'Goode Homolosine',                        group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoMtFlatPolarParabolic',    label: 'McBryde–Thomas Flat-Polar Parabolic',     group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoMtFlatPolarQuartic',      label: 'McBryde–Thomas Flat-Polar Quartic',       group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoMtFlatPolarSinusoidal',   label: 'McBryde–Thomas Flat-Polar Sinusoidal',    group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoNellHammer',              label: 'Nell–Hammer',                             group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoCollignon',               label: 'Collignon',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoFahey',                   label: 'Fahey',                                   group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoLoximuthal',              label: 'Loximuthal',                              group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoTimes',                   label: 'Times',                                   group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoWagner4',                 label: 'Wagner IV',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoWagner6',                 label: 'Wagner VI',                               group: 'Pseudocylindrical', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoWagner',                  label: 'Wagner VII',                              group: 'Pseudocylindrical', interactionMode: 'pan', property: 'equal-area'  },

	// Azimuthal
	{ id: 'geoOrthographic',        label: 'Orthographic',        group: 'Azimuthal', interactionMode: 'rotate', property: 'perspective'  },
	{ id: 'geoAzimuthalEqualArea',  label: 'Azimuthal Equal Area',group: 'Azimuthal', interactionMode: 'rotate', property: 'equal-area'   },
	{ id: 'geoAzimuthalEquidistant',label: 'Azimuthal Equidistant',group: 'Azimuthal',interactionMode: 'rotate', property: 'equidistant'  },
	{ id: 'geoStereographic',       label: 'Stereographic',       group: 'Azimuthal', interactionMode: 'rotate', property: 'conformal'    },
	{ id: 'geoGnomonic',            label: 'Gnomonic',            group: 'Azimuthal', interactionMode: 'rotate', property: 'perspective'  },
	{ id: 'geoAiry',                label: 'Airy',                group: 'Azimuthal', interactionMode: 'rotate', property: 'compromise'   },
	{ id: 'geoWiechel',             label: 'Wiechel',             group: 'Azimuthal', interactionMode: 'rotate', property: 'equal-area'   },

	// Conic
	{ id: 'geoConicEqualArea',       label: 'Conic Equal Area',       group: 'Conic', interactionMode: 'rotate', property: 'equal-area',  parallels: [29.5, 45.5] },
	{ id: 'geoConicConformal',       label: 'Conic Conformal',        group: 'Conic', interactionMode: 'rotate', property: 'conformal',   parallels: [29.5, 45.5] },
	{ id: 'geoConicEquidistant',     label: 'Conic Equidistant',      group: 'Conic', interactionMode: 'rotate', property: 'equidistant', parallels: [29.5, 45.5] },
	{ id: 'geoAlbers',               label: 'Albers',                 group: 'Conic', interactionMode: 'rotate', property: 'equal-area',  parallels: [29.5, 45.5] },
	{ id: 'geoAlbersUsa',            label: 'Albers USA',             group: 'Conic', interactionMode: 'pan',    property: 'equal-area'   },
	{ id: 'geoBonne',                label: 'Bonne',                  group: 'Conic', interactionMode: 'rotate', property: 'equal-area'   },
	{ id: 'geoPolyconic',            label: 'Polyconic',              group: 'Conic', interactionMode: 'rotate', property: 'compromise'   },
	{ id: 'geoRectangularPolyconic', label: 'Rectangular Polyconic',  group: 'Conic', interactionMode: 'rotate', property: 'compromise'   },

	// Other
	{ id: 'geoHammer',        label: 'Hammer',           group: 'Other', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoAitoff',        label: 'Aitoff',           group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoAugust',        label: 'August',           group: 'Other', interactionMode: 'pan', property: 'conformal'   },
	{ id: 'geoBaker',         label: 'Baker Dinomic',    group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoBertin1953',    label: 'Bertin 1953',      group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoEisenlohr',     label: 'Eisenlohr',        group: 'Other', interactionMode: 'pan', property: 'conformal'   },
	{ id: 'geoFoucaut',       label: 'Foucaut',          group: 'Other', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoGilbert',       label: 'Gilbert',          group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoGinzburg4',     label: 'Ginzburg IV',      group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoGinzburg5',     label: 'Ginzburg V',       group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoGinzburg6',     label: 'Ginzburg VI',      group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoGinzburg8',     label: 'Ginzburg VIII',    group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoGinzburg9',     label: 'Ginzburg IX',      group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoLagrange',      label: 'Lagrange',         group: 'Other', interactionMode: 'pan', property: 'conformal'   },
	{ id: 'geoLarrivee',      label: 'Larrivée',         group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoLaskowski',     label: 'Laskowski',        group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoNicolosi',      label: 'Nicolosi',         group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoSatellite',     label: 'Satellite',        group: 'Other', interactionMode: 'pan', property: 'perspective' },
	{ id: 'geoVanDerGrinten', label: 'Van der Grinten',  group: 'Other', interactionMode: 'pan', property: 'compromise'  },
	{ id: 'geoVanDerGrinten2',label: 'Van der Grinten II',  group: 'Other', interactionMode: 'pan', property: 'compromise' },
	{ id: 'geoVanDerGrinten3',label: 'Van der Grinten III', group: 'Other', interactionMode: 'pan', property: 'compromise' },
	{ id: 'geoVanDerGrinten4',label: 'Van der Grinten IV',  group: 'Other', interactionMode: 'pan', property: 'compromise' },

	// Interrupted
	{ id: 'geoInterruptedHomolosine',           label: 'Interrupted Homolosine',            group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },
	{ id: 'geoInterruptedMollweide',            label: 'Interrupted Mollweide',             group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },
	{ id: 'geoInterruptedMollweideHemispheres', label: 'Interrupted Mollweide Hemispheres', group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },
	{ id: 'geoInterruptedBoggs',                label: 'Interrupted Boggs',                 group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },
	{ id: 'geoInterruptedSinusoidal',           label: 'Interrupted Sinusoidal',            group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },
	{ id: 'geoInterruptedSinuMollweide',        label: 'Interrupted Sinu-Mollweide',        group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },
	{ id: 'geoInterruptedQuarticAuthalic',      label: 'Interrupted Quartic Authalic',      group: 'Interrupted', interactionMode: 'pan', property: 'equal-area' },

	// Polyhedral
	{ id: 'geoPolyhedralWaterman',  label: 'Waterman Butterfly',   group: 'Polyhedral', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoPolyhedralCollignon', label: 'Polyhedral Collignon', group: 'Polyhedral', interactionMode: 'pan', property: 'equal-area'  },
	{ id: 'geoPolyhedralButterfly', label: 'Polyhedral Butterfly', group: 'Polyhedral', interactionMode: 'pan', property: 'compromise'  },
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
