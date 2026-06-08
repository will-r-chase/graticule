<script lang="ts">
	import * as d3 from 'd3-geo';
	// d3-geo-projection ships no TypeScript types
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-expect-error
	import * as d3proj from 'd3-geo-projection';

	let { size = 78 }: { size?: number } = $props();

	const sphere = { type: 'Sphere' } as const;
	const graticuleData = d3.geoGraticule().step([45, 45])();

	let projection = $derived(
		(d3proj.geoPolyhedralWaterman() as d3.GeoProjection).fitSize([size, size], sphere)
	);

	let pathGen = $derived(d3.geoPath(projection));
	let sphereD = $derived(pathGen(sphere) ?? '');
	let graticuleD = $derived(pathGen(graticuleData) ?? '');
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	aria-label="Graticule logo"
	role="img"
>
	<defs>
		<clipPath id="graticule-logo-clip">
			<path d={sphereD} />
		</clipPath>
	</defs>

	<!-- Fill -->
	<path d={sphereD} fill="var(--color-surface-primary)" stroke="none" />

	<!-- Graticule lines, clipped to butterfly boundary -->
	<path
		d={graticuleD}
		fill="none"
		stroke="currentColor"
		stroke-width="0.5"
		clip-path="url(#graticule-logo-clip)"
	/>

	<!-- Butterfly outline -->
	<path
		d={sphereD}
		fill="none"
		stroke="currentColor"
		stroke-width="1"
	/>
</svg>
