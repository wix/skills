# React Implementation Guide

Use this reference when planning or editing the component's React implementation.
The entry workflow remains authoritative; this file owns implementation decisions.

## Plan the Component

For a new component, make every decision below. For an edit, revisit only the
contracts changed by the request:

1. Elect the best semantic root and identify independently editable inner parts.
2. Separate user-authored content and stable behavior from derived values and
   visual styling.
3. Identify interaction and selectable states affected by the request.
4. Keep implementation behavior internal unless the component specification
   requests a public callback.
5. Identify runtime concerns such as browser APIs, autoplay, editor-only
   behavior, or live site context before implementation.

## Implementation Rules

### Runtime Compatibility

- Use React 18-compatible APIs. Do not use React 19-only runtime features.
- Keep rendering SSR-safe and deterministic. Do not access browser globals
  during render or derive initial output from time-dependent/generated values.

### TypeScript

- Fully type component props and export the props type.
- Do not use `any`.
- Use `Array<T>` rather than `T[]`; exported array elements must be objects with
  named keys.
- Export the component as an arrow function, accept `props` as its argument,
  and destructure inside the function body.

```tsx
export const ProfileCard: React.FC<ProfileCardProps> = (props) => {
  const { heading } = props;
  return <article>{heading}</article>;
};
```

### Props and State

- Keep `id`, `className`, `direction`, and `a11y` in the public contract.
- Compute simple derived values during render instead of duplicating them in
  props or state.
- When local state intentionally mirrors a prop, synchronize it when that prop
  changes. Do not use effect-managed state for a value that can be derived
  during render.
- Keep implementation-only handlers internal. Expose a callback only when the
  specification makes it part of the component API.

### Structure and Parts

- Apply the root contract to the elected semantic root; do not add a wrapper
  solely to hold `id`, `dir`, classes, or ARIA attributes.
- Give every named inner part a matching `elementProps` entry and spread it onto
  that element. Merge its injected `className` on raw HTML elements.
- Keep structural wrappers and decorative elements module-class-only.
- Use semantic HTML for controls, lists, navigation, headings, and landmarks.

### Accessibility and Direction

- Route ARIA through the typed `a11y` contract.
- Put `dir={direction}` and the unconditional fallback-direction class on the
  elected root. Use logical CSS properties; use runtime direction hooks only
  when direction changes JavaScript behavior.

### Code Quality

- Leave no TypeScript errors, unused imports, TODO placeholders, or template
  commentary in the final component.
- Prefer clear names and small internal components over long inline JSX blocks.
- Preserve useful comments that explain non-obvious behavior; remove comments
  that merely narrate the code or were copied from examples.

## Implementation Checklist

- [ ] The semantic root owns the top-level component contract.
- [ ] Props contain content and behavior, not breakpoint styling decisions.
- [ ] Every named inner part has global/module classes and `elementProps` wiring.
- [ ] Native and custom design states in scope are wired to their affected parts.
- [ ] Render output is deterministic and SSR-safe.
- [ ] Direction and accessibility contracts are wired to the correct elements.
- [ ] Public handlers use supported SDK names; internal handlers stay internal.
- [ ] CSS changed by the request keeps editable selectors flat and scoped.
- [ ] The accessibility review runs after JSX edits.
