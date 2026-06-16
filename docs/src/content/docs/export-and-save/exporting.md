---
title: Exporting
description: How to export your map as an image or vector file from Graticule.
---

Click **Export** in the top toolbar to open the export modal. Graticule exports SVG and PNG — both are derived from the current canvas state including all visible layers, styles, and the current projection.

## SVG

SVG is the primary export format and the best choice for most workflows. The exported SVG:

- Contains clean, scalable vector paths — no pixel rasterization
- Is structured as one group per layer, with fills and strokes as inline style attributes
- Opens directly in Illustrator, Figma, Inkscape, and any SVG-capable tool
- Can be used in web pages or embedded in visualizations

If you plan to do further editing — adjusting line weights, changing colors, adding labels in another tool — SVG is what you want.

## PNG

PNG exports a rasterized version of the canvas at the resolution you specify. PNG respects the canvas background color and opacity. Toggling off the canvas background in the canvas styles section produces a transparent PNG.

## Clip to extent

**Clip to extent** crops the export to the bounding box of your visible data, removing empty canvas area around the edges. Use it when your data doesn't fill the canvas.

When unchecked, the export uses the full canvas dimensions.
