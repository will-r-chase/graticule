---
title: Saving & Loading
description: How to save your Graticule project and re-open it later.
---

Graticule project files let you save your work and pick it back up later — or share it with someone else.

## Saving a project

Click **Save** in the top toolbar. Graticule downloads a `.json` file to your machine. This file captures your full project state:

- All layers (names, visibility, order)
- Per-layer styles (fill, stroke, color, width, dash, point shape/size)
- Per-layer processing settings (simplification, smoothing, bezier)
- The current projection
- The background color and opacity

The geometry data itself is **not** embedded in the project file. For catalog datasets, the file stores a reference (the dataset ID) that Graticule re-fetches on load. For uploaded files, the full GeoJSON is included.

This keeps project files small and human-readable — the `.json` is easy to inspect or version-control if needed.

## Loading a project

Click **Open** in the top toolbar and select a `.json` project file. Graticule will restore your layers, styles, and projection exactly as they were.

Catalog layers will be re-fetched from the data source on load, so you'll need an internet connection. Uploaded layers are embedded in the project file and load without a network request.

## Starting fresh

Click **New** in the top toolbar to clear the canvas and start a new project. Graticule will ask you to confirm before clearing. If you have unsaved changes, save first — there's no autosave.

## A note on autosave

Graticule does not currently have autosave. If you close the tab without saving, your work is gone. Get in the habit of saving before you close.
