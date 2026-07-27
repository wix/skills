# Component Preview (`component.preview.tsx`)

Rules and patterns for the editor-specific entry point that every Editor React
component ships alongside its main `component.tsx`.

---

## What it is

`component.preview.tsx` is the editor-specific entry point for a component. The
Wix CLI loads it **instead of** `component.tsx` when rendering the component
inside the Harmony Editor. It is generated automatically by the scaffold as a
passthrough that forwards all props unchanged:

```tsx
const MyComponentPreview = (props: React.ComponentProps<typeof MyComponent>) => (
  <MyComponent {...props} />
);
```

The extension file is also pre-wired to load it — no manual wiring is needed:

```ts
import componentPreviewUrl from './component.preview.tsx?url';

resources: {
  client: { componentUrl },
  editor: { componentUrl: componentPreviewUrl },
},
```

---

## `useIsEditMode()`

When you need to distinguish **editor design mode** from **editor preview mode**,
use `useIsEditMode()` from `@wix/react-component-utils`:

```tsx
import { useIsEditMode } from '@wix/react-component-utils';

const isEditMode = useIsEditMode();
// true  → editor is in design mode
// false → editor is in preview mode
```

`@wix/react-component-utils` is already a base dependency — no additional install needed.

---

## When to modify it

Modify `component.preview.tsx` whenever the component needs to behave differently
inside the editor than it does on the live site. The most common case is
suppressing autoplay so animations don't run while the site owner is designing.

→ See [`ANIMATED-COMPONENTS.md`](ANIMATED-COMPONENTS.md) §4 for the autoplay suppression pattern.
