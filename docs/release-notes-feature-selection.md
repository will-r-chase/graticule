# Release Notes

## Layer Selection, Geoprocessing & Data Table

*June 15, 2026*

---

### Overview

This release makes Graticule significantly more capable for data-aware and geoprocessing workflows. It introduces selection mode, a layer selection system with a contextual operation bar, a feature selection system, a suite of geographic operations, and an interactive attribute table.

---

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

- Cmd+Click will bypass layer selection and directly allow you to select features. Likewise, **Cmd+Shift+click** allows you to directly select multiple features.

- Marquee selection also works on features. **Cmd+Drag** will create a marquee that directly selects all features it interacts with. And dragging while double-clicked into a layer will create a marquee that selects all features inside of it within that layer.

- **Hover** a feature to preview its properties in the features panel before committing to a selection.

- Selected features are also shown in the features panel, grouped by their layer, and all selected features from a particular layer can be **deselected** by using the X next to the card in the selected features section.

- When features are selected, a dynamic bar offers **Copy to layer**, **Merge to new layer**, or **Delete**. Delete is also available via the **Delete** key.

#### Dynamic action bar

When one or more layers or features are selected, a contextual action bar appears above the canvas toolbar. Available operations depend on the selection:

For layers:

- **Dissolve**: merge features into one shape. Optionally group by an attribute field so each unique value produces its own feature.
- **Explode**: split multi-part features into individual geometries.
- **Clip**:  clip layers to a shape or bounding box (see below).
- **Subtract**:  cut the shape of the topmost selected layer from the one below it.
- **Mosaic**:  flatten a polygon layer or layers by converting overlapping areas into separate polygons.
- **Merge**:  combine multiple selected layers into a single new layer.

For features:

- **Copy to layer**: creates a new layer containing on the selected feature(s). 

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
- **Layer tabs**: all layers are shown as tabs at the top of the label, swap tabs to inspect the features table for any layer.

---

### Bug Fixes

- Fixed marquee selection not registering point features in certain layer configurations.
- Fixed marquee selection applying incorrect coordinates at non-default pan and zoom levels.
