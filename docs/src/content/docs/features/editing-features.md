---
title: Editing Features
description: How to reshape features by editing their vertices in Graticule.
---

Edit mode lets you reshape a feature by moving its vertices directly on the canvas. Like the rest of Graticule, editing is non-destructive, you can always undo or change settings.

## Entering Edit mode

Select the **Edit** tool from the toolbar, or press `E`. Then double-click a feature to start editing its vertices. You can also select a single feature and click **Edit** in the action bar.

## Moving vertices

- **Drag** a vertex to move it. Vertices shared with a neighboring feature move together, so connected borders stay connected.
- **Click** a vertex to select it, or **Shift-click** to select multiple.
- **Cmd+drag** a marquee to select every vertex inside it.

Drag any selected vertex to move the whole selection at once. You can also nudge the selection with the **arrow keys** — one pixel at a time, or ten pixels at a time while holding `Shift`.

## Adding and removing vertices

- Hover over an edge and click the marker that appears at its midpoint to insert a vertex there.
- Select one or more vertices and press `Delete` to remove them. There are particular vertices that form the junction of many features which you cannot delete because they would make the topology invalid.

## Editing point layers

In a point layer, each point is a vertex. Click, Shift-click, or Cmd+drag a marquee to select points, then drag to move them.

## Editing simplified or smoothed layers

Simplified and smoothed layers require that the raw geometry remain unchanged so that their settings can be altered, so you cannot edit them directly. The first time you edit one, Graticule prompts you to "bake"" the current settings into a new layer. This will create a new copy of the layer where the geometry reflects the current simplification and smoothing level. Confirm, to edit that new layer while the original stays intact.

### Editing bezier smoothed layers

Layers with bezier smoothing enabled allow you to edit the control points of the bezier curve. Since bezier smoothing exists only in screen space this will not alter the underlying geodata. 

## Finishing or canceling

Press `Enter`, or click **Done**, to commit your edits. Press `Escape`, or click **Cancel**, to discard them. Double-clicking away from the feature also commits your edits and exits. A committed edit lands as a single step in the history.
