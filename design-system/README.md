# HARP Design System

HARP is a comprehensive hospital information system spanning 50+ modules across **Clinical**, **Revenue Cycle Management (RCM)**, **Enterprise Resource Planning (ERP)**, and **Analytics**. One platform, many surfaces — used by doctors, nurses, RCM staff, and executives for hours every day.

This design system codifies HARP's visual language, components, and editorial voice so every screen — whether a desktop clinician workstation or a tablet vitals form — feels like the same product.

> **Sources provided:** None. No Figma, codebase, or screenshots were attached at kickoff. The brand, palette, typography, logo, and component patterns in this system were designed from the product brief (Modern · Fast · Calm · Clinical; Google-inspired; soft modern; organized density). **This is a v0 starting point — please share any existing HARP visuals or competitor references so we can tighten the system in the next pass.**

---

# Product context

**Platform shape.** One connected platform, modular access. A nurse logs into the nursing workstation; a coder logs into RCM; a CMO opens the executive dashboard. Same shell, same primitives, scoped surface.

**Density and rhythm.** Clinicians need to see *everything* on one screen — labs, meds, vitals, orders, notes. The system optimizes for **organized density**: small base font (13 px), tight line-height for tables, generous whitespace *between* regions to keep scan paths clear.

**Speed over decoration.** No splash transitions. No decorative gradients. Interaction states are immediate. Charts use ink, not gloss. The product should feel like a tool a clinician trusts at 3 a.m.

**Critical-action signaling.** Allergy alerts, medication verification, and charging verification are first-class. They get dedicated color (red), iconography, and modal patterns that are deliberately interruptive.

---

## Surfaces & patterns

HARP is **one platform, many connected modules** (Clinical, RCM, ERP, Analytics) on a shared shell. Rather than maintain per-product UI kits, the system ships **reusable component patterns** that compose into any module:

| Pattern | What it covers |
| --- | --- |
| **Navigation — collapsible sidebar** | Left nav with hide/show, sections, counts, active state |
| **Page header** | Icon + title + subtitle, breadcrumb, actions, tabs |
| **Action bars & button sets** | Toolbars, button groups, split, segmented, selection & form-footer bars |
| **Card systems — data & viz** | KPI, trend, progress, distribution, donut, list cards |
| **Data table — with pagination** | Sortable header, row select, status chips, pagination footer |

These live in `patterns/` and are built from the same foundations (`colors_and_type.css`, `components.css`). Each module (clinician workstation, nursing tablet, RCM, executive analytics, plus ERP/lab/pharmacy/etc.) is assembled from these patterns — there are no separate product kits to keep in sync.

---

## File index

```
/
├─ README.md                    ← you are here
├─ SKILL.md                     ← Agent Skill entry point
├─ colors_and_type.css          ← all design tokens (light + dark, type, spacing, radii, shadows)
├─ fonts/                       ← (Google Fonts via CDN; no self-hosted files yet — see Typography)
├─ assets/
│  ├─ logo-mark.svg             ← two-pillar mark (full-color gradient)
│  ├─ logo-lockup.svg           ← full-color lockup (primary, light bg)
│  ├─ logo-mark-dark.svg        ← white-bar mark for dark surfaces
│  └─ favicon.svg
├─ preview/                     ← Design System tab cards
│  ├─ type-*.html
│  ├─ colors-*.html
│  ├─ spacing-*.html
│  ├─ components-*.html
│  └─ brand-*.html
└─ patterns/                    ← reusable component patterns (compose into any module)
   ├─ nav-sidebar.html          ← collapsible left navigation
   ├─ page-header.html          ← icon + title + subtitle + actions + tabs
   ├─ action-bars.html          ← toolbars, button groups, selection/footer bars
   ├─ data-cards.html           ← KPI / trend / progress / distribution / list cards
   └─ data-table.html           ← sortable table with pagination
```

(Sections below — Content Fundamentals, Visual Foundations, Iconography — are populated as the system fills in.)

---

## Content Fundamentals

HARP's voice is the voice of a competent colleague at 3 a.m. who has been doing this for fifteen years and respects your time. Calm. Direct. Specific. Never cute.

### Person & tense

- **Second person ("you")** for the active user — *"You haven't verified 3 charges."*
- **No first person ("we", "our")** — HARP is the tool, not a personality.
- **Present tense** for state; **past tense** for completed actions; **future-perfect ("will be submitted")** only when scheduled.
- **Clinical events stated as facts**, not opinions: *"Potassium 5.6 mmol/L — elevated."* not *"Potassium looks a bit high."*

