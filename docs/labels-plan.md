# Labels: Design & Plan

Working document for map labels — attribute-derived labels, freeform text, editing, and styling.
Decisions get recorded here as we make them; open questions live at the bottom until resolved.

## Goals

1. **Attribute labels**: turn on labels derived from a feature attribute (e.g. `NAME`), choose
   which attribute/version, hide individual labels, style them.
2. **Text edit mode**: create freeform text boxes directly on the map; also drag (move), edit,
   and style individual labels rendered from other layers.
3. **Curved labels**: text along a path (river/lake centerlines, ranges), a core cartography need.

## Decisions

### D1: Labels are a separate layer type (decided 2026-07-06)

Mapbox-style: labels are their own layer, not a style toggle on the parent layer.

Why:

- One system covers both use cases: a label layer **with a source** (layer X + attribute)
  handles dataset labels; a label layer **with no source** holds freeform text boxes. This maps
  directly onto the existing derived-dataset sentinel / source-less layer concept from the Data
  tab work.
- Inherits existing layer machinery for free: z-order (labels usually need to render above
  geometry — reordering handles it), visibility, rename, undo/history, persistence.
- Per-label overrides (hide, move, text edit) live in the label layer's own data; the parent
  layer and its content-addressed geometry stay pristine.
- Label styling is a large surface (font, size, halo, placement, curve, alignment) and gets its
  own style panel instead of crowding the geometry panel.

The source relationship is **creation-time only** (see D2), so this adds no live dependency
between layers. Mitigation for the common-case friction: a one-click "Create labels for this
layer" action creates a pre-wired label layer.

### D2: Label layers are baked at creation — independent afterward (decided 2026-07-06)

"Create labels for this layer" is a **one-time derivation**, not a live link:

- It computes anchor geometry from the source (points as-is, polygon centroids, lines copied
  for curved labels), copies **all** feature properties over, and produces a brand-new,
  fully independent label layer. The chosen text attribute is a layer-level setting on the
  label layer, switchable later because all properties came along.
- After creation there is no reference back to the source. A label's point *is* its position:
  moving a label is an ordinary geometry edit on the label layer. No pins, no offsets, no
  edit-propagation or orphaning rules.
- A derived label layer and a freeform text layer are **the same thing** after creation — one
  uniform layer type differing only in how it was born. This mirrors the duplicate-and-bake
  model already used for vertex editing on processed layers.
- If the source changes significantly (features added, geometry reworked), the user regenerates
  by running "create labels" again. Making regeneration cheap is a design goal.
- Catalog datasets will ship with dedicated label datasets ("country labels", "water labels",
  …) that specify their own label geometry. Derived anchors only need to be good enough for
  **user-uploaded datasets** and drawn layers.

Rejected: live-derived anchors with pin-on-move. What it bought (source edits propagate,
new source features auto-labeled, curved labels glued to an edited line) is covered well
enough by regeneration, and it required cross-layer reactive plumbing plus pin/offset
semantics. The copied curve path is arguably a feature: the label path can be nudged
independently of the source line, which cartographers genuinely do.

### D3: Curved labels are rolled by hand on Canvas (decided 2026-07-06)

Per-glyph placement: measure each character with `ctx.measureText`, walk the projected path by
arc length, `translate`/`rotate`/`fillText` per glyph. This is the approach Mapbox GL uses.

- Stays inside the single canvas render pipeline (no SVG overlay, no second compositing/
  hit-testing/export path).
- Gives letter-spacing, upside-down-label flipping, and offset-from-line control for free.
- SVG **export** emits native `<textPath>` (or per-glyph `<text>` if pixel-fidelity with canvas
  matters); PNG export works unchanged since labels are already on the canvas.

Rejected: SVG overlay (two render pipelines forever, breaks compositing with canvas layers
stacked above labels, PNG export needs a special path); third-party canvas-textpath libraries
(ecosystem is thin and unmaintained).

### D4: Data model — `kind` discriminant on the existing `Layer` (decided 2026-07-06)

- `Layer` gains `kind: 'geometry' | 'label'`, plus a `labelStyle` block that applies only when
  `kind === 'label'`. No parallel `LabelLayer` type.
- Label layers reuse all existing machinery unchanged: `geometryId` + `rawTopologyData` for
  their point/line geometry, history snapshots, persistence, the layer list.
- Accepted wart: `processing` and `bezierCacheKey` exist on label layers but are meaningless
  there. Revisit (tighten to a discriminated union) only if this causes real bugs.
- Label **text** lives in feature properties, which live in the raw topology — so editing a
  label's text is a raw-geometry change and **mints a new `geometryId`**, exactly like moving a
  vertex. The metadata-only undo model needs no new concepts.

### D5: Collision/decluttering deferred out of v1 (decided 2026-07-06)

