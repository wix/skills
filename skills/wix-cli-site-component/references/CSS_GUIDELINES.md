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
| React | `className="profile-card__title"` | Direct class |
| CSS | `.profile-card__title { ... }` | Same class |
| Manifest | `"selector": ".profile-card__title"` | Same class |

### Naming Convention

```css
/* ✅ BEM-style naming */
.profile-card { }                    /* Block */
.profile-card__image { }             /* Element */
.profile-card__title { }             /* Element */
.profile-card__button { }            /* Element */
.profile-card__button--primary { }   /* Modifier */
```

### Forbidden Selectors

```css
/* ❌ Compound selectors */
.profile-card.featured { }

/* ❌ Descendant selectors */
.profile-card .title { }

/* ❌ Child selectors */
.profile-card > .content { }

/* ✅ Use direct classes only */
.profile-card { }
.profile-card__title { }
.profile-card__content { }
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

## Layout Systems

### Flexbox Patterns

```css
/* Horizontal layout with gap */
.component__row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

/* Vertical layout with stretch */
.component__column {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
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
  gap: 2rem;
}

/* Fixed columns */
.component__layout {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 2rem;
}
```

## Animations and Transitions

### Standard Transitions

```css
/* Hover transitions — be specific, never transition: all */
.component__button {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: transform 150ms ease-out,
              box-shadow 150ms ease-out;
}

.component__button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

/* Focus states — custom accessible focus, never default browser outline */
.component__input:focus {
  outline: 2px solid currentColor;
  outline-offset: 2px;
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
  animation: contentAppear 250ms ease-out;
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
  transition: transform 250ms ease-out,
              opacity 250ms ease-out;
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
- [ ] No external dependencies or imports
