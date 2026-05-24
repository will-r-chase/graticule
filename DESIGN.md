# Mappy — Design System

A living reference document. All UI decisions should trace back to a principle or token defined here.

---

## Principles

**Hierarchy through restraint.** The map is the primary element. Every chrome element — panels, controls, labels — should feel quieter than the content. Use weight, size, and color to guide attention rather than decoration.

**Breathing room.** Crowded UI reads as complicated. Err on the side of more space. Tight spacing is a deliberate choice for dense data, not a default.

**Minimalist and clean.** No gradients, no shadows unless functionally necessary, no decorative borders. If an element isn't doing a job, remove it.

**Consistency over cleverness.** Use the same pattern for the same problem everywhere. A new component is a last resort; reuse and extend first.

---

## Typography

Fonts used:
- **Switzer** — primary UI font. Geometric, clean, legible at small sizes.
- **VCTR Mono** — monospaced. Used for labels, metadata, codes, and anything that benefits from tabular alignment.

| Style | Font | Size | Line Height | Weight | Notes |
|---|---|---|---|---|---|
| H2 | Switzer | 24px | 28px | Bold (700) | Section or panel headings |
| H3 | Switzer | 16px | 24px | Semibold (600) | Sub-section headings |
| H4 | VCTR Mono | 12px | 18px | Regular | All caps, 5% letter-spacing. Used for eyebrow labels and category headers |
| Body Regular | Switzer | 14px | 20px | Regular (400) | Default body text |
| Body Medium | Switzer | 14px | 20px | Medium (500) | Emphasis within body copy |
| Body Small | Switzer | 12px | 18px | Regular (400) | Secondary / supporting text, metadata |
| Mono Regular | VCTR Mono | 14px | 20px | Regular | Hex codes, coordinates, IDs, file names |
| Mono Small | VCTR Mono | 12px | 18px | Regular | Compact mono contexts (badges, status) |

### Typography Rules
- **Never use H2 inside a panel.** H2 is reserved for page-level or modal headings. Panels use H3 at most.
- **H4 is always all-caps and spaced.** It is an eyebrow label, not a headline. Use it above grouped controls or to introduce a section within a panel.
- Body Regular is the default. Only upgrade to Body Medium when you need to call out a specific piece of text within a paragraph or list.
- Don't mix Switzer and VCTR Mono within a single sentence. They serve different semantic purposes.

---

## Spacing

A fixed scale. Use only these values — no arbitrary px numbers.

| Token | Value | Use |
|---|---|---|
| `space-none` | 0px | Intentional zero gap |
| `space-xs` | 2px | Icon-to-label gap, tight badge padding |
| `space-s` | 4px | Internal component padding (compact), gap between closely related elements |
| `space-m` | 8px | Default internal padding, gap between related items in a list |
| `space-l` | 16px | Panel internal padding, gap between distinct control groups |
| `space-xl` | 24px | Section separation within a panel, modal padding |
| `space-xxl` | 48px | Major layout separation (e.g. toolbar height, empty state padding) |

### Spacing rules
- Panel internal padding: `space-l` (16px) on all sides.
- Gap between items in a vertical list (catalog items, layer list): `space-m` (8px).
- Gap between label and its control: `space-s` (4px).
- Gap between a group of controls and the next group: `space-l` (16px), often with a divider.
- Inline icon-to-text gap: `space-xs` (2px) or `space-s` (4px) depending on context.

---

## Border Radius

| Context | Value |
|---|---|
| Default (buttons, inputs, cards, panels, badges) | 4px |
| Circular elements (avatars, radio states, spinners) | 50% |
| No rounding (full-width elements that span a container edge) | 0px |

---

## Color

### Grey Scale

| Token | Hex | Use |
|---|---|---|
| `grey-900` | `#161819` | Text primary, icon primary, surface invert |
| `grey-800` | `#2D3137` | — |
| `grey-700` | `#424952` | — |
| `grey-600` | `#7D8289` | Text secondary, icon secondary |
| `grey-500` | `#A8ACB1` | Placeholder text, disabled text |
| `grey-400` | `#CFD1D3` | — |
| `grey-300` | `#E3E5E7` | Borders |
| `grey-200` | `#EEEFF1` | Surface tertiary |
| `grey-100` | `#F4F4F5` | Surface secondary |
| `grey-0` | `#FFFFFF` | Surface primary, text invert, icon invert |

