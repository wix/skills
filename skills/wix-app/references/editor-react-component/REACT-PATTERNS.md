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

State CSS (`:hover`, `:focus`, `:disabled`, `:invalid`, `[data-state]`) is **only** written through the design-states contract — paired pseudo-class + `:global(.<component>--<state>)` rules driven by TSX markers. See [`DESIGN-STATES.md`](DESIGN-STATES.md) for the full procedure. Ad-hoc `:hover` / `:focus` / `:disabled` rules outside that contract still don't belong in component CSS — the platform owns the state surface and only reads paired rules.

---

# Part 3: Common Mistakes

## 3.1 Authoring state CSS

State CSS (`:hover`, `:focus`, `:focus-visible`, `:active`, `:disabled`, `:invalid`, `[data-state]`, `[aria-selected]`) only belongs in component CSS via the **design-states contract** — paired pseudo-class + `:global(.<component>--<state>)` rules with matching TSX markers. The manifest generator reads both signals and emits the editor's `states` block from them. Full procedure (state catalog, default styling, base-class resolution, TSX markers, key collision rule) lives in [`DESIGN-STATES.md`](DESIGN-STATES.md).

A pseudo-class rule **without** a matching `:global(.<component>--<state>)` partner is invisible to the editor — the platform can never apply the user's state styling to that surface. That's why ad-hoc `:hover` rules are still rejected.

Selection / mode variants that are part of the component's own data model (not surfaced as editable design states) still go through a JS-toggled modifier class — see `CSS-GUIDELINES.md` §"Express selection / mode variants".

**❌ Wrong — pseudo-class rule with no paired `:global(.<component>--<state>)`:**

```scss
.button:hover {
  background-color: #f0f0f0;
}
```

**✅ Correct — paired CSS + TSX marker per [`DESIGN-STATES.md`](DESIGN-STATES.md):**

```scss
.button:hover,
.button:global(.button--hover) {
  filter: brightness(1.05);
}

.button[aria-disabled='true'],
.button:global(.button--disabled) {
  opacity: 0.5;
  pointer-events: none;
  cursor: not-allowed;
}
```

```tsx
<button
  className={classNames('button', styles.button)}
  aria-disabled={isDisabled || undefined}
>
```

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