Auto-decluttering matters for slippy maps where zoom changes constantly and no human curates
each view. Mappy is a design tool where the cartographer composes one map — manually hiding or
nudging labels is the point, and text edit mode provides exactly those gestures. A "hide
overlapping" convenience toggle can layer on later if wanted.

## Build order (decided 2026-07-06)

Each step is usable on its own before the next starts:

1. **Data model + creation** — `kind` on `Layer`, default `labelStyle`, "Create labels for this
   layer" derivation (points as-is, polygon centroids; text attribute selection). No rendering
   yet; the layer appears in the list with its features in the table.
   **DONE + verified 2026-07-06** (branch `labels`): `kind`/`labelAttribute`/`labelStyle` on
   `Layer` with defaults at every construction site and old-project migration in project.ts;
   pure anchor math in `app/src/lib/utils/labels.ts` (polylabel dep added); `createLabelLayer`
   in layers.svelte.ts; "Create labels" item in the layer-row `⋯` menu (geometry layers with
   topology only). Label layers currently render as default points — replaced in step 2.
2. **Straight label rendering** — canvas text at anchors with basic `labelStyle` (font, size,
   color, halo) + the label style panel.
   **2a (canvas text) DONE + verified 2026-07-06**: `drawLabelLayer` in MapCanvas draws the
   labelAttribute text at projected anchors — zoom-independent like point symbols, halo under
   fill, 9-way anchor gaps, `\n` multi-line, globe backface culling; label layers skipped in
   hit-canvas/tint passes (text hit-testing arrives in step 3). Render helpers
   (applyTextTransform, LABEL_ANCHOR_DIR, labelFontString) live in utils/labels.ts for reuse
   by SVG export. Canvas letterSpacing is a no-op in older Firefox (accepted; per-glyph
   fallback possible after step 4).
   **2b (style panel + Text data tab) DONE + verified 2026-07-06**: LabelStylePanel (live
   store pushes, snapshot on blur/close; Capitalize added to transforms) + LabelDataPanel
   ("Text data" tab: provenance via new display-only `derivedFrom` field, attribute
   switcher, label count) — the Data tab's source switcher is not offered on label layers
   (it would replace label geometry with raw catalog geometry).
   **2c (fonts) DONE + verified 2026-07-06**: fonts.svelte.ts store — curated system list,
   queryLocalFonts on demand (Chromium only), Google Fonts catalog via
   PUBLIC_GOOGLE_FONTS_API_KEY (`$env/dynamic/public`; missing key degrades gracefully);
   css2 stylesheet injection awaited via link.onload before document.fonts.load (calling
   early = fallback sticks); picker awaits load before applying (no fallback flash);
   fonts.version bump repaints canvas. Undo fixed: history SnapshotLayer now carries
   kind/labelAttribute/labelStyle/derivedFrom (omitting them made style snapshots dedupe
   and restore drop `kind`).
   **Step 2 committed** on `labels` @ 799d779.
