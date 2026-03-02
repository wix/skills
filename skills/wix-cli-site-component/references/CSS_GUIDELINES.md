# CSS Guidelines

Modern CSS patterns for responsive, maintainable site components that integrate with Wix Editor styling controls.

## Core Principles

### No Inline Styles for Static Values

```css
/* ✅ Correct - use CSS classes */
.component {
  padding: 20px;
  border-radius: 8px;
  background-color: #ffffff;
}

/* ❌ Wrong - inline styles for static values */
<div style={{ padding: '20px', borderRadius: '8px' }}>
```

**Inline styles allowed ONLY for JS-computed dynamic values:**

```typescript
// ✅ Correct - dynamic values from props/state
<div style={{
  '--columns': columns,
  '--item-width': `${100 / columns}%`
} as React.CSSProperties}>

// ✅ Correct - computed styles
<div style={{
  transform: `translateX(${offset}px)`,
  opacity: isVisible ? 1 : 0
}}>
```

### CSS Variables for Dynamic Styling

```css
.component {
  --display: block;
  --background-color: #ffffff;
  --text-color: #333333;
  --columns: 1;

  display: var(--display);
  background-color: var(--background-color);
  color: var(--text-color);
  grid-template-columns: repeat(var(--columns), 1fr);
}
```

### Pointer Events (Required)

```css
/* ✅ Required for all manifest elements */
.component,
.component__title,
.component__button {
  pointer-events: auto;
}
```

**Apply to:**
- Root element (editorElement selector)
- All nested elements defined in manifest
- Any selectors targeting manifest elements

### Critical CSS Rules

- **Each selector once only** - do not duplicate selectors
- **`box-sizing: border-box`** on all elements
- **NO `transition: all`** - be specific about transitioned properties
- **NO media queries** (except `prefers-reduced-motion`)
- **Root display**: Declare `--display: [value]` CSS variable, then use `display: var(--display)` on root element

## Responsive Design Strategy

### Container-Based Responsiveness

Components live in user-resizable containers (300-1200px) within varying viewports (375-1920px).

```css
/* ✅ Root element sizing */
.component {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

/* ✅ Flexible layout structure */
.component__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: clamp(1rem, 2.5vw, 2rem);
}

/* ✅ Flexible content */
.component__content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
```

### Fluid Typography

```css
/* ✅ Responsive text scaling */
.component__title {
  font-size: clamp(1.5rem, 4vw, 3rem);
  line-height: 1.2;
}

.component__description {
  font-size: clamp(1rem, 2.5vw, 1.25rem);
  line-height: 1.6;
}

/* ✅ Tight spacing variation */
.component__section {
  margin-bottom: clamp(2rem, 3vw, 3rem);
  padding: clamp(1rem, 2vw, 1.5rem);
}
```

### Layout Patterns

**Single-Column (Mobile-First)**
```css
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 2rem;
  padding: clamp(2rem, 5vw, 4rem);
}
```

**Two-Column Split**
```css
.feature-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(2rem, 4vw, 4rem);
  align-items: center;
}

@container (max-width: 600px) {
  .feature-section {
    grid-template-columns: 1fr;
  }
}
```

**Multi-Column Grid**
```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: clamp(1.5rem, 3vw, 2.5rem);
}
```

## Selector Synchronization

**CRITICAL**: Selectors must match exactly between files:

| File | Format | Example |
|------|--------|---------|
| React | `className="product-card__title"` | Direct class |
| CSS | `.product-card__title { ... }` | Same class |
| Manifest | `"selector": ".product-card__title"` | Same class |

### Naming Convention

```css
/* ✅ BEM-style naming */
.product-card { }                    /* Block */
.product-card__image { }             /* Element */
.product-card__title { }             /* Element */
.product-card__button { }            /* Element */
.product-card__button--primary { }   /* Modifier */
```

### Forbidden Selectors

```css
/* ❌ Compound selectors */
.product-card.featured { }

/* ❌ Descendant selectors */
.product-card .title { }

/* ❌ Child selectors */
.product-card > .content { }

/* ✅ Use direct classes only */
.product-card { }
.product-card__title { }
.product-card__content { }
```

## Box Model and Spacing

### Universal Box Sizing

```css
.component,
.component *,
.component *::before,
.component *::after {
  box-sizing: border-box;
}
```

### Spacing Scale

```css
:root {
  /* Spacing tokens */
  --space-xs: 0.25rem;  /* 4px - tight clustering */
  --space-sm: 0.5rem;   /* 8px - related items */
  --space-md: 1rem;     /* 16px - same category */
  --space-lg: 1.5rem;   /* 24px - form fields */
  --space-xl: 2rem;     /* 32px - sections */
  --space-2xl: 3rem;    /* 48px - major blocks */
  --space-3xl: 4rem;    /* 64px - emphasis */
}

.component {
  padding: var(--space-xl);
  gap: var(--space-lg);
}

.component__section {
  margin-bottom: var(--space-2xl);
}

.component__title {
  margin-bottom: var(--space-md);
}
```

