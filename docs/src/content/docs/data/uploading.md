---
title: Uploading Your Own Data
description: How to bring your own geographic data into Graticule.
---

In addition to the built-in catalog, you can upload your own geographic files.

## How to upload

Click **Upload** in the top toolbar, or drag and drop a file anywhere onto the map canvas. The upload modal will open.

Graticule will inspect the file, detect the geometry type, and add it as a new layer. If it can't determine the coordinate system, it will prompt you.

## Supported formats

| Format | Notes |
|---|---|
| **GeoJSON** | `.geojson` or `.json`. Graticule expects WGS84 (EPSG:4326) coordinates, which is the GeoJSON standard. |
| **Shapefile** | Upload as a `.zip` containing the `.shp`, `.dbf`, and `.prj` files together. |
| **TopoJSON** | `.topojson` or `.json`. Multi-object topologies are supported — each object becomes a layer. |
| **KML / KMZ** | Google Earth format. `.kmz` is the zipped version; both are supported. |
| **GPX** | GPS track format. Common for route and track data. |
| **CSV** | Must have columns containing latitude and longitude values. Graticule will prompt you to identify which columns are which. |

See [File Formats](/reference/file-formats) for a fuller breakdown of what's supported in each format.

## Coordinate systems

Graticule stores all data internally in WGS84 (the standard lat/lon coordinate system). If your file uses a different projection or coordinate reference system — for example, a State Plane Shapefile or a UTM-projected file — Graticule will attempt to detect this from the `.prj` file (for Shapefiles) or from the coordinate range.

If detection fails or the data loads in the wrong place, Graticule will show a warning. You may need to reproject your file to WGS84 before uploading. QGIS and ogr2ogr both handle this quickly.

## CSV files

When uploading a CSV, Graticule will prompt you to select which columns contain the latitude and longitude values. Once you confirm, the rows are converted to point features and loaded as a layer.

CSV upload expects **decimal degrees** — not degrees/minutes/seconds.

## Splitting multi-geometry files

Some files mix multiple geometry types (points, lines, and polygons in the same file). Graticule can optionally split these into separate layers, one per geometry type. You'll be prompted when this situation is detected.
