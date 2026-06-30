---
title: Working with Layers
description: How to add, select, edit, and manage layers in Graticule.
---

A layer is the rendered form of a dataset that you can style or perform operations on. Layers are listed in the **Layers panel** on the right side of the screen.

## Adding layers

There are two ways to add a layer.

- **From a data source** — click a dataset in the catalog or upload a file, and Graticule adds it as a layer.
- **As a blank layer** — click the **+** button at the top of the Layers panel to create a layer with no data source. A blank layer opens straight to its **Data** tab, where you can assign a source — any uploaded file or single-layer catalog dataset. You can also leave it source-less and give it geometry by [drawing into it](/canvas-modes/drawing/).

You can change a layer's source at any time from the **Data** tab, and the layer re-renders from the new data while keeping its style. Layers whose geometry you have edited or derived from an operation show as a **Derived dataset**; selecting one of the original sources again restores its clean, unedited geometry.

## Layer order

Layers render bottom to top — the bottom of the list draws first, layers above draw on top. Drag layers in the panel to reorder them or use the keyboard shortcuts `[ ]` with a layer selected.

## Renaming layers

Double-click a layer name to rename it. Press Enter or click away to confirm.

## Toggling visibility

Click the eye icon on any layer or press `H` to hide or show it. Hidden layers stay in your project with their data and settings intact — they just don't render on the canvas.

## Duplicating a layer

Press `Cmd+D` or use the `...` menu to duplicate a layer. The copy has the same style and data as the original and is added directly above it.

## Removing layers

Use `Cmd+delete` or the `...` menu to delete a layer. This can be undone with `Cmd+Z`.

## Undo / Redo

All layer changes — adding, removing, reordering, renaming, and style changes — are undoable. Use `Cmd+Z` to undo and `Cmd+Shift+Z` to redo, or the Undo/Redo buttons in the top toolbar.

The history stack goes back 50 steps.

---

## Selecting layers

Layers can be selected directly from the layers panel by clicking them, or on the canvas while in [Select mode](/canvas-modes/overview/#select-mode).

- **Click** a layer to select it. **Shift+click** to range-select, **Cmd+click** to toggle individual layers in or out.
- Selected layers are highlighted on the canvas with visual feedback tuned to geometry type: bounding box strokes for all types, fill tint and outline thickening for polygons, stroke tint for lines, and halos for points.
- **Click and drag** to create a marquee that will select all layers it intersects.
- **Escape** clears the selection (feature selection clears first, then layer selection).
- An **X button** in the action bar dismisses the selection at any time.
- **Double-clicking** a layer on the map allows you to select features within it.

## The action bar

When one or more layers are selected, a floating action bar appears above the canvas toolbar.

| Action       | What it does                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Dissolve** | Merges all features in the layer into a single geometry.                                              |
| **Explode**  | Splits multi-part features into individual single-part features.                                      |
| **Clip**     | Clips the layer to another layer's extent or to a bounding box.                                       |
| **Subtract** | Subtracts another layer's geometry from the selected layer.                                           |
| **Mosaic**   | Flattens overlapping polygons by converting overlapping areas into separate non-overlapping polygons. |
| **Merge**    | Combines multiple selected layers into one.                                                           |

## The Clip operation

Clip trims a layer to a boundary. Click **Clip** to open a popover with two options:

- **Clip to layer** — choose another layer from the list. Graticule clips the active layer to that layer's outer boundary.
- **Clip to bounding box** — drag handles appear on the canvas. Resize and position the box, then confirm. Graticule clips to the box edges.

The original layer is replaced with the clipped result. Press `Cmd+Z` to undo.
