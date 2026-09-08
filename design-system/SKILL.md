---
name: harp-design
description: Use this skill to generate well-branded interfaces and assets for HARP, the hospital information system, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick orientation

**HARP** is a hospital information system spanning Clinical, RCM, ERP, and Analytics. The aesthetic is **soft modern · calm clinical · organized density**, Google-inspired, with both light and dark themes. Used hours-a-day by doctors, nurses, RCM staff, and executives.

## Essential files to read first

1. **`README.md`** — full brand context, Content Fundamentals, Visual Foundations, Iconography
2. **`colors_and_type.css`** — every token (colors light + dark, type scale, spacing, radii, shadows, motion). Always link this first when authoring new HTML.
3. **`components.css`** — pre-built buttons, fields, badges, alerts, tables, tabs, menus, panels. Link after `colors_and_type.css`.
4. **`shell.css`** — topbar + sidebar app chrome used by every product surface.
5. **`patterns/`** — reusable component patterns (collapsible sidebar, page header, action bars, data cards, data table). Compose these into any module instead of reinventing.

## Authoring a new HTML artifact

Minimum boilerplate:
```html
<link rel="stylesheet" href="path/to/colors_and_type.css">
<link rel="stylesheet" href="path/to/components.css">
<link rel="stylesheet" href="path/to/shell.css">  <!-- only if you need the app shell -->
```

Use the existing classes (`.btn`, `.btn--primary`, `.field`, `.badge`, `.panel`, `.tabs`, `.tbl`, `.menu`, `.alert`, `.metric-rail`, `.sk`, `.side`, `.topbar`). Don't roll your own colors — read tokens (`var(--accent)`, `var(--fg-1)`, `var(--bg-surface)`, etc).

Summary numbers are `.metric-rail` / `.metric-rail-card` — one row of equal cards that share the width and never wrap on a desktop viewport, severity on the left edge, detail in the `title`. The old `.kpi` tile is retired and deleted; do not reintroduce it.

For icons, use Material Symbols Rounded via the `.icon` class (already loaded by `colors_and_type.css`):
```html
<span class="icon">stethoscope</span>
<span class="icon icon--sm">filter_list</span>
<span class="icon icon--filled" style="color: var(--critical)">warning</span>
```

## Brand assets

- `assets/logo-lockup.svg` — **primary logo**: full-color two-pillar mark + wordmark (light backgrounds)
- `assets/logo-mark.svg` — compact two-pillar mark (favicons, avatars, narrow spots)
- `assets/logo-mark-dark.svg` — white-bar mark for dark surfaces
- `assets/favicon.svg`

## Voice

Sentence case, second person, present tense, no exclamation marks, no emoji, verb-first actions, number-first counts. See README → Content Fundamentals for the full DO/DON'T table.

## Color

One brand hue (HARP Blue, `#2A52CF`) does the heavy lifting. Semantic red/amber/green/purple are rare on purpose. Data-viz is **3 colors only** (blue / green positive / red negative).

## Don't

- Don't invent new colors — use tokens.
- Don't use emoji, Inter/Roboto/Arial, or gradient backgrounds.
- Don't use Outlined or Sharp Material Symbols axes — Rounded only.
- Don't redraw the logo as SVG by hand — copy the file.
- Don't add decorative imagery, stock photos, or background patterns.
