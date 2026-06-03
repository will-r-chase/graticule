---
title: Exporting
description: How to export your map as an image or vector file from Graticule.
---

Click **Export** in the top toolbar to open the export panel. Graticule exports SVG and PNG — both are derived from the current canvas state including all visible layers, styles, and the current projection.

## SVG

SVG is the primary export format and the best choice for most workflows. The exported SVG:

- Contains clean, scalable vector paths — no pixel rasterization
- Is structured as one group per layer, with fills and strokes as inline style attributes
- Opens directly in Illustrator, Figma, Inkscape, and any SVG-capable tool
- Can be used in web pages or embedded in D3/Observable visualizations

If you plan to do further editing — adjusting line weights, changing colors, adding labels in another tool — SVG is what you want.

## PNG

PNG exports a rasterized version of the canvas at the resolution you specify. Use this when you need a flat image file, such as embedding in a slide deck, a report, or anywhere vector isn't supported.

PNG respects the canvas background color and opacity. If the background is fully transparent, the PNG will have a transparent background.

## Scale

The **Scale** multiplier controls the output resolution relative to the canvas size. At 1×, the export is pixel-for-pixel the canvas dimensions. At 2×, it doubles — a 1000×700px canvas becomes a 2000×1400px PNG.

For print output, a scale of 2–4× is generally sufficient. SVG is resolution-independent so scale has no effect on it.

## Clip to extent

The **Clip to extent** option crops the export to the bounding box of your visible data, removing any empty canvas area around the edges. This is useful when your data doesn't fill the canvas.

When unchecked, the export uses the full canvas dimensions.
