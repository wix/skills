# React Component Patterns

Code patterns and common mistakes for Editor React components.

# Part 1: Implementation Patterns

## 1.1 SSR-Safe Implementation

Avoid browser-only APIs at module scope or during render; use them inside `useEffect` with `typeof window !== 'undefined'`.

**❌ Wrong:**

```typescript
const userAgent = window.navigator.userAgent;
```

**✅ Correct:**

```typescript
useEffect(() => {
  if (typeof window !== "undefined") {
    const userAgent = window.navigator.userAgent;
  }
}, []);
```

## 1.2 Element Visibility (Platform-Managed)

See [`PROPS-VS-CSS.md`](PROPS-VS-CSS.md) — element visibility is platform-managed; always render all elements, no conditional rendering.

---

# Part 2: CSS/SCSS Rules

Authoritative SCSS rules: `REACT-GUIDELINES.md` Part 2. For RTL/logical CSS patterns, see [`DIRECTIONALITY.md`](DIRECTIONALITY.md).

## 2.1 What NOT to Include

```scss
// ❌ NEVER include:

// Transitions/Animations
transition: all 0.3s;        // ❌
animation: fadeIn 0.5s;      // ❌
```

> Design states (`hover`, `focus`, `selected`, …) are authored per
> [`DESIGN-STATES.md`](DESIGN-STATES.md).

---

# Part 3: Common Mistakes

## 3.1 Custom-state classes

For a custom design state, toggle the element's **global** state class from
its data in JSX (e.g. `isSelected && 'pricing-card-row--selected'`, using the
component-name-prefixed class) — don't express it as a module-scoped class. State styling lives in [`DESIGN-STATES.md`](DESIGN-STATES.md).

## 3.2 Browser APIs at module scope

**❌ Wrong:**

```typescript
const isMobile = window.innerWidth < 768; // ❌ SSR breaks
```

**✅ Correct:**

```typescript
useEffect(() => {
  if (typeof window !== "undefined") {
    setIsMobile(window.innerWidth < 768);
  }
}, []);
```

## 3.3 Use semantic HTML for collection-style UI

For lists, breadcrumbs, tabs, menus, and similar collection-style UI, render the underlying semantic HTML directly (`<ol>`/`<ul>` + `<li>`, `<nav>`, `<button role="tab">`, etc.) and own the keyboard / ARIA wiring in your own React code.

```tsx
<ol className="breadcrumbs">
  <li>
    <a href="/">Home</a>
  </li>
  <li>
    <span aria-hidden="true">/</span>
    <a href="/products">Products</a>
  </li>
</ol>
```

Handle separators with CSS pseudo-elements or inside each item.

