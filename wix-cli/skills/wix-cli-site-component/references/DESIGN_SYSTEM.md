# Design System Guidelines

Creative design principles for building distinctive, award-winning site components that avoid generic "AI slop" aesthetics.

## 1. Spacing as Communication

Spacing communicates relationships and hierarchy—not decoration.

### Semantic Roles

| Role | Purpose | Implementation |
|------|---------|----------------|
| **Padding** | Internal breathing room | Prevents cramped layouts |
| **Gap** | Relationship indicator | Consistent gaps = visual unity |
| **Margin** | Section separation | Clear boundaries between major blocks |
| **Whitespace** | Focus amplifier | Strategic emptiness = premium feel |

### Spacing Scale

| Relationship | Value | Use Case | Example |
|---|---|---|---|
| Tight (icon + label) | 0.25-0.5rem (4-8px) | Clustering related items | Button icon + text |
| Same category | 1-1.5rem (16-24px) | Card sections, form fields | Title + description |
| Different sections | 2-3rem (32-48px) | Major content blocks | Hero + features |
| Emphasis/Drama | 4rem+ (64px+) | Hero content, luxury feel | Landing page sections |

### Generous Whitespace Examples

Create sophistication and clarity with spacious layouts:

```css
.hero-section {
  padding: clamp(4rem, 8vw, 8rem) clamp(2rem, 4vw, 4rem);
  margin-bottom: clamp(4rem, 6vw, 6rem);
}

.feature-grid {
  gap: clamp(2.5rem, 4vw, 4rem);
  margin: clamp(3rem, 5vw, 5rem) 0;
}

.card-content {
  padding: clamp(1.5rem, 3vw, 2.5rem);
}
```

## 2. Alignment as Intent

Every alignment choice must support comprehension and flow—never default.

### Principles

- **Proximity**: Group related elements
- **Consistency**: Same pattern for same type
- **Balance**: Distribute visual weight
- **Scanability**: Guide the eye naturally

### Alignment Patterns

| Element Type | Horizontal | Vertical | Reasoning |
|---|---|---|---|
| Body text, lists | Left | Top | Natural reading flow |
| Headlines, CTAs | Center | Center | Draw attention |
| Metadata, timestamps | Right | — | Secondary information |
| Form inputs | Stretch | — | Maximize usability |

```css
/* Left-aligned content */
.content-block {
  text-align: left;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* Center-aligned hero */
.hero-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Right-aligned metadata */
.card-meta {
  text-align: right;
  margin-left: auto;
}
```

## 3. Layout Patterns

Choose patterns that serve the component's purpose—don't default to the first idea.

### Single-Column (Focused Actions)

**When to use:** Simple, focused content (hero, single CTA)
**Spacing strategy:** Generous vertical gaps (2-3rem)
**Best for:** Mobile-first, focused actions

```css
.single-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(2rem, 4vw, 3rem);
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
}
```

### Two-Column Split (Contrasting Content)

**When to use:** Contrasting content (image + text)
**Spacing strategy:** Balance weight with whitespace
**Best for:** Product cards, profiles

```css
.two-column-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(2rem, 4vw, 4rem);
  align-items: center;
}

@container (max-width: 600px) {
  .two-column-split {
    grid-template-columns: 1fr;
    gap: clamp(1.5rem, 3vw, 2rem);
  }
}
```

### Grid/Multi-Column (Repeating Items)

**When to use:** Repeating items (galleries, cards)
**Spacing strategy:** Consistent gaps, subtle depth
**Best for:** Collections, dashboards

```css
.multi-column-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: clamp(1.5rem, 3vw, 2.5rem);
}
```

### Stacked + Emphasis (Primary + Metadata)

**When to use:** Primary + metadata (pricing)
**Spacing strategy:** Large top element, smaller secondary
**Best for:** Pricing, announcements

