---
title: Drawing
description: How to draw your own point, line, and polygon features on the canvas in Graticule.
---

Draw mode lets you create features by drawing them directly on the canvas.

## Entering Draw mode

Select the **Draw** tool from the toolbar, or press `D`. A bar appears at the bottom of the canvas where you choose what to draw and where it goes.

## Choosing a geometry type

Pick **polygon**, **line**, or **point** from the bar. Once you start drawing, or once you target a layer that already has a type, the type locks so a layer never mixes geometry types.

## Drawing shapes

- For **points**, each click drops a point.
- For **lines** and **polygons**, click to place each vertex, then double-click to finish the shape. You can close a polygon by clicking on the initial vertex.

Finished shapes stay on the canvas as you keep drawing more. Click **Done**, or press `Enter`, to commit everything you have drawn.

## Snapping

Two kinds of snapping help you draw precisely:

- **Angle snap** — hold `Shift` while drawing a line or polygon to lock the current edge to the nearest 15° step to help with right angles and regular shapes.
- **Vertex snap** — turn on the magnet button in the action bar to enable snapping of placed vertices to an existing vertex, whether on a visible layer or on the shape you are drawing.

## Self-intersection

While you draw a polygon, Graticule highlights any edges that cross to form an invalid geometry and prevents you from committing these shapes. Remove the offending vertex and continue, or cancel the shape.

## Choosing where shapes go

By default, your shapes go to a **new layer**, created when you commit. To draw into an existing layer instead, click **Target layer** and pick a layer from the panel — the draw type adopts that layer's data type. Click **New layer** to switch back to creating a fresh layer.

## Undo, finish, and cancel

- Press `Cmd/Ctrl+Z` to remove the last vertex you placed, and `Cmd/Ctrl+Shift+Z` to put it back.
- Press `Enter`, or click **Done**, to commit your work to the layer.
- Press `Escape`, or click **Cancel**, to discard the current shape. Press `Escape` again to clear everything drawn in the session.