### Casing

- **Sentence case** for everything: titles, buttons, table headers, menu items. Title Case looks marketing-y; HARP is not marketing.
- **UPPERCASE** reserved for section captions and 11px micro-labels (`.t-caps`) — never for prose.
- **Code, IDs, codes** always mono: `MRN 038104`, `CPT 99213`, `ICD-10 I10`.

### Sentence shape

- **Short.** Most UI strings are < 10 words.
- **Verb-first** for actions: *"Verify order"*, *"Hold all orders"*, *"Add note."* Not "Click here to verify."
- **Number-first** for counts: *"3 charges need verification"*, not *"There are 3 charges that need…"*
- **No exclamation marks.** Ever. Critical alerts use the red color and the word "Critical" or the specific reaction, not a "!".

### Forbidden

- 😀 **Emoji** — never in product UI. Reserved for nothing.
- ✨ **Marketing flourishes** — "Awesome!", "Looks like…", "Oops", "Uh-oh", "Let's get started."
- **Conversational hedging** — "might", "perhaps", "kind of", "sort of." Be definite.
- **Apologizing for the user.** Don't say "we couldn't" — say what's wrong: *"Order requires attending co-sign."*
- **Friend mode.** No "Hey," no "👋", no first-name address inside the app shell.

### Allowed (intentionally)

- **Medical abbreviations** when they're standard in the workflow (MRN, DOS, NPO, BID, PRN, A1C). The audience reads these daily.
- **Currency formatted with cents** ($4,820.00) — never round; coders need the cents.
- **Mathematical units inline** (mmol/L, °F, mg/dL, bpm, %).
- **The em-dash** for separating a value from its context: *"Heparin drip — awaiting verification"*.

### Examples · DO / DON'T

| ✅ Use | ❌ Don't use |
| --- | --- |
| Patient has a severe penicillin allergy. Order blocked. | Uh-oh — looks like an allergy concern 🤔 |
| 3 charges need verification before submission. | Hey! You've got a few items waiting on your review. |
| Saved · 11:42 AM | Awesome! Your changes were saved successfully ✨ |
| Potassium 5.6 mmol/L — elevated. | Potassium is a bit on the high side. |
| Order requires attending co-sign. | Sorry, we couldn't process that order. |

### Notification length

| Surface | Max length |
| --- | --- |
| Toast | 8 words |
| Inline alert title | 10 words |
| Inline alert body | 25 words |
| Modal title | 6 words |
| Modal body | 50 words; longer goes to a panel |

---

## Visual Foundations

The aesthetic is **soft modern, calm clinical, organized density**. Every choice below ladders up to this. When in doubt: reduce, align, make it readable from 24 inches away.

### Color

- **Single hue does the heavy lifting.** HARP Blue (`oklch(54% 0.16 260)` ≈ `#2A52CF`) is the brand and the primary action; everything else is grayscale.
- **Semantic colors are kept rare on purpose** — when you *do* see red, it means something. Four semantic hues: red (critical), amber (warning), green (success/normal), blue (info).
- **Data-viz** uses 3 core polarity hues — blue (primary/neutral), green (positive), red (negative) — plus contextual amber/info/neutral and two ramps (diverging, sequential). Cap a single chart at \~5 hues; beyond that use small multiples.
- **Neutrals are cool slate (hue 255)**, a slight blue cast, so the UI reads crisp and clinical. Pure white is reserved for surfaces; the page background is the slightly cooler `gray-50`.

### Type

- **Google Sans** (self-hosted) for everything UI and display — wordmark, headers, body, labels, tables. Weights: 400 · 500 · 700 (a 600 semibold request resolves to 700 Bold).
- **Geist Mono** for IDs, codes, timestamps, table numerics. Tabular numerals on by default in `.tabular-nums`, tables, and `.metric-value`.
- **No serif.** No emoji glyphs. No second sans family — Google Sans is the only sans.
- **Scale is small.** Base UI text is **13 px** on desktop, **14 px** on tablet. Tables can drop to 12. Display sizes top out around 48 px and are used sparingly (only on dashboards and exec materials).

### Density

