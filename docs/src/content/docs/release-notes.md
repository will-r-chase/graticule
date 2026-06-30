---
title: Release Notes
---

## June 29, 2026

**Drawing**

This release introduces the Draw tool for creating your own features directly on the map, along with a new Data tab for switching a layer's source and a button for creating empty layers.

### New Features

#### Drawing

You can now draw your own features directly on the map.

- Pick the Draw tool from the toolbar (**D**), then choose a geometry type from the bar at the bottom: **polygon**, **line**, or **point**.
- For points, each click drops a point. For lines and polygons, click to place each vertex and double-click to finish the shape. Finished shapes stay on the map while you keep drawing more.
- Press **Enter** to finish the current shape, or **Esc** to cancel it — press **Esc** again to clear everything you have drawn this session.
- Press **Cmd/Ctrl-Z** to remove the last vertex you placed, and **Cmd/Ctrl-Shift-Z** to put it back.
- Hold **Shift** while drawing to lock each edge to the nearest 15° step, so you can draw right angles and regular shapes cleanly.
- Turn on the magnet button to snap each vertex to existing vertices, whether on visible layers or on the shape you are drawing.
- While you draw a polygon, Graticule highlights any edges that cross and stops you from finishing a shape that crosses itself.
- New shapes go to a new layer by default. Choose **Target layer** to draw into an existing layer instead, or **New layer** to switch back. Click **Done** to commit your work.

#### Layer Data

- The new **Data** tab within the layer settings shows a layer's data source and lets you switch it to another uploaded or catalog dataset.
- Layers you have edited show as a **Derived dataset**; selecting an original source again restores its clean geometry.
- The new **+** button at the top of the Layers panel creates an empty layer for which you can select a data source.

---

## June 20, 2026

**Vertex Editing**

This release introduces the Edit tool for reshaping features by moving their vertices directly on the map, alongside layer panel and SVG export improvements and a round of bug fixes.

### New Features

#### Vertex Editing

The new Edit tool lets you reshape features by moving their vertices directly on the map.

- Choose the Edit tool from the toolbar (**E**), then double-click a feature — or select it and click **Edit** in the action bar — to start editing its vertices.
- Drag a vertex to move it, or click a vertex to select it. Shift-click to select multiple vertices, or **Cmd/Ctrl-drag** to create a marquee around several vertices at once, then drag the group to move them as one.
- You can also nudge the selection with the **arrow keys** one pixel at a time, or ten pixels at a time while holding `Shift`.
- Hover an edge and click the marker that appears in the middle to add a vertex.
- Remove unwanted vertices with **Delete** or the Delete button.
- Press **Enter** to finish editing or **Esc** to cancel, matching the Done and Cancel buttons in the editing bar. If you double click away while editing a feature it will commit your edits and exit the editing state.
- Editing a simplified or smoothed layer will prompt you to "bake" your settings into a new layer first, so you can edit the feature while maintaining Graticule's non-destructive principle.

### Improvements

#### Layer Panel

- Layer swatches now reflect the geometry type of each layer: polygon layers show a filled square, line layers show a diagonal line, and point layers show a circle.
- The style swatch now opens the Style tab; the settings button opens the Simplify tab—you can still swap between them at any time.

#### SVG Export

- Each layer now exports as its own named group, matching the layer name in the panel. Features export as individual paths rather than a single compound path per layer. Paths are named from each feature's `name` or `label` property when available.
- Layer stacking order now matches the app. Previously, layers could appear in the wrong order in the exported file.

### Bug Fixes

#### Features Table

- Opening the features table for a large dataset (tens of thousands of rows) no longer freezes or crashes the app.

#### Layer Renaming

- Double-clicking a layer name to rename it now selects all text immediately, so you can start typing without clearing the field manually.
- Fixed several bugs where clicking in the layers panel while editing a name had unexpected behavior.

#### Layer Panel

- Deleting a layer from its **...** menu now clears the selection.
- Closing the style accordion by clicking away from a layer now collapses the panel.

#### Albers USA Projection

- Selecting the Albers USA projection no longer crashes the app.
- Bezier smoothing on Albers USA now renders correctly.

---

## June 15, 2026

**Layer Selection, Geoprocessing & Data Table**