## Color and Theming

### CSS Custom Properties

```css
.component {
  /* Color tokens */
  --color-primary: #007bff;
  --color-secondary: #6c757d;
  --color-success: #28a745;
  --color-danger: #dc3545;
  --color-warning: #ffc107;

  /* Background tokens */
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-accent: #e9ecef;

  /* Text tokens */
  --text-primary: #212529;
  --text-secondary: #6c757d;
  --text-muted: #adb5bd;

  /* Apply colors */
  background-color: var(--bg-primary);
  color: var(--text-primary);
}
```

### Color Usage Patterns

```css
/* ✅ Semantic color usage */
.component__header {
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-accent);
}

.component__button {
  background-color: var(--color-primary);
  color: white;
  border: none;
}

.component__button:hover {
  background-color: color-mix(in srgb, var(--color-primary) 90%, black);
}

.component__text {
  color: var(--text-primary);
}

.component__caption {
  color: var(--text-secondary);
  font-size: 0.875rem;
}
```

## Layout Systems

### Flexbox Patterns

```css
/* Horizontal layout with gap */
.component__row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

/* Vertical layout with stretch */
.component__column {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  height: 100%;
}

/* Space between layout */
.component__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Centered content */
.component__center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}
```

### Grid Patterns

```css
/* Auto-fit grid */
.component__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: var(--space-xl);
}

/* Fixed columns with responsive */
.component__layout {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: var(--space-2xl);
}

@container (max-width: 768px) {
  .component__layout {
    grid-template-columns: 1fr;
  }
}

/* Named grid areas */
.component__page {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar content"
    "footer footer";
  grid-template-columns: 250px 1fr;
  gap: var(--space-lg);
}

.component__header { grid-area: header; }
.component__sidebar { grid-area: sidebar; }
.component__content { grid-area: content; }
.component__footer { grid-area: footer; }
```

## Visual Effects

### Shadows and Depth

```css
/* Shadow scale */
.component {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.15);
}

.component__card {
  box-shadow: var(--shadow-md);
  transition: box-shadow 0.2s ease;
}

.component__card:hover {
  box-shadow: var(--shadow-lg);
}
```

### Border Radius

```css
.component {
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}

.component__card {
  border-radius: var(--radius-lg);
}

.component__button {
  border-radius: var(--radius-md);
}

.component__avatar {
  border-radius: var(--radius-full);
}
```

## Animations and Transitions

### Standard Transitions

```css
.component {
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;

  --ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0.0, 1, 1);
  --ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);
}

/* Hover transitions */
.component__button {
  transition: all var(--duration-fast) var(--ease-out);
}

.component__button:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
}

/* Focus states */
.component__input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  transition: outline var(--duration-fast) var(--ease-out);
}
```

### Content Reveal Animation

```css
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

.component__content {
  animation: contentAppear var(--duration-normal) var(--ease-out);
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .component__content {
    animation: none;
  }

  .component__button {
    transition: none;
  }
}
```

### Loading States

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.component__skeleton {
  background-color: var(--bg-accent);
  border-radius: var(--radius-md);
  animation: pulse 2s infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.component__spinner {
  animation: spin 1s linear infinite;
}
```

## Media Queries (Limited Use)

**Only allowed media query:**

```css
/* ✅ Accessibility - only allowed media query */
@media (prefers-reduced-motion: reduce) {
  .component * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ❌ No other media queries allowed */
@media (max-width: 768px) { } /* Forbidden */
@media (min-width: 1024px) { } /* Forbidden */
```

## Performance Optimizations

### GPU Acceleration

```css
/* ✅ Animate only transform and opacity */
.component__slide {
  transform: translateX(0);
  opacity: 1;
  transition: transform var(--duration-normal) var(--ease-out),
              opacity var(--duration-normal) var(--ease-out);
}

.component__slide--hidden {
  transform: translateX(-100%);
  opacity: 0;
}

/* ✅ Force GPU layer for complex animations */
.component__animated {
  will-change: transform;
  transform: translateZ(0); /* Force GPU layer */
}
```

### Efficient Selectors

```css
/* ✅ Efficient - direct class selectors */
.component { }
.component__title { }
.component__button { }

/* ❌ Inefficient - complex selectors */
.component div p span { }
.component > div:nth-child(2n+1) { }
```

## Validation Checklist

- [ ] All selectors match manifest and React classNames exactly
- [ ] Root element has `width: 100%; height: 100%`
- [ ] All manifest elements have `pointer-events: auto`
- [ ] CSS variables used for dynamic values
- [ ] No inline styles for static values
- [ ] Box-sizing: border-box applied to all elements
- [ ] Responsive design uses modern CSS (no media queries except prefers-reduced-motion)
- [ ] Animations only use transform and opacity
- [ ] Transitions have appropriate durations and easing
- [ ] Color tokens defined and used consistently
- [ ] Spacing scale applied consistently
- [ ] No external dependencies or imports
