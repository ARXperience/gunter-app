---
name: Obsidian Intelligence
colors:
  surface: '#0c1324'
  surface-dim: '#0c1324'
  surface-bright: '#33394c'
  surface-container-lowest: '#070d1f'
  surface-container-low: '#151b2d'
  surface-container: '#191f31'
  surface-container-high: '#23293c'
  surface-container-highest: '#2e3447'
  on-surface: '#dce1fb'
  on-surface-variant: '#c5c6cb'
  inverse-surface: '#dce1fb'
  inverse-on-surface: '#2a3043'
  outline: '#8e9195'
  outline-variant: '#44474a'
  surface-tint: '#c1c7cf'
  primary: '#ffffff'
  on-primary: '#2b3137'
  primary-container: '#dde3eb'
  on-primary-container: '#5f656c'
  inverse-primary: '#595f66'
  secondary: '#bcc7de'
  on-secondary: '#263143'
  secondary-container: '#3e495d'
  on-secondary-container: '#aeb9d0'
  tertiary: '#ffffff'
  on-tertiary: '#283044'
  tertiary-container: '#dae2fd'
  on-tertiary-container: '#5c647a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dde3eb'
  primary-fixed-dim: '#c1c7cf'
  on-primary-fixed: '#161c22'
  on-primary-fixed-variant: '#41474e'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#dae2fd'
  tertiary-fixed-dim: '#bec6e0'
  on-tertiary-fixed: '#131b2e'
  on-tertiary-fixed-variant: '#3f465c'
  background: '#0c1324'
  on-background: '#dce1fb'
  surface-variant: '#2e3447'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-padding: 24px
  gutter: 16px
  section-gap: 48px
---

## Brand & Style

The design system is anchored in the concept of "Silent Intelligence"—a sophisticated, high-end aesthetic that prioritizes calm authority over aggressive visual noise. It is designed for an elite user base that values privacy, efficiency, and understated luxury. 

The visual style blends **Minimalism** with **Glassmorphism**, utilizing depth and translucency to suggest an interface that exists as a light layer over a deep, infinite digital space. The emotional response is one of trust and focus; the UI does not demand attention but rewards it with precise, elegant feedback and a tactile sense of quality.

## Colors

The palette is a nocturnal spectrum designed to minimize eye strain and maximize the premium feel of the interface.

- **Primary (Brushed Silver):** Used for primary actions, high-level headings, and active states. It should feel metallic and sharp.
- **Secondary (Midnight Blue):** Used for interactive surfaces and subtle highlights.
- **Tertiary (Obsidian):** The foundation for container backgrounds and elevated surfaces.
- **Neutral (Deep Black):** The base canvas color, creating a true "infinite" background.

Functional colors (Success, Warning, Error) must be desaturated to maintain the "understated luxury" theme, using deep emeralds and muted crimsons rather than bright neon shades.

## Typography

The design system utilizes **Inter** for its systematic, utilitarian precision. The typographic hierarchy relies on subtle weight shifts and generous line heights rather than extreme size differentials. 

To achieve the "High-End" look:
- Use **Display-LG** sparingly for dashboard welcomes or empty states.
- **Label-SM** should be used for metadata and small headers, always with increased letter spacing to enhance legibility on dark backgrounds.
- All text should utilize `antialiased` rendering to maintain the "brushed" feel of the typography against the obsidian canvas.

## Layout & Spacing

This design system employs a **Fluid Grid** with fixed maximum widths for content readability. The rhythm is based on an 8px linear scale.

- **Desktop:** 12-column grid, 1200px max-width, 24px gutters.
- **Tablet:** 8-column grid, 16px gutters.
- **Mobile:** 4-column grid, 16px margins.

Layouts should favor asymmetric compositions to feel more "editorial" and less "templated." Use generous whitespace (section-gap) to separate distinct cognitive tasks, ensuring the personal assistant feels spacious and unhurried.

## Elevation & Depth

Depth is achieved through **Glassmorphism** and **Tonal Layering** rather than traditional drop shadows.

1.  **Base Layer:** `#020617` (True Black).
2.  **Surface Layer:** Semi-transparent Obsidian (`#0F172A` at 60% opacity) with a 20px Backdrop Blur.
3.  **Accent Layer:** Brushed Silver borders (1px, 10% opacity) to define edges without creating heavy visual weight.

Shadows, when used, are "Ambient Shadows"—extremely diffused, large radius (30px+), and low opacity (15%), serving to lift glass panels off the background rather than casting a hard silhouette.

## Shapes

The shape language is "Sophisticated Geometric." We use **Rounded (0.5rem)** as the base to strike a balance between the precision of technology and the softness of a personal assistant.

- Large containers and cards use `rounded-xl` (1.5rem).
- Interactive inputs and buttons use `rounded-md` (0.5rem).
- Avoid completely round "pills" unless used for status indicators, as they can feel too casual for this specific brand narrative.

## Components

### Buttons
Primary buttons feature a subtle linear gradient (Brushed Silver to Ash) with dark text. Secondary buttons are ghost-style with a 1px border and a low-opacity hover fill.

### Input Fields
Inputs are dark-filled with a subtle bottom-border accent. On focus, the border transitions to the primary silver, and the background blur intensity increases slightly.

### Cards
Cards are the primary expression of glassmorphism. They must feature a 1px "inner glow" border on the top and left sides to simulate light hitting a physical edge.

### Chips/Tags
Small, low-contrast elements used for categorization. They should have no background fill, only a subtle silver border and uppercase label-sm text.

### Refined Transitions
All component states (hover, active, focus) must use long duration, ease-out transitions (300ms+) to maintain the sense of "elegant" movement. Avoid "snappy" or "bouncy" animations.