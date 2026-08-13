# Site Context Hooks

Rules and patterns for reading **runtime site context** in Editor React
components — the site's page tree, the current URL, the language direction, and
editor mode. None of these can be carried by a prop.

All of them come from hooks in `@wix/react-component-utils`, already a base
dependency. No additional install is needed, but the hooks require
`@wix/react-component-utils` ≥ 1.12.0.

---

## When this applies

Apply only when the component genuinely needs live site context:

- **The component reflects where the visitor is in the site** — breadcrumbs,
  "you are here" indicators. Not navigation menus: the site owner authors those,
  and their items need not necessarily be site pages, so they take a
  `MenuItems` prop
- **The component needs the page's own URL** — share buttons, copy-link,
  canonical links, QR codes
- **Language direction drives JavaScript** — keyboard navigation, transform or
  animation math, conditional rendering
- **Behavior must differ inside the editor** — suppressing autoplay, network
  calls, or timers while the site owner is designing

The test is whether the site owner **authors** the data. A hook reports state the
owner cannot write — which page is being rendered, what the site's URL is. Data
the owner chooses belongs in props, even when it happens to point at site
pages — see [`PROPS-VS-CSS.md`](PROPS-VS-CSS.md) and
[`COMPONENT-API.md`](COMPONENT-API.md). Purely visual RTL needs no hook
either — use logical CSS properties, see
[`DIRECTIONALITY.md`](DIRECTIONALITY.md).

---

## Rules

### The Available Hooks

| Hook | Returns | Use for |
| --- | --- | --- |
| `usePages()` | `Readonly<Record<string, PageConfig>>` | Every page on the site, keyed by page id |
| `useCurrentPageId()` | `string` | Id of the page being rendered |
| `useMainPageId()` | `string` | Id of the site's homepage |
| `useSiteUrl()` | `string` | The site's public base URL |
| `useCurrentUrl()` | `string` | Full URL of the page being rendered |
| `useLanguageDirection()` | `'ltr' \| 'rtl'` | The site's language direction |
| `useIsEditMode()` | `boolean` | `true` in editor design mode — see [`COMPONENT-PREVIEW.md`](COMPONENT-PREVIEW.md) |
| `useReducedMotion()` | `boolean` | `true` when the OS requests reduced motion — see [`ANIMATED-COMPONENTS.md`](ANIMATED-COMPONENTS.md) |

All import from the same place:

```typescript
import { usePages, useCurrentPageId, useSiteUrl } from '@wix/react-component-utils';
```

Each returns a plain value, so there is nothing to unwrap or guard. They are
React hooks — call them at the top of the component or hook body, never at module
scope, inside a callback, or conditionally.

### Read Values During Render

Hook values are read on the server too, so their results are part of the server
markup — see [`SSR.md`](SSR.md). Use the value directly.

**✅ Correct:**

```tsx
const siteUrl = useSiteUrl();
```

**❌ Wrong — empty on the server, then a hydration mismatch:**

```tsx
const resolvedUrl = useSiteUrl();
const [siteUrl, setSiteUrl] = useState('');
useEffect(() => setSiteUrl(resolvedUrl), []);
```

---

## Patterns

### Walking the Page Tree

`usePages()` returns a map keyed by page id. Three things to get right:

- **The map key is the page id** — the values carry no `id` field.
- **`parentPageId` is absent for top-level pages** — treat those as children of
  `useMainPageId()` when walking upward.
- **`popup: true` pages are lightboxes**, not navigable pages. Filter them out of
  breadcrumbs, menus, and page pickers.

```tsx
import { usePages, useCurrentPageId, useMainPageId } from '@wix/react-component-utils';

export const useBreadcrumbTrail = (): Array<{ id: string; label: string }> => {
  const pages = usePages();
  const currentPageId = useCurrentPageId();
  const mainPageId = useMainPageId();

  const trail: Array<{ id: string; label: string }> = [];
  const visited = new Set<string>();
  let pageId: string | undefined = currentPageId;

  while (pageId && !visited.has(pageId) && pages[pageId]) {
    visited.add(pageId);
    const page = pages[pageId]!;
    if (!page.popup) {
      trail.push({ id: pageId, label: page.title });
    }
    // Pages without parentPageId are top-level children of the homepage.
    pageId = pageId === mainPageId ? undefined : (page.parentPageId ?? mainPageId);
  }

  return trail.reverse();
};
```

The `visited` set is not optional — a misconfigured site can produce a parent
cycle, and an unguarded walk hangs the render.

### Building a Link to a Page

Join a page's `path` onto `useSiteUrl()`. The base URL may or may not carry a
trailing slash, so normalize before joining:

```typescript
const buildPageUrl = (path: string, siteUrl: string): string => {
  const base = siteUrl.replace(/\/$/, '');
  return path ? `${base}/${path}` : base;
};
```

### Direction-Dependent Logic

Resolve the component's own `direction` prop first, then fall back to the site:

```typescript
import type { Direction } from '@wix/editor-react-types';
import { useLanguageDirection } from '@wix/react-component-utils';

export const useResolvedDirection = (direction?: Direction): Direction => {
  // Call unconditionally — `direction ?? useLanguageDirection()` would
  // short-circuit and skip the hook whenever the prop is set.
  const siteDirection = useLanguageDirection() as Direction;
  return direction ?? siteDirection;
};
```

Use the resolved value for **logic only** — arrow-key handling, transform sign,
scroll direction:

```tsx
const isRTL = useResolvedDirection(direction) === 'rtl';

const onKeyDown = (event: React.KeyboardEvent) => {
  const forward = isRTL ? 'ArrowLeft' : 'ArrowRight';
  if (event.key === forward) {
    focusNext();
  }
};
```

---

## Common Mistake: Direction Logic Instead of Logical CSS

Calling `useLanguageDirection()` to pick between physical CSS properties.

**❌ Wrong:**

```tsx
const isRTL = useLanguageDirection() === 'rtl';

<div style={{ paddingLeft: isRTL ? 0 : 8, paddingRight: isRTL ? 8 : 0 }} />
```

**✅ Correct:**

```scss
.element {
  padding-inline-start: 8px; // Auto RTL/LTR, no hook needed
}
```