```css
.stacked-emphasis {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.stacked-emphasis__primary {
  font-size: clamp(2rem, 5vw, 4rem);
  font-weight: 700;
  line-height: 1.1;
}

.stacked-emphasis__secondary {
  font-size: clamp(0.875rem, 2vw, 1rem);
  opacity: 0.7;
}
```

## 4. Visual Consistency

All similar elements must share the same visual DNA.

### Corner Radius Strategy

| Style | Range | Use Case | Personality |
|-------|-------|----------|-------------|
| Sharp | 0-4px | Editorial, Luxury, Technical | Precise, modern |
| Rounded | 6-12px | Contemporary, Professional | Friendly, approachable |
| Soft | 16px+ | Playful, Consumer | Warm, casual |

**Rule:** All buttons same radius, all cards same radius, all inputs same radius

```css
:root {
  --radius-sharp: 2px;
  --radius-rounded: 8px;
  --radius-soft: 16px;
}

.button { border-radius: var(--radius-rounded); }
.card { border-radius: var(--radius-rounded); }
.input { border-radius: var(--radius-rounded); }
```

### Shadow Levels (Max 3)

```css
:root {
  --shadow-rest: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-floating: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.card {
  box-shadow: var(--shadow-rest);
  transition: box-shadow 0.2s ease;
}

.card:hover {
  box-shadow: var(--shadow-hover);
}

.modal {
  box-shadow: var(--shadow-floating);
}
```

### Element Heights

Consistent heights create visual rhythm:

```css
:root {
  --height-input: 44px;
  --height-button: 44px;
  --height-nav: 60px;
}

.input,
.button,
.select {
  height: var(--height-input);
}
```

## 5. Color Strategy

Color creates hierarchy, zones, and rhythm—not just decoration.

### Token Usage Philosophy

- **Backgrounds**: Use accent tints for section backgrounds, base-1 for primary
- **Depth**: Mid-tone shades for layering, subtle background shifts
- **Emphasis**: Vibrant accents for CTAs, highlights, focus states
- **Text**: High contrast for readability

### Color Palette Structure

```css
:root {
  /* Base colors */
  --color-base-1: #ffffff;
  --color-base-2: #f8fafc;
  --color-base-3: #e2e8f0;
  --color-base-4: #cbd5e1;

  /* Accent colors */
  --color-accent-1: #3b82f6;  /* Primary brand */
  --color-accent-2: #8b5cf6;  /* Secondary brand */
  --color-accent-3: #06b6d4;  /* Tertiary accent */
  --color-accent-4: #10b981;  /* Success/positive */

  /* Text colors */
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-muted: #94a3b8;
}
```

### Color Application Patterns

```css
/* Section backgrounds with subtle tints */
.hero-section {
  background: linear-gradient(135deg, var(--color-base-1) 0%, var(--color-base-2) 100%);
}

.feature-section {
  background-color: var(--color-base-2);
}

/* Emphasis through color variety */
.cta-primary {
  background-color: var(--color-accent-1);
  color: white;
}

.cta-secondary {
  background-color: var(--color-accent-2);
  color: white;
}

/* Zoning with background shifts */
.sidebar {
  background-color: var(--color-base-2);
  border-right: 1px solid var(--color-base-3);
}
```

## 6. Typography as Structure

Typography creates hierarchy without relying on color.

### Font Selection Principles

1. **Establish Clear Hierarchy**: Use font size and weight for visual hierarchy
2. **Maintain Consistency**: Apply font stack and sizing scale consistently
3. **Anchor & Pair**: Pair fonts that complement each other

### Hierarchy Rules

- **Max 3 levels** per component
- **Size contrast**: Headlines 1.5-2x body size minimum
- **Weight contrast**: 700 for emphasis, 400-500 for body