### Palette

Each color runs from `0` (white) to `900` (black) in 10 stops. Index maps as: `0→0, 1→100, …, 9→900`.

#### Turquoise
| Token | Hex |
|---|---|
| `turquoise-0` | `#ffffff` |
| `turquoise-100` | `#e3fbee` |
| `turquoise-200` | `#c7f7dd` |
| `turquoise-300` | `#a8f2cc` |
| `turquoise-400` | `#85edbc` |
| `turquoise-500` | `#5ae8ab` |
| `turquoise-600` | `#3b9e73` |
| `turquoise-700` | `#1e5940` |
| `turquoise-800` | `#051d13` |
| `turquoise-900` | `#000000` |

#### Blue
| Token | Hex |
|---|---|
| `blue-0` | `#ffffff` |
| `blue-100` | `#daefff` |
| `blue-200` | `#b5deff` |
| `blue-300` | `#8fcdff` |
| `blue-400` | `#65bbfe` |
| `blue-500` | `#2ca9fc` |
| `blue-600` | `#1a72ac` |
| `blue-700` | `#0a3f62` |
| `blue-800` | `#011221` |
| `blue-900` | `#000000` |

#### Red
| Token | Hex |
|---|---|
| `red-0` | `#ffffff` |
| `red-100` | `#ffe0d8` |
| `red-200` | `#ffc0b1` |
| `red-300` | `#ff9f8a` |
| `red-400` | `#ff7b62` |
| `red-500` | `#fa5234` |
| `red-600` | `#aa3520` |
| `red-700` | `#611a0e` |
| `red-800` | `#210402` |
| `red-900` | `#000000` |

#### Pear
| Token | Hex |
|---|---|
| `pear-0` | `#ffffff` |
| `pear-100` | `#f6ffe0` |
| `pear-200` | `#eefebf` |
| `pear-300` | `#e6fc9b` |
| `pear-400` | `#defa72` |
| `pear-500` | `#d7f832` |
| `pear-600` | `#92a91f` |
| `pear-700` | `#52600d` |
| `pear-800` | `#1a2002` |
| `pear-900` | `#000000` |

#### Pink
| Token | Hex |
|---|---|
| `pink-0` | `#ffffff` |
| `pink-100` | `#ffe2f2` |
| `pink-200` | `#ffc5e5` |
| `pink-300` | `#ffa7d8` |
| `pink-400` | `#ff87cb` |
| `pink-500` | `#ff64be` |
| `pink-600` | `#ae4280` |
| `pink-700` | `#632248` |
| `pink-800` | `#220716` |
| `pink-900` | `#000000` |

#### Orange
| Token | Hex |
|---|---|
| `orange-0` | `#ffffff` |
| `orange-100` | `#fff1dc` |
| `orange-200` | `#ffe2b7` |
| `orange-300` | `#ffd392` |
| `orange-400` | `#fec368` |
| `orange-500` | `#fcb32c` |
| `orange-600` | `#ac791a` |
| `orange-700` | `#62430a` |
| `orange-800` | `#211401` |
| `orange-900` | `#000000` |

#### Purple
| Token | Hex |
|---|---|
| `purple-0` | `#ffffff` |
| `purple-100` | `#f6e7ff` |
| `purple-200` | `#ecceff` |
| `purple-300` | `#e3b5ff` |
| `purple-400` | `#d99cfd` |
| `purple-500` | `#cf81fb` |
| `purple-600` | `#8c56ab` |
| `purple-700` | `#4f2e61` |
| `purple-800` | `#190b21` |
| `purple-900` | `#000000` |

---

### Semantic Tokens

These are the tokens components should reference. Never hardcode a raw hex value in a component — always use a semantic token.