3. **Text edit mode** — text tool: click empty map to place freeform text, click a label to
   select, drag to move, double-click to edit text. Session-accumulate → one commit, like
   drawing mode.
   **BUILT 2026-07-07 (all slices; pending review/verification)**: 3a text tool +
   textSession + click-to-place with inline textarea editor + commitTextFeatures ("Text N"
   layers, plain `text` property); 3b screen-space label hit boxes recorded during paint,
   select/drag/Delete on existing labels via per-layer session maps applied through
   applyLabelEdits; TextBar (target picker restricted to label layers, Done/Cancel);
   3c double-click retype (existing labels store session text overrides → written to
   labelAttribute on commit); 3d per-feature `__rotation` (TextBar input — deviation from
   D7's "style panel" home, since entering the text tool clears layer selection) and
   `__wrapWidth` (drag handle on the selected box's right edge; greedy word-wrap in
   wrapLabelLines; rotated labels hit-test/outline in the anchor-pivoted frame).
4. **Curved labels** — per-glyph path-walking renderer; line-source derivation copies lines.
   Placement decided in D9. Slices (decided 2026-07-07): 4a derivation keeps line geometry
   (MultiLineString → longest part, like MultiPolygon → largest); 4b curved renderer
   (screen-space arc-length walk, per-glyph translate/rotate/fillText, halo under fill,
   auto-flip when the path runs right-to-left, cull when the path midpoint is on the globe's
   back hemisphere); 4c text-edit-mode integration (hit-test along the path, drag =
   translate the whole line geometry, retype/delete via existing session maps;
   rotation/wrap-width controls hidden for curved labels).
   **4a DONE 2026-07-07**: `computeLabelGeometries` (née computeLabelAnchors) returns
   Point or LineString per feature; createLabelLayer builds a real `arcs` array for lines.
   **4b decisions**: project vertices only, no densification (revisit if chords show on
   sparse lines); `\n` collapses to a space on curved paths (text-on-a-path is single-line);
   pure layout math in `utils/curvedText.ts` (screen-px in/out — reused by step-5 SVG
   export's per-glyph fallback), MapCanvas keeps only the ctx painting; manual letter
   spacing between glyphs (ctx.letterSpacing would double-count in per-glyph measurement);
   9-way anchor / line height / alignment don't apply to curved labels.
   **4b smoothing (decided 2026-07-11)**: glyphs follow a smoothed copy of the projected
   path, not the raw one — raw river data is higher-frequency than a glyph is wide, so raw
   tangents made letters tumble and re-roll on zoom. Uniform resample at fontSize/2 px, two
   box-filter passes with half-width 1.5×fontSize, glyph angle from the secant across the
   glyph's own width. Window is font-size-proportional (screen-constant) so the label reads
   the same across zoom. Accepted cost: baselines cut tight meander corners by a few px.
   **4b DONE + verified 2026-07-11.**
   **4c DONE 2026-07-11** (select/delete/retype verified; drag verified; TextBar hide
   pending eyeball): per-glyph hit boxes sharing a `baseline` reference (its presence =
   "curved" downstream); hover/selection = baseline stroke (accent + end dots when
   selected); dblclick editor opens horizontal at the baseline midpoint; drag = whole-line
   translate via `lineMoves` lon/lat-delta session map → `applyLabelEdits` translates the
   feature's arcs; rotation input hidden for curved selections (`selectedIsCurved`), wrap
   handle suppressed. Deferred: curve reshaping (path editing) — discussion started
   2026-07-11; orphaned arcs left behind by label deletes (harmless, minor topology bloat).
5. **Export** — `<text>`/`<textPath>` in SVG export; PNG needs nothing (labels are on canvas).

### Step 1 details (decided 2026-07-06)

- **Entry point**: "Create labels" lives in a kebab/context menu on the layer's row in the
  layer list (adding the menu if layer rows don't have one yet).
- **Attribute choice**: no dialog at creation. Best-guess the text attribute (first string-ish
  property, preferring name-like keys); the user switches it anytime in the label panel, since
  all properties are copied (D2).
- **Polygon anchors**: `polylabel` (Mapbox's pole-of-inaccessibility) — small dependency,
  anchor always lands inside the polygon, unlike centroids on concave shapes.
- **Line sources in step 1**: anchor at the line midpoint as a plain point label; upgraded to
  curved placement in step 4.

### D6: v1 styling surface — style is per-layer, data is per-feature (decided 2026-07-06)

**Per-layer `labelStyle`:**

- Text: font family, size, weight (normal/bold), italic, letter spacing, text transform
  (none / UPPERCASE / lowercase / Sentence Case)
- Color: fill color + opacity; halo color + width (the primary legibility tool)
- Placement: anchor position relative to the point (9-way grid)
- Multi-line: line height, alignment (left/center/right)

**Per-feature data** (properties/geometry on the label feature; edits mint a new `geometryId`,
committed at gesture end so sliders/drags don't churn versions):

- Text content (the copied attribute value or typed box content; manual line breaks allowed)
- Position (the feature's point geometry)
- Rotation angle (panel control shown when a label is selected)
- Wrap width (freeform text boxes: drag handle on the selected box; text auto-wraps at the
  width, in addition to manual breaks). In v1 because annotations are coming soon.

**Cut from v1:** x/y pixel offset (manual dragging covers it); perpendicular offset for curved
labels; **per-label style overrides** (font/color/etc. on a single label — make another text
layer instead; label classes = layers is the classic cartographic model; can layer on later as
a metadata map keyed by a stable label id without schema pain); data-driven styling
(size-by-population); drop shadows distinct from halos.

### D7: Text edit mode interactions (decided 2026-07-06)

A text tool in the toolbar, sibling of draw/edit modes. Session-accumulate → one undo commit,
like drawing mode.

- **Click empty map** → new text box, editing immediately. Target layer mirrors drawing mode:
  auto-create a new text layer if none is active, else add to the active one.
- **Click any rendered label** (any label layer) → select. **Drag** moves it. **Double-click**
  → inline text editing via an HTML input overlaid on the canvas, styled to match (canvas
  can't edit text).
- **Selected text box** shows a width drag handle (auto-wrap).
- **Delete key** removes the label. Delete-only — no hidden flag; in the baked model delete
  *is* hide, and regenerating a derived layer restores everything.
- **Escape / tool switch** commits the session.
- Style panel with no selection edits layer defaults; with a selection it edits that label's
  per-feature data (rotation, width). Font/color/etc. always hit the layer in v1 (D6).
- Rotation: panel angle control in v1; on-canvas rotate handle later.

### D8: Fonts — system fonts + auto-loaded Google Fonts (decided 2026-07-06)

- Expose system fonts: `queryLocalFonts()` where available (Chromium-only, permission-gated);
  elsewhere fall back to a curated list of common system fonts.
- Google Fonts support with automatic loading: inject the stylesheet and await
  `document.fonts.load()` before canvas measure/draw (canvas silently falls back if the font
  isn't ready — measurement must wait).
- Export caveats (accepted): SVG references `font-family` by name — system-font SVGs render
  differently on machines lacking the font; Google-font SVGs can embed an `@import`. PNG is
  immune (rasterized from canvas).

### D9: Curved label placement (decided 2026-07-07, resolves Q1)

- **Lines only in v1.** Polygon labels stay at the pole-of-inaccessibility point; curved text
  across polygon interiors (synthesized arc paths) is a later feature.
- **No curved toggle**: a label renders curved automatically when its feature geometry is a
  LineString (line-source derivation copies the line per D2); point-geometry labels render
  straight. One layer can mix both.
- **Placement**: text centered on the line's arc-length midpoint.
- **Overflow**: text longer than its line continues straight along the end tangents — the
  label always renders; the user shortens or restyles. (Rejected: fall back to straight, or
  hide — hiding fights the user-curates-everything philosophy.)

### D10: Curved-label path editing — bezier editor in text mode (decided 2026-07-11)

Reshaping the line a curved label follows (deferred from 4c) plus first-class authoring
of new text paths. Users never drag raw vertices:

- **Editing representation is a single cubic bezier** (two anchors + two tangent handles);
  the **stored representation stays a plain LineString**. No schema change.
- **Handles appear on selection** of a curved label, dressing the existing baseline
  underline as the curve editor. The bezier is FIT to the current path for display
  (anchors at the ends, control arms along end tangents); geometry only rewrites if a
  handle is actually dragged — translate/retype/delete leave the original line untouched.
  Cancel restores the original. Dragging a handle opts the path into "smooth curve":
  a wiggly derived river line collapses to one sweep, which is the point.
- **Session model**: control points stored in lon/lat in textSession; projected to screen
  every frame for handle display, curve evaluation, and text layout (pan/zoom/reproject
  mid-edit just morphs the curve like any geometry).
- **Commit bakes in screen space**: sample the on-screen cubic densely, unproject the
  samples, write as the feature's new LineString via applyLabelEdits. What you sculpted
  is what you get under the projection you sculpted it in.
- **Authoring**: a TextBar toggle ("place text on path"); with it on, clicking empty map
  creates a DEFAULT path (gentle arc at the click) with handles + the inline editor —
  no click-drag path drawing. Rejected: draw-the-path gestures; multi-segment pen-tool
  splines (revisit if single cubics prove limiting).

### Step 3 details (decided 2026-07-07)

- **Session model**: `textSession` mirrors drawSession (non-reactive data + `version`
  counter; ghosts until commit) but holds two collections: NEW text features headed for the
  target layer, and per-layer EDIT maps (moved coords / changed text / deletions) for
  existing labels. Commit applies each touched layer via `replaceLayerGeometry` (one
  geometryId mint per layer), creates/extends the target text layer, and pushes ONE
  history snapshot for the whole session.
- **Reserved property keys**: `__rotation`, `__wrapWidth` (prefixed — can't collide with
  real dataset attributes on derived layers; shown in the features table for now, may be
  filtered from display later). Freeform text boxes store content in a plain `text`
  property (`labelAttribute = 'text'`) — it's genuine user data.
- **New-text target mirrors draw mode**: explicit target + pick-a-layer affordance;
  null target auto-creates a "Text" layer on commit and then keeps targeting it. Avoids
  depending on the deferred active-layer concept.
- **Session-local Cmd+Z: deferred** past v1. The session commits as one global undo step.
- **Hit-testing**: screen-space label bboxes recorded while drawLabelLayer paints;
  the tool walks them topmost-first.
- **Inline editor**: styled textarea overlaid on the canvas; Enter inserts a line break;
  commit on blur/Escape; an empty NEW box is discarded.
- Slices: 3a place+edit new text boxes → commit; 3b select/drag/Delete existing labels;
  3c double-click retype (derived labels edit the attribute value per D6); 3d rotation
  control + wrap-width handle.

## Open questions

- **Q1 — RESOLVED 2026-07-07** → D9 (curved label placement).
- **Q2 — Label datasets in the catalog.** Format for the dedicated label datasets (country
  labels, water labels): point geometry + text attribute? Line geometry for curved placement?
  How does a label layer sourced from a *label dataset* differ from one derived from a regular
  layer?
- **Q3 — Google Fonts list sourcing.** The full list needs a Developer API key; the
  alternative is bundling a curated popular subset. Decide when building the font picker
  (step 2).
