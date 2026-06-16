---
title: Simplification & Smoothing
description: How to use Graticule's processing tools to control the detail and feel of linework.
---

Processing controls are in the **Simplification** tab of each layer which can be accessed by clicking the controls button that appears when a layer is hovered.

## Simplification

Simplification reduces vertex count by removing points that contribute least to the shape of a feature, this is useful when you have highly detailed data that may be too dense for the viewing size or zoom level you intend; it also helps greatly to reduce data size and therefore improve performance. 

Toggle **Simplify** to enable it, then choose an algorithm and adjust tolerance. **Tolerance** controls aggressiveness: higher removes more vertices. At 100% almost all detail is gone; at 0% nothing changes.

### Algorithms

**Weighted Visvalingam** (default) — a variant of Visvalingam-Whyatt that applies additional weighting to preserve visually significant points. Produces the most natural-looking results for geographic boundaries.

**Visvalingam-Whyatt** — removes the point forming the smallest triangle area with its two neighbors, iterating until the tolerance threshold is reached. Handles overall shape well but applies no extra weight to any features.

**Douglas-Peucker** — removes points within a perpendicular distance threshold from the simplified line. Produces slightly more angular results and can leave undesirable spikes in some datasets.

**Weight** (Weighted Visvalingam only) — adjusts how strongly significant points are preserved relative to tolerance. Higher values keep more shape character at a given tolerance setting.

**Keep shapes** — preserves small features that would otherwise vanish at high tolerance values, such as islands or small territories.

### Topology preservation

Simplification in Graticule is topology-aware, using Mapshaper under the hood. Polygons that share borders — country boundaries, state lines — simplify consistently, so adjacent edges stay coincident with no gaps or slivers.

## Smoothing

Chaikin smoothing is a corner-cutting algorithm. At each iteration it replaces every vertex with two new points at 1/4 and 3/4 along each adjacent segment, removing the original vertices. This progressively rounds angles and curves straight edges.

Unlike simplification, Chaikin increases vertex count — each iteration roughly doubles it. The result is smoother curves at the cost of larger geometry.

**Iterations** — number of passes (1–4). Each pass multiplies the vertex count and increases curvature.

Smoothing modifies the coordinates in the working topology, so the result is baked into geodata exports (GeoJSON, Shapefile, etc.).

## Bezier curves

Bezier rendering interpolates curves between existing vertices using spline algorithms, drawing smooth arcs rather than straight line segments. Graticule computes this in screen space — after geographic coordinates project to pixels — this is advantageous because it does not require increasing the vertex count of your dataset, and it means the curves will be present at any scale. Smoothing techniques that iteratively divide a line to add more verticies will still result in a set of points connected by straight lines, so at high zoom levels you may still see a sharp or chunky appearance, no matter how much you smooth it, but bezier curves do not have this issue.

**Important:** Bezier curves are not encoded in the underlying data. Only SVG and PNG output show the Bezier-interpolated curves.

Three algorithms are available:

**Catmull-Rom** — fits a curve that passes through each vertex, pulled smoothly toward neighboring points. **Tension** controls tightness (higher = closer to the original line). **Alpha** controls the parameterization of curve speed between points: 0 (uniform), 0.5 (centripetal, recommended — avoids cusps and loops), or 1 (chordal).

**B-Spline** — produces a smooth curve that approximates the control points rather than passing through them. The result is generally smoother than Catmull-Rom but will not follow the original vertices exactly.

**Kochanek-Bartels** — a generalization with three independent parameters per vertex:

- **Tension** — overall tightness of the curve
- **Continuity** — smoothness at each vertex; reducing it introduces kinks
- **Bias** — shifts the direction of the tangent toward or away from the next segment

## Auto-simplification

When you load a very large dataset, Graticule may automatically apply a moderate simplification to keep rendering responsive. A notification appears when this happens. Adjust or remove it from the Simplification tab after loading.
