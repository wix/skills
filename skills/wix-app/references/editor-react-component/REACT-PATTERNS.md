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

State CSS (`:hover`, `:focus`, `:disabled`, `:invalid`, `[data-state]`) is **only** written through the design-states contract — paired pseudo-class + `:global(.<component>--<state>)` rules driven by TSX markers. See [`DESIGN-STATES.md`](DESIGN-STATES.md). Ad-hoc rules outside that contract don't belong in component CSS — the platform owns the state surface and only reads paired rules.

---

# Part 3: Common Mistakes

## 3.1 Authoring state CSS

State CSS (`:hover`, `:focus`, `:focus-visible`, `:active`, `:disabled`, `:invalid`, `[data-state]`, `[aria-selected]`) only belongs in component CSS via the **design-states contract** — paired pseudo-class + `:global(.<component>--<state>)` rules with matching TSX markers. A pseudo-class rule without its `:global(.<component>--<state>)` partner is invisible to the editor. Full procedure (state catalog, default styling, base-class resolution, TSX markers, collision rule) lives in [`DESIGN-STATES.md`](DESIGN-STATES.md).

Selection / mode variants that are part of the component's own data model (not surfaced as editable design states) still go through a JS-toggled modifier class — see `CSS-GUIDELINES.md` §"Express selection / mode variants".

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
