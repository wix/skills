# Server-Side Rendering (SSR)

Rules and patterns for SSR-safe Editor React components.

Editor React components are server-rendered and then hydrated on the client — every component MUST render correctly, completely, and identically on the server. SSR safety is mandatory for every component.

---

## Rules

### No browser globals at module scope or during render

`window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `matchMedia`, `IntersectionObserver`, `ResizeObserver`, and other DOM/BOM APIs do not exist on the server. Never touch them at module scope or in the render body. Access them only inside `useEffect`, optionally guarded with `typeof window !== 'undefined'`.

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

### First render must be complete

Render all parts unconditionally — never gate structural elements behind effect-set state. Initialize `useState` to a valid, server-renderable default so the first (server) render already shows the final structure. Element visibility is platform-managed; see [`PROPS-VS-CSS.md`](PROPS-VS-CSS.md) and [`REACT-PATTERNS.md`](REACT-PATTERNS.md) §1.2.

**❌ Wrong — content only appears after an effect runs (missing on the server):**

```tsx
const [items, setItems] = useState<Array<Item>>([]);
useEffect(() => {
  setItems(buildItems(props));
}, [props]);
return <ul>{items.map(/* ... */)}</ul>; // empty on the server
```

**✅ Correct — derive during render so it exists on the first pass:**

```tsx
const items = buildItems(props);
return <ul>{items.map(/* ... */)}</ul>;
```

### Deterministic render

The same props MUST produce the same markup on the server and the client. No `Math.random()`, `Date.now()`, `new Date()`, or locale/timezone-dependent output during render — these differ across environments and break hydration.

**❌ Wrong:**

```tsx
<span>{new Date().toLocaleString()}</span>
```

**✅ Correct — derive from props, or compute in an effect:**

```tsx
<span>{formatDate(props.timestamp)}</span>
```

### Stable IDs via `useStableId`

When a component needs an internal id (ARIA wiring such as `aria-controls` / `aria-labelledby`, or `htmlFor`), generate it with `useStableId` from `@wix/react-component-utils`. Never use `Math.random()`, a manual counter, or a bare `React.useId()` — those break hydration or are not available across runtimes. Pass the component's `id` prop as the override so a caller-supplied id wins, then derive child ids from the result.

**✅ Correct:**

```tsx
import { useStableId } from '@wix/react-component-utils';

const rootId = useStableId(id);
const panelId = `${rootId}-panel`;

<button aria-controls={panelId}>{label}</button>
<div id={panelId} role="tabpanel">{content}</div>
```

**❌ Wrong:**

```tsx
const panelId = `tab-${Math.random()}`; // ❌ differs every render
const panelId = React.useId();          // ❌ use the useStableId util instead
```

### No `useLayoutEffect`

`useLayoutEffect` does nothing on the server and triggers a React warning. Use `useEffect` for client-only work.

**❌ Wrong:**

```tsx
useLayoutEffect(() => { measure(); }, []);
```

**✅ Correct:**

```tsx
useEffect(() => { measure(); }, []);
```

### Effects are client-only enhancement

`useEffect` runs only after hydration, never on the server. Use effects to enhance — not to produce the initial UI. The server-rendered default state must already look correct before any effect runs.

---

## SSR Checklist

- [ ] No browser globals at module scope or in the render body — guarded inside `useEffect` only
- [ ] All parts render unconditionally on the first pass; state initialized to a server-safe default
- [ ] Render output is deterministic — no `Math.random()` / `Date.now()` / `new Date()` / locale-dependent output during render
- [ ] Internal ids come from `useStableId(id)`, never random values, counters, or bare `React.useId()`
- [ ] No `useLayoutEffect`