| Token | Value | Use |
|---|---|---|
| `color-text-primary` | `grey-900` | Default text and icons |
| `color-text-secondary` | `grey-600` | Supporting text, metadata, placeholder |
| `color-text-invert` | `grey-0` | Text on dark/filled surfaces |
| `color-icon-primary` | `grey-900` | Default icon fill |
| `color-icon-secondary` | `grey-600` | Secondary / decorative icons |
| `color-icon-invert` | `grey-0` | Icons on dark surfaces |
| `color-border` | `grey-300` | Default border |
| `color-surface-primary` | `grey-0` | Default background (panels, modals, cards) |
| `color-surface-secondary` | `grey-100` | Slightly recessed surfaces, input backgrounds |
| `color-surface-tertiary` | `grey-200` | Hover states, zebra-striping, dividers |
| `color-surface-invert` | `grey-900` | Dark surfaces, tooltips |
| `color-accent` | `blue-500` | Primary interactive accent (buttons, links, focus rings, active states) |
| `color-accent-subtle` | `blue-100` | Accent tint for selected/active backgrounds |
| `color-error` | `red-500` | Error text and icons |
| `color-error-subtle` | `red-100` | Error background tint |

---

## Borders

- Default border: `1px solid color-border` (`grey-300`)
- No border unless it's doing structural work — separating regions or delineating interactive elements. Don't add borders just for decoration.
- Dividers between sections within a panel: `1px solid color-border`, full width, no margin collapse.
- Focus ring: `2px solid color-accent`, `outline-offset: 2px`. Applied to all keyboard-focusable elements.

---

## Icons