- **Default row height 28 px** on desktop, **40 px** on tablet, **48 px** on mobile (the latter respects the 44 px touch-target minimum).
- **Inputs and default buttons are 36 px** — generous enough to look modern, tight enough to fit 30+ rows of clinical data on one screen.
- **Padding inside panels is 14–18 px**; outer page padding is 22 px.

### Backgrounds & imagery

- **No background photography.** No stock imagery. No medical-stock photos of stethoscopes on tables.
- **No decorative gradients.** The single exception: the brand "stage" surface (sign-in, exec dashboard hero) uses a subtle navy radial gradient (≤ 18 % opacity) to give the navy field depth.
- **No textures, no patterns, no grain.** Clinical screens are flat and ink-on-paper.
- **No full-bleed hero shots** anywhere in product. Hero space, when needed, is reserved for KPI displays and dashboards.

### Borders

- **1 px hairlines** in `var(--border-1)` everywhere. Borders are the primary separator; we lean on them more than shadow.
- **Stronger borders (`--border-2` and `--border-3`)** only on interactive elements (button outlines, focused inputs).
- **Table dividers are even fainter** (`--border-subtle`) so rows scan as a single block.

### Shadows / elevation

- **Four levels.** Level 1 (cards), 2 (menus, hover), 3 (popovers), 4 (modals/sheets). All low-spread, cool, less than 0.14 alpha.
- **Light-mode shadows use a cool slate tint**, not pure black, so they recede.
- **Dark-mode shadows are deeper black** (up to 0.5 alpha) because backgrounds absorb light.

### Focus ring

- **Single token** (`--shadow-focus`) used on every focusable element — 3 px outer ring in HARP Blue at 0.30 alpha. The critical variant is in red at the same alpha for danger buttons.

### Corner radii

- **3 / 5 / 8 / 12 / 16 / pill.** Buttons live at 6–10, cards at 8, modals/sheets at 12–16, status pills are fully rounded. Avoid going above 16 px unless you're on a mobile sheet.

### Hover / press / selected states