```css
:root {
  /* Type scale */
  --text-xs: clamp(0.75rem, 1.5vw, 0.875rem);
  --text-sm: clamp(0.875rem, 2vw, 1rem);
  --text-base: clamp(1rem, 2.5vw, 1.125rem);
  --text-lg: clamp(1.125rem, 3vw, 1.25rem);
  --text-xl: clamp(1.25rem, 3.5vw, 1.5rem);
  --text-2xl: clamp(1.5rem, 4vw, 2rem);
  --text-3xl: clamp(2rem, 5vw, 3rem);
  --text-4xl: clamp(3rem, 6vw, 4rem);
}

.heading-1 {
  font-size: var(--text-4xl);
  font-weight: 700;
  line-height: 1.1;
}

.heading-2 {
  font-size: var(--text-2xl);
  font-weight: 600;
  line-height: 1.2;
}

.body-text {
  font-size: var(--text-base);
  font-weight: 400;
  line-height: 1.6;
}
```

### Legibility Guidelines

```css
/* Optimal line heights */
.heading { line-height: 1.1-1.3; }
.body-text { line-height: 1.5-1.7; }

/* Optimal line lengths */
.readable-content {
  max-width: 65ch; /* 45-75 characters optimal */
}

/* Prevent orphans */
.heading {
  text-wrap: balance; /* CSS Text Level 4 */
}
```

## 7. Motion System

All animations: pure CSS, smooth, purposeful.

### Timing Standards

| Interaction | Duration | Easing | Use Case |
|---|---|---|---|
| Hover, click | 150-200ms | `ease-out` | Immediate feedback |
| Active states | 250ms | `ease-out` | State changes |
| Content reveals | 400-500ms | `ease-out` or spring | Page transitions |

### Easing Functions

```css
:root {
  --ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0.0, 1, 1);
  --ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### Standard Animations

```css
/* Content reveal */
@keyframes contentAppear {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Hover lift */
.interactive-card {
  transition: transform 200ms var(--ease-out),
              box-shadow 200ms var(--ease-out);
}

.interactive-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-hover);
}

/* Focus ring */
.focusable:focus {
  outline: 2px solid var(--color-accent-1);
  outline-offset: 2px;
  transition: outline 150ms var(--ease-out);
}
```

### Performance Rules

- **Only animate** `transform` and `opacity` (GPU-accelerated)
- **Respect** `prefers-reduced-motion`
- **No looping** (except loading spinners)

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 8. Creative Exploration

Push beyond the obvious. Award-winning design comes from exploring multiple creative directions.

### Trigger Questions

1. **"What are 3 different layout approaches for this?"** → Sketch mentally before choosing
2. **"What would make a user say 'wow'?"** → Aim for delight, not just function
3. **"How can proportion create interest?"** → Vary sizes, use asymmetry intentionally
4. **"What interaction details would feel polished?"** → Hover states, micro-animations

### Creative Pattern Ideas

#### Cards & Containers

```css
/* Asymmetric grid (60/40 split) */
.asymmetric-card {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 2rem;
}

/* Overlapping elements with z-index */
.overlapping-card {
  position: relative;
}

.overlapping-card__image {
  position: relative;
  z-index: 1;
}

.overlapping-card__content {
  position: relative;
  z-index: 2;
  margin-top: -2rem;
  background: white;
  border-radius: 12px;
  padding: 2rem;
}

/* Thick accent border */
.accent-border-card {
  border-left: 4px solid var(--color-accent-1);
  padding-left: 1.5rem;
}

/* Color blocking backgrounds */
.color-block-card {
  background: linear-gradient(135deg, var(--color-accent-1) 0%, var(--color-accent-2) 100%);
  color: white;
}
```

#### Lists & Collections

```css
/* Alternating styles */
.alternating-list .item:nth-child(odd) {
  background-color: var(--color-base-2);
  border-radius: 8px;
}

.alternating-list .item:nth-child(even) {
  box-shadow: var(--shadow-rest);
  border-radius: 8px;
}

