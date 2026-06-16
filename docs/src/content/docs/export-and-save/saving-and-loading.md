---
title: Saving & Loading
description: How to save your Graticule project and re-open it later.
---

Project files save your work so you can resume later or share with someone else.

## Saving a project

Click **Save** in the top toolbar. Graticule downloads a `.json` file to your machine. This file captures your full project state:

- All layers (names, visibility, order)
- Per-layer styles (fill, stroke, color, width, dash, point shape/size)
- Per-layer processing settings (simplification, smoothing, bezier)
- The current projection
- The background color and opacity

Catalog layers store only a reference (the dataset ID) — geometry is re-fetched from the source on load. Uploaded layers or layers that were mutated by geometric operations embed their full geometry in the project file.

## Loading a project

Click **Open** in the top toolbar and select a `.json` project file. Graticule restores your layers, styles, and projection.

## Starting fresh

Click **New** in the top toolbar to clear the canvas and start a new project. Save any unsaved changes first, Graticule will prompt you for a confirmation.

## A note on autosave

Graticule has no autosave. If you close the tab without saving your progress will be lost.