- **Hover** lifts color by one step or applies a 4–10 % black/white overlay. Never use a gradient on hover; never animate scale on hover (it conveys a level of preciousness HARP doesn't have).
- **Press** drops one shade darker and translates the element 0.5–1 px down. No bounce, no ripple.
- **Selected** uses `--accent-tint` (HARP Blue at \~8 % alpha) as the background and `--accent-fg` as the text. A 3 px left accent bar is used on left-rail items.
- **Disabled** is opacity 0.40 + saturate 0.5. Pointer events off.

### Transparency & blur

- **No glassmorphism.** No backdrop-filter. Clinical UI must be legible even when print-screened or screen-shared at low quality.
- **Scrim** (modal backdrop) is a 48 % dark slate overlay (`--bg-scrim`), no blur.

### Animation

- **Fast and calm.** Easing is a Material-style standard curve `cubic-bezier(0.2, 0, 0, 1)`. Tokens: `--dur-instant 80ms`, `--dur-fast 140ms`, `--dur-base 220ms`, `--dur-slow 320ms`.
- **State changes** (hover, press) are `--dur-instant`. **Panel slides and menus** use `--dur-base`. **Modals** are `--dur-slow`.
- **No spring physics.** No bounce. No parallax.
- **Loading** is a thin 2 px progress bar at the bottom edge of the button, animating left-to-right (see `.btn--loading`). No spinning rings inside buttons — the spinner is reserved for full-page loading.

### Layout rules

- **The shell is fixed.** Topbar is sticky-top; sidebar is fixed-left; main scrolls. On tablet, the sidebar collapses to a 72 px icon rail.
- **Patient banner** in clinical surfaces is also sticky — identity and allergies must never leave the viewport while you're in a chart.
- **CTA bars** in form-heavy surfaces (vitals entry, claim verification) stick to the bottom of the main column.

### Cards

- White (`--bg-surface`) on the off-white canvas, 1 px hairline border, 8 px radius. No drop shadow at rest. A subtle `--shadow-1` only when the card is hovering above a busy bg (e.g. dashboard KPI cards).
- Headers are 14 px medium with a 1 px bottom hairline. Body padding 14 px.

---

## Iconography

**Material Symbols Rounded** (Google Fonts variable icon font) is the canonical HARP icon set. Loaded via CDN in `colors_and_type.css`.

### Rules

- **Rounded axis** only — the Sharp and Outlined axes are off-brand. Rounded fits the "soft modern, calm clinical" feel.
- **Weight 300** by default (thin line). This is set globally on `.icon` and `.material-symbols-rounded`. It's the most modern look and pairs well with Google Sans.
- **Size 20 px** at default, 16 px for inline-with-text contexts (`.icon--sm`), 24 px for headers / KPI labels (`.icon--lg`).
- **Fill 0** by default; **Fill 1** (`.icon--filled`) is reserved for active states, critical alerts, and primary-action chips. Don't fill an icon to "make it pop" — fill carries semantic weight.
- **Color follows context.** Icons inherit `currentColor` and are colored via the parent's CSS color (`--fg-2` typical, `--critical` for severity, `--accent` for active).

### Usage

```html
<span class="icon">stethoscope</span>            <!-- default -->
<span class="icon icon--sm">filter_list</span>   <!-- inline -->
<span class="icon icon--lg">analytics</span>     <!-- header -->
<span class="icon icon--filled" style="color: var(--critical)">warning</span>
```

### Canonical icons by domain

| Domain | Icons |
| --- | --- |
| Clinical | `stethoscope` · `medication` · `vaccines` · `monitor_heart` · `science` · `bed` · `ambulance` · `health_and_safety` |
| Documentation | `edit_note` · `description` · `note_add` · `forward_to_inbox` · `verified` |
| RCM / coding | `receipt_long` · `rule` · `hourglass_top` · `payments` · `approval` · `tag` · `flag` |
| Analytics | `analytics` · `trending_up` · `space_dashboard` · `public` |
| Navigation | `search` · `filter_list` · `expand_more` · `arrow_back` · `menu` · `more_horiz` · `close` |
| Severity | `warning` (filled, critical) · `priority_high` (warning) · `check_circle` (success) · `info` (info) |

### Emoji & unicode

- **Emoji: never** in product UI. Not in copy, not in icons, not in placeholders.
- **Unicode symbols** are fine in three specific places: degree (°F), arrows in copy (↑ ↓), and the em-dash (—). Beyond that, prefer Material Symbols.

### Substitution notice

**No icons were imported from a HARP codebase or Figma** (no source was provided at kickoff). Material Symbols was chosen as a Google-aligned, comprehensive substitute. If a future codebase has its own icon system, swap the import in `colors_and_type.css` and update the canonical-icons table above.

### Font notice

**Google Sans** is the single sans/display family (self-hosted from supplied TTFs: 400/500/700). **Geist Mono** (Google Fonts) is the only secondary face, kept strictly for monospace contexts. If HARP commissions a custom typeface, swap `--font-sans` / `--font-display` (and optionally `--font-mono`) in `colors_and_type.css`.\` tokens can swap to it without touching component code.

---

## File index

```
/
├─ README.md                    ← you are here
├─ SKILL.md                     ← Agent Skill entry point
├─ colors_and_type.css          ← all design tokens (light + dark, type, spacing, radii, shadows)
├─ components.css               ← buttons, fields, badges, alerts, tables, tabs, menus, panels
├─ shell.css                    ← topbar + sidebar app-shell chrome (foundation)
├─ assets/
│  ├─ logo-mark.svg             ← Wave + pulse-dot on navy
│  ├─ logo-lockup.svg           ← HARP wordmark + wave underline (primary logo)
│  ├─ logo-mark-dark.svg        ← white-only mark for dark surfaces
│  └─ favicon.svg
├─ preview/                     ← Design System tab cards (registered as assets)
│  ├─ _card.css                 ← shared card chrome
│  ├─ type-*.html               ← Google Sans, scale, mono, numerals
│  ├─ colors-*.html             ← blue, neutrals, semantic, surfaces, data-viz + examples
│  ├─ spacing-*.html            ← scale, density, radii, shadows
│  ├─ components-*.html         ← buttons, fields, badges, alerts, tables, tabs, menus
│  └─ brand-*.html              ← logo, logo-dark, icons, voice
└─ patterns/                    ← reusable component patterns
   ├─ nav-sidebar.html          ← collapsible left navigation
   ├─ page-header.html          ← icon + title + subtitle + actions + tabs
   ├─ action-bars.html          ← toolbars, button groups, selection/footer bars
   ├─ data-cards.html           ← KPI / trend / progress / distribution / list cards
   └─ data-table.html           ← sortable table with pagination
```

Each UI-kit folder has its own `README.md` describing components and demonstrated patterns.
