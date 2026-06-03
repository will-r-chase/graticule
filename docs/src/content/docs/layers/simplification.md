---
title: Simplification & Smoothing
description: How to use Graticule's processing tools to control the detail and feel of linework.
---

Processing controls are in the **Simplification** tab of each layer. All operations are **non-destructive** — the original geometry is preserved and you can adjust or reset at any time.

## Simplification

Simplification reduces vertex count by removing points that contribute least to the shape of a feature. Toggle **Simplify** to enable it, then choose an algorithm and adjust tolerance.

**Tolerance** controls aggressiveness: higher removes more vertices. At 100% almost all detail is gone; at 0% nothing changes.

### Algorithms

**Weighted Visvalingam** (default) — a variant of Visvalingam-Whyatt that applies additional weighting to preserve visually significant points. Tends to produce the most natural-looking results for geographic boundaries.

**Visvalingam-Whyatt** — removes the point that forms the smallest triangle area with its two neighbors, iterating until the tolerance threshold is reached. Handles the overall shape well but does not apply extra weight to any features.

**Douglas-Peucker** — removes points that fall within a perpendicular distance threshold from the simplified line. Produces slightly more angular results and can leave undesirable spikes in some datasets.

**Weight** (Weighted Visvalingam only) — adjusts how strongly significant points are preserved relative to tolerance. Higher values keep more shape character at a given tolerance setting.

**Keep shapes** — prevents small features from being removed entirely during simplification. Without this, islands or small territories may disappear at high tolerance values.

### Topology preservation

Simplification in Graticule is topology-aware, using Mapshaper under the hood. Polygons that share borders — country boundaries, state lines — are simplified consistently so that adjacent edges stay coincident. You won't get gaps or slivers between features at shared borders.

## Smoothing

Chaikin smoothing is a corner-cutting algorithm: at each iteration, it replaces every vertex with two new points positioned at 1/4 and 3/4 along each adjacent segment. The original vertices are removed. This progressively rounds angles and curves straight edges.

Unlike simplification, Chaikin *increases* vertex count. Each iteration roughly doubles it. The tradeoff is smoother curves at the cost of larger geometry.

**Iterations** — number of passes (1–4). Each pass multiplies the vertex count and increases curvature.

Smoothing modifies the coordinates in the working topology, so the result is baked into geodata exports (GeoJSON, Shapefile, etc.).

## Bezier curves

Bezier rendering interpolates curves between existing vertices using spline algorithms, drawing smooth arcs rather than straight line segments. This is computed in screen space — after geographic coordinates are projected to pixels — so it's purely a display treatment.

**Important:** Bezier curves are not encoded in the geometry. GeoJSON, Shapefile, and TopoJSON exports contain the original simplified/smoothed vertices, not the Bezier-interpolated curves. Only SVG and PNG output show them.

Two algorithms are available:

**Catmull-Rom** — fits a curve that passes through each vertex, pulled smoothly toward neighboring points. **Tension** controls tightness (higher = closer to the original line). **Alpha** controls the parameterization of curve speed between points: 0 (uniform), 0.5 (centripetal, recommended — avoids cusps and loops), or 1 (chordal).

**Kochanek-Bartels** — a generalization with three independent parameters per vertex:
- **Tension** — overall tightness of the curve
- **Continuity** — smoothness at each vertex; reducing it introduces kinks
- **Bias** — shifts the direction of the tangent toward or away from the next segment

Because Bezier rendering is screen-space, the visual curve changes as you zoom or change projection. It's well-suited for stylized SVG output but not for representing actual geographic paths.

## Auto-simplification

When a very large dataset is loaded, Graticule may automatically apply a moderate simplification to keep rendering responsive. A notification appears when this happens. You can adjust or remove it from the Simplification tab after loading.
