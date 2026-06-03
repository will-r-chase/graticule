---
title: Projections
description: How to choose and work with map projections in Graticule.
---

A map projection is a method of representing the curved surface of the Earth on a flat plane. Every projection distorts something — area, shape, distance, or direction — because no flat map can perfectly represent a sphere. The choice of projection is one of the most consequential decisions in making a map.

Graticule supports over 80 projections, grouped by family. You can search by name or browse the grouped list in the **Projection** selector in the right panel.

## Choosing a projection

The right projection depends on your geographic extent and what property you want to preserve:

| Property | What it means | Good for |
|---|---|---|
| **Equal-area** | Areas are correctly proportioned relative to each other | Comparing regions, density maps |
| **Conformal** | Local shapes are preserved (angles are correct) | Navigation, detailed regional maps |
| **Compromise** | Neither area nor shape is perfectly preserved, but both are reasonable | General-purpose world maps |
| **Equidistant** | Distances from a central point or along certain lines are correct | Reference maps, distance-based analysis |
| **Perspective** | Simulates a view from a point in space | Globe views, dramatic presentation |

For **world maps**, compromise projections like Natural Earth, Robinson, or Winkel Tripel are widely used and generally well-regarded. Equal Earth is a newer equal-area option with a natural, pleasing shape.

For **continental or regional maps**, azimuthal or conic projections are usually appropriate. Albers (conic, equal-area) is the standard for the contiguous US. Azimuthal Equal Area works well for polar regions and hemispheric views.

For **country or sub-national maps**, the choice is more situation-dependent. Many countries have an official or conventional projection — if you're making a map for a specific national context, it's worth checking.

## Projection families

**Globe** — `Globe` renders the data on a rotatable sphere. Drag to spin. This is orthographic projection with visual enhancements.

**Cylindrical** — the simplest family. The globe is conceptually "unrolled" onto a cylinder. Mercator is the most familiar; it preserves shape but dramatically inflates area near the poles.

**Pseudocylindrical** — like cylindrical projections but with curved meridians, which reduces distortion. Most general-purpose world map projections fall here (Natural Earth, Robinson, Mollweide, Equal Earth).

**Azimuthal** — project onto a plane that touches the globe at a single point. The view radiates outward from that point. Good for polar views and hemispheric maps. In Graticule, azimuthal projections use drag-to-rotate interaction.

**Conic** — project onto a cone. Good for mid-latitude regions like North America, Europe, or China. Albers and Lambert Conformal Conic are the standards. Conic projections use drag-to-rotate interaction.

**Interrupted** — the globe is "interrupted" and unfolded with cuts, reducing distortion in specific regions at the cost of gaps in others. Goode's Homolosine is the classic example.

**Polyhedral** — unfolds the globe onto a polyhedron. Waterman Butterfly is the most common. Visually striking, rarely used for practical maps.

## Interaction modes

Projections in Graticule have two interaction modes:

**Pan mode** — used by cylindrical, pseudocylindrical, and most flat projections. Drag to pan the canvas, scroll to zoom.

**Rotate mode** — used by Globe, azimuthal, and conic projections. Drag directly on the map to rotate the projection around the globe. The projection rotates so that whatever you drag toward the center becomes the new focal point. Scroll to zoom.

The interaction mode switches automatically when you change projections.
