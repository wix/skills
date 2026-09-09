# Component Contract

Use this reference when defining props, defaults, named-part wiring, complex data,
or internal file boundaries.

## Contents

- [Public Props Contract](#public-props-contract)
- [Numeric Range Constraints](#numeric-range-constraints)
- [Named Parts and `elementProps`](#named-parts-and-elementprops)
- [Content and Data](#content-and-data)
- [Active-Item Components](#active-item-components)
- [Defaults and Resources](#defaults-and-resources)
- [Internal File Splitting](#internal-file-splitting)
- [Checklist](#checklist)

## Public Props Contract

Keep identity and platform contracts together with component-specific data and
behavior. Do not add `children` unless the component is explicitly a container.

Use this shape:

```ts
import type { A11y, Direction } from '@wix/editor-react-types';

export type PlanCardProps = {
  id?: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;

  heading?: string;
  plans?: Array<Plan>;
  onClick?: (event: React.MouseEvent) => void;

  elementProps?: {
    cta?: { className?: string; href?: string };
  };
};
```

Rules:

- Route all ARIA attributes through `a11y`; do not add individual `ariaLabel`,
  `role`, or similar props.
- Expose only content and behavior that the site owner controls. Keep derived
  values internal.
- Add only callbacks required by the component specification. Use supported SDK
  event names and types for public callbacks; keep implementation-only handlers
  internal.
- Use `Array<T>`, not `T[]`, for exported arrays.

## Numeric Range Constraints

Use inline `@min` and `@max` JSDoc tags for fixed-domain numeric props. Manifest
generation reads the tags automatically.

```ts
export type RatingProps = {
  /** @min 0 @max 5 */
  rating: number;
};
```

Use fixed bounds for ratings, percentages, playback speed, columns, etc. Omit
for open-ended values or indices tied to a dynamic collection.

## Named Parts and `elementProps`

Treat an independently editable inner element as a named part. Wiring rules:

- Root receives top-level `id`, `className`, `direction`, `a11y` — no
  `elementProps` entry.
- Every named inner part has an `elementProps` entry (even if only `className`
  is needed); structural/decorative non-parts use only a CSS Module class.

On a raw HTML element, spread the entry and explicitly merge its injected
`className`. Keep the entry key short while prefixing the global class with the
component name.

```tsx
<a
  {...elementProps?.cta}
  className={classNames(
    'plan-card-cta',
    styles.cta,
    elementProps?.cta?.className,
  )}
>
  {label}
</a>
```

When a named part renders another component built with this skill, spread the
entry and let that component merge its incoming `className` on its root.

```tsx
<PlanRow {...elementProps?.planRow} item={plan} />
```

Do not merge the same class at both the call site and the sub-component root.

## Content and Data

Compute derived values internally when a small pure expression can derive them
from props or state (e.g. expose `price` and `quantity`; compute `subtotal`; use
numeric types when arithmetic is required).

### Data-Driven Components

Export named content props rather than `children` for leaf components — text
(`label`, `title`, `placeholder`), media (`image`, `video`, `icon`), links
(`link`, `href`), collections (`items`, `options`, `menuItems`). Internal
sub-components may still use `children` for composition.

### Container Components

Use `React.ReactNode` only for containers or slots accepting arbitrary nested
components. Put `dir="ltr"` on elements rendering `ReactNode` so nested content
does not inherit the component's direction.

### Array Props

Array elements must be objects with named keys for semantics and extensibility.

```ts
type GalleryProps = {
  images: Array<{ image: Image; caption?: string }>;
  tags: Array<{ label: string }>;
};
```

Do not export `Array<string>`, `Array<Image>`, `Array<Array<T>>`, or nested
arrays inside items.

The parent owns the array. Item sub-components receive one item, not the
collection. Do not add an `id` field for React keys—use the item's semantic
named fields instead. Prefer: (1) a stable unique field (`value`, `uri`, `label`, …), (2)
else slug a user-facing string (`name`, `label`), (3) else the array index.

## Active-Item Components

Apply this contract when an array-driven UI shows one item body at a time (tabs,
slides, steps). Skip for always-visible lists, multi-select, or multi-expand.

- Every item needs `name: string` (used for hat-selector labels).
- **Import and use `ActiveItemIndex<'arrayPropName'>`** from
  `@wix/react-component-utils`. The type argument must match the array prop name
  exactly, and `defaultProps` must set the index to `0`.
- Render all bodies with `.map()`. Active body gets --active; inactive bodies get functional CSS visibility, aria-hidden, and inert.
- Provide keyboard navigation and the matching ARIA pattern.

```ts
import type { A11y, Direction } from '@wix/editor-react-types';
import type { ActiveItemIndex } from '@wix/react-component-utils';

export type Step = { name: string; body: string };

export type StepsProps = {
  id?: string;
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
`@wix/editor-react-types`. See `node_modules/@wix/react-component-schema/dist/editor-react-types.d.ts` for the full list.

## Defaults and Resources

Export `defaultProps` from `<component-name>.props.ts`. Both `component.tsx` and
the extension consume this object; never duplicate fallbacks in JSX.

All rendered media must come from Wix-hosted services, local assets, or props.
No external hosts or third-party runtime dependencies.

For `Image` defaults, populate only `uri`, `url`, and `alt`; the editor fills
dimensions and focal-point metadata.

```ts
export const defaultProps = {
  image: {
    url: 'https://static.wixstatic.com/media/11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2.jpg',
    uri: '11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2.jpg',
    alt: 'Tropical beach viewed from above',
  },
} as const satisfies Omit<ExampleComponentProps, 'id' | 'className'>;
```

Use distinct Wix-hosted defaults per image slot; keep all fallback data in
`defaultProps` so rendering never hardcodes a second fallback in JSX.

Use this pool in order, cycling only when more than five defaults are needed:

| # | `fileName` | Description |
| --- | --- | --- |
| 1 | `11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2.jpg` | Tropical beach aerial |
| 2 | `11062b_73f31c7e7d3544c69dc8ecd8d34c5717~mv2.jpg` | Dead Sea landscape |
| 3 | `11062b_3682ebfcb08e4da5b3168b62819a1e68~mv2.jpg` | Palm tree sunset |
| 4 | `11062b_45e67783d39c4963ab9e4fc418173233~mv2.jpg` | Abstract pink waves |
| 5 | `11062b_4c11f014b0d04948b2e6f554076bc40a~mv2.jpg` | Coastal village aerial |

For one image use entry 1; for multiple slots use a different entry each.

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

Do not extract tiny fragments merely to satisfy a line-count threshold.

## Checklist

- [ ] Identity, direction, a11y, and SDK callbacks follow the public props shape.
- [ ] Props hold authored data/behavior; derived values stay internal.
- [ ] Fixed-domain numeric props use `@min`/`@max` JSDoc tags.
- [ ] Named inner parts have `elementProps` wiring; leaf components avoid exported `children`.
- [ ] One-body-visible arrays use the active-item contract and render all bodies.
- [ ] Array elements are objects with semantic named fields. No separate `id` field added to item types; React keys use item fields (stable unique → slug → index), not a typed `id`.
- [ ] Defaults live only in the props file (no JSX fallbacks).
- [ ] Resources are Wix-hosted, prop-supplied, or locally bundled.
