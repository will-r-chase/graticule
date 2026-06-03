---
title: File Formats
description: Geographic file formats supported by Graticule for upload and export.
---

## Import formats

Graticule accepts the following formats when uploading your own data.

### GeoJSON

The standard open format for geographic data on the web. GeoJSON encodes points, lines, and polygons as JSON, with each feature carrying its geometry and a properties object.

Graticule expects WGS84 coordinates (EPSG:4326), which is the GeoJSON standard — any compliant GeoJSON file should work directly. File extension: `.geojson` or `.json`.

### Shapefile

The most widely used format in traditional GIS. A Shapefile is actually a collection of files (`.shp`, `.dbf`, `.shx`, and often `.prj`). **Upload all of these together as a `.zip` archive.** If the `.prj` file is missing, Graticule will assume WGS84 and warn you.

A Shapefile can only contain one geometry type (points, lines, or polygons). Multi-geometry datasets are split into separate Shapefiles.

### TopoJSON

An extension of GeoJSON that encodes topology — shared borders between features are stored once rather than duplicated. This makes files significantly smaller and ensures that adjacent polygons share exactly the same edge geometry (no gaps or overlaps).

TopoJSON files can contain multiple named objects. If your file has more than one, Graticule will prompt you to choose which to load, or load them all as separate layers. File extension: `.topojson` or `.json`.

### KML / KMZ

The XML-based format used by Google Earth and many other tools. KML files can contain multiple geometry types and are often used for routes, points of interest, and administrative data exported from Google Maps or similar.

KMZ is a zipped KML file. Both are supported. File extension: `.kml` or `.kmz`.

### GPX

The standard format for GPS data — tracks, waypoints, and routes recorded by GPS devices or apps. GPX is XML-based and primarily used for line and point data. File extension: `.gpx`.

### CSV

Tabular data with latitude and longitude columns. After uploading, Graticule will show a column picker so you can identify which columns contain latitude and longitude. CSV data is loaded as a point layer.

Coordinates must be in **decimal degrees** (e.g. `40.7128`, `-74.0060`), not degrees/minutes/seconds. File extension: `.csv`.

---

## Export formats

### SVG

Scalable Vector Graphics — an XML-based vector format. SVG exports from Graticule are structured with one group per layer and can be opened and edited directly in Illustrator, Figma, or Inkscape. Resolution-independent.

### PNG

A rasterized image at the specified scale. Supports transparency. Use for presentations, reports, and anywhere vector isn't supported.