/* Spotlight pattern (every 3rd item larger) */
.spotlight-grid .item:nth-child(3n) {
  grid-column: span 2;
  font-size: 1.25em;
}

/* Horizontal scroll with varied widths */
.varied-scroll {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
}

.varied-scroll .item:nth-child(odd) { min-width: 200px; }
.varied-scroll .item:nth-child(even) { min-width: 300px; }
```

#### Interactive Elements

```css
/* Split buttons (action + dropdown) */
.split-button {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
}

.split-button__action {
  flex: 1;
  border-radius: 0;
}

.split-button__dropdown {
  width: 40px;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
}

/* Icons in colored circles */
.icon-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: var(--color-accent-1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

/* Large toggles with smooth transitions */
.large-toggle {
  width: 60px;
  height: 32px;
  border-radius: 16px;
  background-color: var(--color-base-3);
  position: relative;
  transition: background-color 300ms var(--ease-out);
}

.large-toggle::after {
  content: '';
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 4px;
  left: 4px;
  transition: transform 300ms var(--ease-spring);
}

.large-toggle:checked {
  background-color: var(--color-accent-1);
}

.large-toggle:checked::after {
  transform: translateX(28px);
}
```

#### Content Hierarchy

```css
/* Large numbers (3-4x size for stats) */
.stat-number {
  font-size: clamp(3rem, 8vw, 6rem);
  font-weight: 900;
  line-height: 0.9;
  color: var(--color-accent-1);
}

/* Quote callouts */
.quote-callout {
  border-left: 4px solid var(--color-accent-1);
  background-color: var(--color-base-2);
  padding: 2rem;
  margin: 3rem 0;
  font-style: italic;
  font-size: 1.25em;
}

/* Pill badges */
.pill-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  background-color: var(--color-accent-1);
  color: white;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 500;
}
```

#### Spacing Drama

```css
/* Hero sections with dramatic padding */
.dramatic-hero {
  padding: clamp(6rem, 12vw, 12rem) clamp(2rem, 4vw, 4rem);
}

/* Asymmetric margins */
.asymmetric-section {
  margin-top: clamp(1.5rem, 3vw, 2rem);
  margin-bottom: clamp(2.5rem, 5vw, 4rem);
}

/* Tight clustering + huge gaps */
.cluster-and-gap {
  display: flex;
  flex-direction: column;
}

.cluster-and-gap .cluster {
  display: flex;
  gap: 0.5rem; /* Tight clustering */
  margin-bottom: 3rem; /* Huge gap between groups */
}
```

## 9. Forbidden Patterns (Anti-LLM-Default)

**Never use these unless explicitly requested:**

### Generic Shadows
```css
/* ❌ Generic AI default */
box-shadow: 0 2px 4px rgba(0,0,0,0.1);

/* ✅ Use defined shadow levels */
box-shadow: var(--shadow-rest);
```

### Default Browser Outlines
```css
/* ❌ Default browser outline */
button:focus {
  outline: auto;
}

/* ✅ Custom accessible focus */
button:focus {
  outline: 2px solid var(--color-accent-1);
  outline-offset: 2px;
}
```

### Decorative Elements
- ❌ Accent lines above titles
- ❌ Emojis or decorative shapes (unless core to request)
- ❌ Looping animations (only for loading states)
- ❌ Center-aligned multi-line body text

### Overused Aesthetics
- ❌ Purple gradients on white backgrounds
- ❌ Inter, Roboto, Arial, system fonts
- ❌ Cookie-cutter card layouts
- ❌ Predictable color schemes

### Creative Alternatives

Instead of defaults, explore:
- **Unique fonts**: Playfair Display, Crimson Text, Space Grotesk
- **Bold color choices**: Deep blues with warm oranges, forest greens with cream
- **Unexpected layouts**: Diagonal grids, overlapping sections, asymmetric compositions
- **Contextual design**: Match the component's purpose and brand personality
