# Server-Side Rendering

Use this reference before introducing browser APIs, effects, time-dependent
output, or client-only enhancement. Editor React Components are server-rendered
and hydrated; the initial server and client markup must match.

## Browser APIs

Do not access `window`, `document`, `navigator`, storage, observers, or other
DOM/BOM APIs at module scope or during render. Use them inside `useEffect` and
guard when needed.

```tsx
useEffect(() => {
  if (typeof window === 'undefined') return;
  const userAgent = window.navigator.userAgent;
  // client-only enhancement
}, []);
```

## Complete First Render

Derive renderable data directly from props when possible. Do not leave required
structure empty until an effect copies or transforms props.

```tsx
// Correct: complete on the server and first client render.
const items = buildItems(props.items);
return <ul>{items.map(renderItem)}</ul>;
```

This does not require every data branch to render simultaneously. Empty,
loading, and error states may be conditional when their initial value is stable
and the same on server and client.

## Deterministic Output

Do not call `Math.random()`, `Date.now()`, `new Date()`, or environment-dependent
locale/timezone formatting during render. Use a prop, a fixed deterministic
format, or a client-only enhancement that does not replace the initial markup.

```tsx
<time dateTime={timestamp}>{formattedDate}</time>
```

## Checklist

- [ ] No browser globals are accessed at module scope or during render.
- [ ] Initial server/client markup is complete and identical.
- [ ] Render output does not depend on random, clock, locale, or timezone state.
