---
title: File Formats
description: Geographic file formats supported by Graticule for upload and export.
---

## Import formats

Graticule accepts the following formats for upload.

### GeoJSON

The standard open format for geographic data on the web. GeoJSON encodes points, lines, and polygons as JSON; each feature carries its geometry and a properties object.

Graticule expects WGS84 coordinates (EPSG:4326), the GeoJSON standard — any compliant GeoJSON file works without conversion. File extension: `.geojson` or `.json`.

### Shapefile

The most widely used format in traditional GIS. A Shapefile is a collection of files (`.shp`, `.dbf`, `.shx`, and often `.prj`). **Upload all of these together as a `.zip` archive.** If the `.prj` file is missing, Graticule assumes WGS84 and warns you.

A Shapefile holds one geometry type (points, lines, or polygons). Multi-geometry datasets split into separate Shapefiles.

### TopoJSON

An extension of GeoJSON that encodes topology — shared borders are stored once rather than duplicated, making files significantly smaller and guaranteeing adjacent polygons share exactly the same edge geometry with no gaps or overlaps.

TopoJSON files can contain multiple named objects. If your file has more than one, Graticule prompts you to choose which to load, or loads them all as separate layers. File extension: `.topojson` or `.json`.

### KML / KMZ

The XML-based format used by Google Earth and many other tools. KML files can contain multiple geometry types and are common for routes, points of interest, and administrative data exported from Google Maps.

KMZ is a zipped KML file. Both are supported. File extension: `.kml` or `.kmz`.

### GPX

The standard format for GPS data — tracks, waypoints, and routes recorded by GPS devices or apps. GPX is XML-based and primarily used for line and point data. File extension: `.gpx`.

### CSV

Tabular data with latitude and longitude columns. After uploading, Graticule shows a column picker so you can identify the coordinate columns. CSV data loads as a point layer.

Coordinates must be in **decimal degrees** (e.g. `40.7128`, `-74.0060`), not degrees/minutes/seconds. File extension: `.csv`.
