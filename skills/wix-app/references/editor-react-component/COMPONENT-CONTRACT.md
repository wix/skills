# Component Contract

Use for props, defaults, named parts, data, and file boundaries.

## Public Props Contract

Keep identity, platform props, data, and behavior together. Add `children` only
for an explicit container.

Shape:

```ts
import type { A11y, Direction } from '@wix/editor-react-types';

export type PlanCardProps = {
  id: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;

  heading?: string;
  plans?: Array<Plan>;
  onClick?: (event: React.MouseEvent) => void;
  onMouseIn?: (event: React.MouseEvent) => void;
  onMouseOut?: (event: React.MouseEvent) => void;
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: (event: React.FocusEvent) => void;

  elementProps?: {
    planCardCta?: { className?: string; href?: string };
  };
};
```

Rules:

- Follow `ACCESSIBILITY.md`. Expose only `ariaLabel`, for a control without a
  visible name, through the typed `a11y` contract. Keep semantics and state in
  code. Do not add one-off ARIA props or spread the whole object.
- Expose only content and behavior that the site owner controls. Keep derived
  values internal.
- Inputs use parent-owned `value` + typed `onValueChange`; actions use SDK
  callbacks. Keep DOM handlers internal; preserve APIs.
- Use `Array<T>`, not `T[]`, for exported arrays.
- Use a native link for a CTA with a real `href`, or a native button for an
  action. Never use `href="#"`: it has no destination.

## Numeric Range Constraints

Use inline `@min`, `@max` JSDoc tags for fixed-domain numeric props. Manifest
generation reads them automatically.

```ts
export type RatingProps = {
  /** @min 0 @max 5 */
  rating: number;
};
```

Use for ratings, percentages, columns; omit for open-ended values or indices
tied to a dynamic collection.

## Named Parts and `elementProps`

An independently editable inner element is a named part:

- Root receives top-level `id`, `className`, `direction`, `a11y` — no
  `elementProps` entry.
- Every named inner part has an `elementProps` entry (`className` at minimum); structural/decorative non-parts use only a CSS Module class.

On a raw HTML element, spread the entry and explicitly merge its injected
`className`. The key is the part's global class in camelCase, never shortened
(`plan-card-cta` → `planCardCta`); any other key reads `undefined`.

```tsx
<a
  {...elementProps?.planCardCta}
  className={clsx(
    'plan-card-cta',
    styles.cta,
    elementProps?.planCardCta?.className,
  )}
>
  {label}
</a>
```

For a skill-built sub-component, spread the entry; its root merges the incoming
`className`.

```tsx
<PlanRow {...elementProps?.planCardPlanRow} item={plan} />
```

Never merge the class at both the call site and the sub-component root.

## Content and Data

Compute derived values internally when a small pure expression can derive them
from props or state (e.g. expose `price`, `quantity`; compute `subtotal`).
Use numeric types for arithmetic.

### Data-Driven Components

Export named content props, not `children`, for leaf components — text
(`label`, `title`), media (`image`, `icon`), links (`link`), collections
(`items`, `options`). Internal sub-components may use `children`.

Every visible text (eyebrow, subtitle, label) is a text prop with a default in
its own named part. No JSX text literals (`aria-label`: ACCESSIBILITY.md).
Computed text (a clock) gets one too.

### Container Components

Use `React.ReactNode` only for containers or slots accepting arbitrary nested
components. Put `dir="ltr"` on elements rendering `ReactNode` so nested content
does not inherit the component's direction.

### Array Props

Array elements must be objects with named keys. Always declare array-item fields optional.

```ts
type GalleryProps = {
  images: Array<{ image?: Image; caption?: string }>;
  tags: Array<{ label?: string }>;
};
```

Do not export `Array<string>`, `Array<Image>`, `Array<Array<T>>`, or nested
arrays inside items.

The parent owns the array. Item sub-components receive one item, not the
collection. Do not add an `id` field for React keys—use semantic named fields.
Prefer: (1) a stable unique field (`value`, `uri`, `label`, …), (2) else slug a
user-facing string (`name`, `label`), (3) else the index.

## Active-Item Components

Apply when an array-driven UI shows one item body at a time (tabs, slides,
steps). Skip for always-visible lists, multi-select, or multi-expand.

- Declare `name` only when a part renders it; the hat shows `name`, else
  "Item N". A visible per-item trigger label (tabs, steps) is the `name` field.
  Slides, cards, carousels with no per-item label: no `name`. Never declare an
  item field no part renders.