**Library:** [Phosphor Icons](https://phosphoricons.com/) — Regular weight throughout the app.

**Default size:** 16×16px

**Size scale:**
| Size | Context |
|---|---|
| 12px | Compact badges, dense list rows where 16px crowds |
| 16px | Default — toolbar, panels, list items, buttons |
| 20px | Slightly prominent contexts (empty state icons are an exception, see below) |
| 24px | Rare; only for standalone decorative icons with no adjacent text |

**Icon color:** Always inherits from text context. Use `color-icon-primary` (`grey-900`) for interactive icons, `color-icon-secondary` (`grey-600`) for decorative or supporting icons.

**Icon + label:** Horizontal gap of `space-xs` (2px) for tight inline, `space-s` (4px) for standard. Icon and label should be vertically center-aligned.

**Clickable icons:** Minimum touch/click target of 28×28px (add padding around the 16px icon to reach this). Don't make icons clickable with no visible affordance — pair with a hover state.

---

## Component Patterns

### Buttons

Three variants:

| Variant | Background | Text | Border | Use |
|---|---|---|---|---|
| Primary | `color-accent` (`blue-500`) | `color-text-invert` | None | Single most important action per context |
| Secondary | `color-surface-primary` | `color-text-primary` | `color-border` | Standard actions |
| Ghost | Transparent | `color-text-primary` | None | Low-priority actions, toolbar icon buttons |

States for all variants:
- **Hover:** `color-surface-tertiary` background tint (secondary/ghost), slightly darker background (primary)
- **Active/pressed:** one step darker than hover
- **Disabled:** `color-text-secondary` text, `color-surface-secondary` background, no pointer
- **Focus:** standard focus ring

Sizing:
- Default height: 32px, horizontal padding: `space-l` (16px)
- Compact height: 28px, horizontal padding: `space-m` (8px) — for dense panel controls
- Icon-only button: 28×28px, no horizontal padding text

Border radius: 4px.

---

### Inputs

- Height: 32px
- Background: `color-surface-secondary` (`grey-100`)
- Border: `1px solid color-border`
- Border radius: 4px
- Padding: `space-s` `space-m` (4px 8px)
- Text: Body Regular, `color-text-primary`
- Placeholder: Body Regular, `color-text-secondary`
- Focus: border becomes `color-accent`, no outline (border change is enough)
- Error: border becomes `color-error`, optional error message in Body Small `color-error` below

---

### Panels

- Background: `color-surface-primary`
- Internal padding: `space-l` (16px)
- Panel sections separated by: `1px solid color-border` divider + `space-l` gap above and below
- Section labels: H4 style (VCTR Mono, all caps, letter-spaced) in `color-text-secondary`

---

### Badges / Tags

- Background: `color-surface-secondary`
- Text: Mono Small, `color-text-secondary`
- Padding: `space-xs` `space-s` (2px 4px)
- Border radius: 4px
- No border

Source badges in the catalog use a fixed color per source:
| Source | Color |
|---|---|
| Natural Earth | `turquoise-500` bg tint (`turquoise-100`), text `turquoise-700` |
| TIGER | `blue-500` bg tint (`blue-100`), text `blue-700` |
| Eurostat | `orange-500` bg tint (`orange-100`), text `orange-700` |
| Project Linework | `purple-500` bg tint (`purple-100`), text `purple-700` |
| Custom | `grey-200` bg, text `grey-700` |

---

### Sliders

- Track height: 4px, background `color-surface-tertiary`, filled portion `color-accent`
- Thumb: 14px circle, `color-surface-primary` fill, `2px solid color-accent` border
- No tick marks in MVP
- Always pair with a numeric readout (Body Small or Mono Small) to the right

---

### Color Picker

Custom component — do not use the browser native `<input type="color">`.

Structure:
1. **Hue slider** — full-width horizontal, spectrum gradient track, thumb shows current hue
2. **Saturation slider** — full-width horizontal, gradient from grey to saturated color
3. **Lightness slider** — full-width horizontal, gradient from black to white through color
4. **Opacity slider** — full-width horizontal, checkerboard pattern + color overlay
5. **Hex input** — Mono Regular, accepts 6-character hex (with or without `#`). Updates all sliders live. Invalid input is caught and the field shown in `color-error`.
6. **Preview swatch** — solid 24×24px box showing the current color including opacity. Border radius 4px. Sits to the left of the hex input.

All sliders follow the standard slider styling above.

---

### Modals

- Backdrop: `rgba(0,0,0,0.4)`, close on click
- Panel: `color-surface-primary`, 480px max-width, border radius 4px, `space-xl` (24px) padding
- Close button: top-right corner, ghost icon button (Phosphor `X` icon)
- Close on `Escape`
- Title: H3

---

### Empty States

- Centered vertically and horizontally in their container
- Icon: 32px Phosphor icon in `color-icon-secondary`
- Headline: H3 in `color-text-primary`
- Supporting text: Body Regular in `color-text-secondary`
- Optional CTA: Secondary button
- `space-m` (8px) between icon and headline, `space-s` (4px) between headline and supporting text, `space-l` (16px) before CTA

---

### Loading States

- **Inline (list items, small components):** Animated shimmer bar at the element's natural size. Shimmer uses `color-surface-secondary` → `color-surface-tertiary` animation.
- **Full-panel:** Centered spinner — 20px circle, `color-accent` stroke, 1.5-turn animation
- No skeleton screens in MVP; shimmer bars are sufficient

---

## Layout

### Three-Column Grid

```
┌──────────────┬──────────────────────────┬──────────────┐
│ Left Panel   │     Map Canvas           │ Right Panel  │
│ 280px fixed  │     flex: 1              │ 280px fixed  │
│              │                          │              │
└──────────────┴──────────────────────────┴──────────────┘
```

- Left panel: Catalog browser
- Center: SVG map canvas, fills all remaining space
- Right panel: Layer list + style controls
- Toolbar spans full width above the three columns

Panel widths are fixed at 280px. No collapsing in MVP. Panels scroll independently (overflow-y: auto) if content exceeds viewport height.

### Toolbar

- Height: 48px (= `space-xxl`)
- Background: `color-surface-primary`
- Bottom border: `1px solid color-border`
- Horizontal padding: `space-l` (16px)
- Vertically center all elements

### Z-Index Scale

| Layer | Value | Use |
|---|---|---|
| Canvas | 0 | SVG map |
| Panels | 10 | Left and right panels |
| Toolbar | 20 | Top bar |
| Dropdowns | 30 | Open select menus |
| Modals | 40 | Export modal, dialogs |
| Tooltips | 50 | Always on top |

---

## Interaction & Motion

**Keep motion minimal.** This is a tool, not a marketing page.

- **Hover/focus transitions:** `100ms ease` on background-color and border-color only.
- **Panel expand/collapse (future):** `200ms ease` on height/opacity.
- **Modal open:** `150ms ease` fade-in on backdrop + `150ms ease` scale from 0.97 to 1.0 on panel.
- **No bounce, no spring, no complex easing.** Linear or ease is fine.
- Respect `prefers-reduced-motion`: all transitions drop to 0ms.

---

## Accessibility

- All interactive elements must be keyboard-reachable and show the standard focus ring.
- Icon-only buttons must have an `aria-label`.
- Color is never the sole differentiator — always pair with shape, label, or icon.
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text and UI components (WCAG AA).
- `prefers-reduced-motion` supported for all transitions.