This release makes Graticule significantly more capable for data-aware and geoprocessing workflows. It introduces selection mode, a layer selection system with a contextual operation bar, a feature selection system, a suite of geographic operations, and an interactive attribute table.

### New Features

#### Map Toolbar & Interaction Modes

A floating toolbar sits on the map canvas with two modes:

- **Pan mode**: the default. Click and drag to navigate.
- **Select mode**: switches the cursor to selection behavior, enabling you to interact directly with objects on the canvas.

Switch between modes with **V** (pan) or **S** (select). Hold **Space** while in select mode to temporarily pan without switching modes.

#### Layer Selection

Layers can now be selected directly from the layers panel or on the canvas while in select mode.

- **Click** a layer to select it. **Shift+click** to range-select, **Cmd+click** to toggle individual layers in or out.
- Selected layers are highlighted on the canvas with visual feedback tuned to geometry type: bounding box strokes for all types, fill tint and outline thickening for polygons, stroke tint for lines, and halos for points.
- **Click and drag** to create a marquee that will select all layers it intersects.
- **Escape** clears the selection (feature selection clears first, then layer selection).
- An **X button** in the dynamic action bar dismisses the selection at any time.
- **Double-clicking** a layer on the map allows you to select features within it.

#### Feature Selection

In select mode, individual map features can be selected:

- **Double-clicking** a layer allows you to select features inside of it, while in this mode you can **single click** to select a feature. Clicking on features from other layers in this mode will back you out to layer select and select that layer.
- **Cmd+Click** will bypass layer selection and directly allow you to select features. Likewise, **Cmd+Shift+click** allows you to directly select multiple features.
- **Cmd+Drag** will create a marquee that directly selects all features it intersects. Dragging while double-clicked into a layer will create a marquee that selects all features inside of it within that layer.
- **Hover** a feature to preview its properties in the features panel before committing to a selection.
- Selected features are shown in the features panel, grouped by their layer. All selected features from a particular layer can be **deselected** using the X next to the card in the selected features section.
- When features are selected, a dynamic bar offers **Copy to layer**, **Merge to new layer**, or **Delete**. Delete is also available via the **Delete** key.

#### Dynamic Action Bar

When one or more layers or features are selected, a contextual action bar appears above the canvas toolbar. Available operations depend on the selection:

For layers:

- **Dissolve**: merge features into one shape. Optionally group by an attribute field so each unique value produces its own feature.
- **Explode**: split multi-part features into individual geometries.
- **Clip**: clip layers to a shape or bounding box (see below).
- **Subtract**: cut the shape of the topmost selected layer from the one below it.
- **Mosaic**: flatten a polygon layer or layers by converting overlapping areas into separate polygons.
- **Merge**: combine multiple selected layers into a single new layer.

For features:

- **Copy to layer**: creates a new layer containing the selected feature(s).
- **Merge to new layer**: if features from different layers are selected, they can be merged to create a new layer containing only those features.
- **Delete**: removes the feature from the layer geometry.

#### Clip

The Clip operation opens a popover with two modes:

- **Clip to layer**: clip one or more target layers to the shape of the topmost selected layer. While the popover is open, the source layer is highlighted in orange on the canvas and non-selected layers dim.
- **Clip to bounding box**: clip to a geographic rectangle. Enter coordinates manually using N/S/E/W inputs, fill them from the current viewport with a checkbox, or drag the corner handles of a live preview overlay directly on the canvas.

Multiple target layers can be clipped simultaneously in a single operation.

#### Features Table

A data table that displays the attributes of all features for a layer can be opened from the **...** menu next to a layer, or by using the table icon toggle in the features panel.

- **Type-inferred columns**: each column header shows an icon for its inferred data type: number, string, boolean, null, or mixed.
- **Editable cells**: double-click any cell or column header to edit inline.
- **Column management**: right-click any header to add, insert, duplicate, rename, or delete columns. Hover between headers to reveal an insert zone.
- **TSV paste**: paste tab-separated values from a spreadsheet to fill cells downward from the selected cell.
- **Bidirectional sync**: selecting a feature highlights its row in the table; checking a row selects the feature on the canvas.
- **Layer tabs**: all layers are shown as tabs at the top of the table; swap tabs to inspect the features table for any layer.

### Bug Fixes

- Fixed marquee selection not registering point features in certain layer configurations.
- Fixed marquee selection applying incorrect coordinates at non-default pan and zoom levels.
