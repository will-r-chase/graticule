---
title: Working with Features
description: How to select and work with individual features in Graticule.
---

A feature is a single geographic entity within a layer — one country in a countries layer, one river in a rivers layer. Layers hold collections of features.

Most real work in Graticule happens at the layer level. Styling, simplification, and geoprocessing operations like Clip, Dissolve, and Mosaic all operate on whole layers. The main thing you can do with an individual feature is extract it to a new layer, and then apply whatever operations you need on that layer.

## Entering feature selection

Double-click a layer on the canvas to enter feature selection mode. The canvas dims all other layers, and you can now select individual features within the active layer.

Press `Escape` to exit feature selection and return to layer selection.

## Selecting features

With a layer active in feature selection mode:

- **Click** a feature to select it.
- **Cmd+click** — toggle a single feature in or out of the selection.
- **Cmd+drag** — draw a marquee to select all features it intersects.
- **Hover** over a feature to preview its properties before selecting.

Selected features appear in the **Features panel**, grouped by layer.

At any time while in selection mode, you can also hold **Cmd** to by pass layer selection and directly select features, either by clicking them or by draggin a marquee.

## Feature operations

When features are selected, the action bar offers:

| Action                 | What it does                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| **Copy to layer**      | Copies the selected features into a new layer.                         |
| **Merge to new layer** | Merges selected features from multiple layers into a single new layer. |
| **Delete**             | Removes the selected features from the layer.                          |