- **Import and use `ActiveItemIndex<'arrayPropName'>`** from
  `@wix/react-component-utils`. The type argument must match the array prop name
  exactly, and `defaultProps` must set the index to `0`.
- Render all bodies with `.map()`. Active body is a named part with `<base>--active`; inactive bodies get CSS visibility, `aria-hidden`, and `inert`.
- React 18 types: spread `...(!isActive ? { inert: 'true' } : {})` onto an inactive body; it emits the boolean attribute, no type error. Typecheck with the app, not a scratch project.
- Keyboard navigation and the matching ARIA pattern.

```ts
import type { A11y, Direction } from '@wix/editor-react-types';
import type { ActiveItemIndex } from '@wix/react-component-utils';

export type Step = { name: string; body: string };

export type StepsProps = {
  id: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;
  steps: Array<Step>;
  activeItem: ActiveItemIndex<'steps'>;
};

export const defaultProps = {
  steps: [{ name: 'Step 1', body: 'First step' }],
  activeItem: 0,
} satisfies Omit<StepsProps, 'id' | 'className'>;
```

### Wix Data Types

Use `Image`, `Link`, `Video`, `Audio`, `VectorArt`, `RichText` from
`@wix/editor-react-types`. Model authored media with the corresponding Wix
media type, whether it is a top-level prop or a field in an array item. Name
the field for the media itself (`image`, `video`, `audio`), not for
one representation of it.

In the installed types, `Image` has required `url: string` and
optional `uri`, `alt`, `width`, `height`; `Link` has optional `href`, `target`
(`'_self' | '_blank'`), and `rel`. Use `image.url` for `<img src>`,
`image.alt` for alt text, and `link.href` for `<a href>`.

Do not represent media as a URL/source string or split its metadata across
primitive props. Preserve the media object through the public contract so the
component can consume all of its supported data.

Before using fields not documented here, inspect the relevant app-resolved
`@wix/editor-react-types` declaration and only needed type references. Never
infer one type's fields from another type's example. Recheck documented fields
only if a related typecheck error reveals a mismatch; follow the installed
declaration for the field shape while retaining editor rules. Preserve required
fields. Do not bypass errors with `any`, casts, or replacement media types.

## Defaults and Resources

Export `defaultProps` from `<component-name>.props.ts`, including defaults for
root and nested `a11y` fields. Both `component.tsx` and the extension consume
this object; never duplicate them in destructuring or JSX.

All rendered media must come from Wix-hosted services, local assets, or props.
No external hosts (upload user images). Third-party runtime packages must
be imported by the user's code.

For `Image` defaults, populate only `uri`, `url`, and `alt`; the editor fills
dimensions and focal-point metadata.

```ts
export const defaultProps = {
  image: {
    url: 'https://static.wixstatic.com/media/ce4244dfd3b04dc89590b76a98d868b8.jpg',
    uri: 'ce4244dfd3b04dc89590b76a98d868b8.jpg',
    alt: 'Black wired headphones on a light wooden table',
  },
} as const satisfies Omit<ExampleComponentProps, 'id' | 'className'>;
```

Use distinct defaults per slot; keep fallback data in `defaultProps` so
JSX never hardcodes a second one.

When no supplied asset fits the slot (`USER-SOURCES.md`), choose image
defaults from the pool in `DEFAULT-IMAGES.md`.

## Internal File Splitting

Split independently understandable units when it makes the main component easier
to read or test. Keep internal files in the component folder using `.module.css`.

```text
component-name/
├── components/
│   └── plan-row/
│       ├── plan-row.tsx
│       └── plan-row.module.css
├── hooks/
│   └── use-playback.ts
├── component-name.props.ts
├── component-name.tsx
└── component-name.module.css
```

Do not extract tiny fragments just to pass a line-count threshold.

## Checklist

- [ ] Identity, direction, a11y, and SDK callbacks follow the public props shape.
- [ ] Props hold authored data/behavior; derived values stay internal.
- [ ] Fixed-domain numeric props use `@min`/`@max` JSDoc tags.
- [ ] Named inner parts have `elementProps` wiring; leaf components avoid exported `children`.
- [ ] One-body-visible arrays use the active-item contract and render all bodies; `name` only when a part renders it.
- [ ] Array elements are objects with semantic named fields. No separate `id` field added to item types; React keys use item fields (stable unique → slug → index), not a typed `id`.
- [ ] Authored media uses the corresponding Wix media type, not URL/source strings or flattened metadata.
- [ ] Defaults live only in the props file (no JSX fallbacks).
- [ ] Every visible text is a prop with a named part; no JSX text literals.
- [ ] Resources are Wix-hosted, prop-supplied, or locally bundled.
