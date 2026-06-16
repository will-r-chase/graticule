---
title: Projections
description: How to choose and work with map projections in Graticule.
---

A map projection is a method of representing the curved surface of the Earth on a flat plane. Every projection distorts something — area, shape, distance, or direction — because no flat map can perfectly represent a sphere.

Graticule supports over 80 projections, grouped by family. You can search by name or browse the grouped list in the **Projection** selector in canvas panel of the lefthand sidebar.

## Choosing a projection

For **world maps**, compromise projections like Natural Earth, Robinson, or Winkel Tripel are widely used and generally well-regarded. Equal Earth is a newer equal-area option.

For **continental or regional maps**, azimuthal or conic projections are usually appropriate. Albers USA is the standard for the US. Azimuthal Equal Area works well for polar regions and hemispheric views.

For **country or sub-national maps**, the right choice depends on the specific region. Many countries have an official or conventional projection — check before committing to one for a national-context map.

## Projection families

**Globe** — renders the data on a rotatable sphere. Drag to spin.

**Cylindrical** — the simplest family. The globe is conceptually "unrolled" onto a cylinder. Mercator is the most familiar; it preserves shape but dramatically inflates area near the poles.

**Pseudocylindrical** — like cylindrical projections but with curved meridians, which reduces distortion. Most general-purpose world map projections fall here (Natural Earth, Robinson, Mollweide, Equal Earth).

**Azimuthal** — project onto a plane that touches the globe at a single point. The view radiates outward from that point. Good for polar views and hemispheric maps. In Graticule, azimuthal projections use drag-to-rotate interaction.

**Conic** — project onto a cone. Good for mid-latitude regions like North America, Europe, or China. Albers and Lambert Conformal Conic are the standards. Conic projections use drag-to-rotate interaction.

**Interrupted** — the globe is "interrupted" and unfolded with cuts, reducing distortion in specific regions at the cost of gaps in others. 

**Polyhedral** — unfolds the globe onto a polyhedron. Waterman Butterfly is the most common example. 

## Coordinate systems and imported data

Graticule works in **WGS84 (EPSG:4326)** — longitude/latitude in decimal degrees. All data must be in this coordinate system to display correctly.

When you upload a file, Graticule inspects the coordinates. If they fall outside the valid WGS84 range, it warns you that the file is likely in a projected coordinate system (e.g. UTM or State Plane) and will not display correctly. To fix this, re-export the file as WGS84 from your GIS software before uploading.

## Projection engine

Graticule uses [D3-geo](https://d3js.org/d3-geo) for all projection math. This covers the 80+ projections in the selector well, but it is not a full cartographic projection library. You will not find the deep parameter control or obscure local projections available in QGIS or ArcGIS. For highly specialized projection work, those tools are a better fit.
