---
title: Uploading Your Own Data
description: How to bring your own geographic data into Graticule.
---

In addition to the built-in catalog, you can upload your own geographic data.

## How to upload

Click **Upload** in the top toolbar, or drag and drop a file anywhere onto the map canvas to open the upload modal.

## Supported formats

| Format        | Notes                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| **GeoJSON**   | `.geojson` or `.json`. Graticule expects WGS84 (EPSG:4326) coordinates, which is the GeoJSON standard.         |
| **Shapefile** | Upload as a `.zip` containing the `.shp`, `.dbf`, and `.prj` files together.                                   |
| **TopoJSON**  | `.topojson` or `.json`. Passed through as-is — no re-conversion.                                               |
| **KML / KMZ** | Google Earth format. `.kmz` is the zipped version; both are supported.                                         |
| **GPX**       | GPS track format. Common for route and track data.                                                             |
| **CSV**       | Must have columns containing latitude and longitude values. Graticule detects or prompts you to identify them. |

See [File Formats](/reference/file-formats) for a fuller breakdown of what's supported in each format.

## What happens during upload

Graticule runs the file through a processing pipeline before adding it to the map.

### Winding order

GeoJSON requires polygon rings to follow a specific winding order (outer rings counterclockwise, holes clockwise). Many files in the wild get this wrong. Graticule silently corrects winding order on all uploaded polygons — an info notice appears if any corrections were made.

### Coordinate validation

Graticule inspects the coordinate values in your file:

- **Swapped coordinates** — if the x-values look like latitudes and y-values exceed the valid latitude range, Graticule flags the file as likely having lat/lon swapped. You can apply the swap fix in the upload modal before importing.
- **Projected coordinates** — if the values fall outside the WGS84 range entirely (longitude ±180, latitude ±90), the file is likely in a projected coordinate system such as UTM or State Plane. Graticule shows a blocking error. To fix this you must reproject to WGS84 before uploading using a tool such as QGIS or GDAL.

#### Shapefiles

Shapefiles include a `.prj` file that describes the coordinate system. If the `.prj` is missing, Graticule assumes WGS84 and shows a warning. If the data loads in the wrong place, re-export with the projection file included.

### Structural validation

Graticule checks for common GeoJSON issues such as unclosed polygon rings. These are reported as warnings — they may not prevent the file from loading, but they indicate the data has problems worth investigating at the source.

### Mixed geometry types

Some files contain points, lines, and polygons together. Graticule detects this and offers to either import everything as a single layer or split into separate layers by geometry type.

### Conversion to TopoJSON

After parsing and fixing, Graticule converts your data to TopoJSON using Mapshaper. TopoJSON encodes topology — shared borders between adjacent features — which is what makes operations like simplification and smoothing work correctly across feature boundaries. All data in Graticule is stored and processed as TopoJSON internally; the original GeoJSON is not retained after import.

TopoJSON files uploaded directly skip this step and are passed through as-is.

## CSV files

Graticule auto-detects latitude and longitude columns by name (common variants like `lat`, `latitude`, `y`, `lon`, `lng`, `longitude`, `x`). If detection succeeds, it shows you which columns it found so you can confirm. If it can't detect them, you choose the columns manually before importing.

CSV upload expects **decimal degrees** — not degrees/minutes/seconds.
