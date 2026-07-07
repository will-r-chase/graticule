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
- **MDUI** — primary UI font. Used for all sans-serif text: headings, body copy, UI labels.
- **VCTR Mono** — monospaced. Used for labels, metadata, codes, and anything that benefits from tabular alignment.

| Style | Font | Size | Line Height | Weight | Notes |
|---|---|---|---|---|---|
| H2 | MDUI | 24px | 28px | Bold (700) | Section or panel headings |
| H3 | MDUI | 16px | 24px | Semibold (600) | Sub-section headings |
| H4 | VCTR Mono | 12px | 18px | Regular | All caps, 5% letter-spacing. Used for eyebrow labels and category headers |
| Body Regular | MDUI | 14px | 20px | Regular (400) | Default body text |
| Body Medium | MDUI | 14px | 20px | Medium (500) | Emphasis within body copy |
| Body Small | MDUI | 12px | 18px | Regular (400) | Secondary / supporting text, metadata |
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
| `grey-1000` | `#020100` | Surface invert |
| `grey-900` | `#38362E` | Text primary, icon primary |
| `grey-800` | `#525043` | Text secondary |
| `grey-700` | `#6E6B59` | — |
| `grey-600` | `#858271` | Text tertiary, icon secondary |
| `grey-500` | `#9C9989` | Placeholder text, disabled text |
| `grey-400` | `#B4B1A2` | — |
| `grey-300` | `#CDCABC` | Borders |
| `grey-200` | `#DEDCD3` | Surface tertiary |
| `grey-100` | `#F0EFEA` | Surface secondary |
| `grey-50` | `#F7F7F4` | Map canvas background |
| `grey-25` | `#FBFBF9` | Surface primary (panels, chrome) |
| `grey-0` | `#FFFFFF` | Text invert, icon invert |

### Palette

Each color runs from `0` (white) to `900` (black) in 10 stops. Index maps as: `0→0, 1→100, …, 9→900`.

#### Blue
| Token | Hex |
|---|---|
| `blue-0` | `#fafafa` |
| `blue-25` | `#f0f1f8` |
| `blue-50` | `#e6e9f5` |
| `blue-100` | `#d2d8f0` |
| `blue-200` | `#aeb9e8` |
| `blue-300` | `#8e9ce1` |
| `blue-400` | `#7784c7` |
| `blue-500` | `#626eaf` |
| `blue-600` | `#4e5998` |
| `blue-700` | `#3c4583` |
| `blue-800` | `#2b316d` |
| `blue-900` | `#181a54` |
| `blue-1000` | `#000009` |

#### Green
| Token | Hex |
|---|---|
| `green-0` | `#ffffff` |
| `green-25` | `#ffffff` |
| `green-50` | `#fcfff0` |
| `green-100` | `#e9f1c8` |
| `green-200` | `#c7d581` |
| `green-300` | `#a9bb25` |
| `green-400` | `#90a000` |
| `green-500` | `#798700` |
| `green-600` | `#647000` |
| `green-700` | `#505a00` |
| `green-800` | `#3c4400` |
| `green-900` | `#262b00` |
| `green-1000` | `#010100` |

#### Red
| Token | Hex |
|---|---|
| `red-0` | `#ffffff` |
| `red-25` | `#ffffff` |
| `red-50` | `#ffffff` |
| `red-100` | `#ffefeb` |
| `red-200` | `#fec2b2` |
| `red-300` | `#f19b85` |
| `red-400` | `#e4765a` |
| `red-500` | `#c95d42` |
| `red-600` | `#ae452a` |
| `red-700` | `#952d11` |
| `red-800` | `#761a00` |
| `red-900` | `#4f0e00` |
| `red-1000` | `#050000` |

#### Orange
| Token | Hex |
|---|---|
| `orange-0` | `#ffffff` |
| `orange-25` | `#ffffff` |
| `orange-50` | `#ffffff` |
| `orange-100` | `#ffeed4` |
| `orange-200` | `#f6c87e` |
| `orange-300` | `#e9a400` |
| `orange-400` | `#c78c00` |
| `orange-500` | `#a87500` |
| `orange-600` | `#8c6100` |
| `orange-700` | `#714d00` |
| `orange-800` | `#563a00` |
| `orange-900` | `#382400` |
| `orange-1000` | `#020100` |

#### Purple
| Token | Hex |
|---|---|
| `purple-0` | `#ffffff` |
| `purple-25` | `#fcf9fd` |
| `purple-50` | `#f5eff7` |
| `purple-100` | `#e8ddeb` |
| `purple-200` | `#cfbad6` |
| `purple-300` | `#b99ac4` |
| `purple-400` | `#a67cb3` |
| `purple-500` | `#9361a4` |
| `purple-600` | `#824595` |
| `purple-700` | `#6d307f` |
| `purple-800` | `#571a69` |
| `purple-900` | `#3d004d` |
| `purple-1000` | `#020004` |

---

### Semantic Tokens

These are the tokens components should reference. Never hardcode a raw hex value in a component — always use a semantic token.

| Token | Value | Use |
|---|---|---|
| `color-text-primary` | `grey-900` | Default text and icons |
| `color-text-secondary` | `grey-800` | Supporting text, slightly muted from primary |
| `color-text-tertiary` | `grey-600` | Metadata, placeholder, secondary labels |
| `color-text-invert` | `grey-0` | Text on dark/filled surfaces |
| `color-icon-primary` | `grey-900` | Default icon fill |
| `color-icon-secondary` | `grey-600` | Secondary / decorative icons |
| `color-icon-invert` | `grey-0` | Icons on dark surfaces |
| `color-border` | `grey-300` | Default border |
| `color-surface-primary` | `grey-25` | Default background (panels, chrome, modals, cards) |
| `color-surface-secondary` | `grey-100` | Slightly recessed surfaces, input backgrounds |
| `color-surface-tertiary` | `grey-200` | Hover states, zebra-striping, dividers |
| `color-surface-invert` | `grey-900` | Dark surfaces, tooltips |
| `color-accent` | `green-400` | Primary interactive accent (buttons, links, focus rings, active states) |
| `color-accent-subtle` | `green-100` | Accent tint for selected/active backgrounds |
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
| Natural Earth | `green-500` bg tint (`green-100`), text `green-700` |
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
