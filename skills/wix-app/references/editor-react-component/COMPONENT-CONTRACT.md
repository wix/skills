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

For a new or changed numeric prop, use inline `@min` and `@max` JSDoc tags when
the value has a fixed domain. Manifest generation reads the tags; no extension
override is needed.

```ts
export type RatingProps = {
  /** @min 0 @max 5 */
  rating: number;
};
```

Use fixed bounds for ratings, percentages, playback speed, columns, and similar
domains. Omit them for arbitrary counts, free-form prices, or an active index
whose upper bound depends on the current collection.

## Named Parts and `elementProps`

Treat an independently editable inner element as a named part, then apply one
consistent wiring rule:

- The elected root receives top-level `id`, `className`, `direction`, and `a11y`;
  it has no `elementProps` entry.
- Every named inner part has an `elementProps` entry, even when `className` is
  the only injected field it currently needs.
- Structural or decorative non-parts have no `elementProps` entry and use only a
  CSS Module class.

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

### Derived Values

Compute a value internally when a small pure expression can derive it from
props or state. For example, expose `price` and `quantity`; compute `subtotal`.
Use numeric types when arithmetic is required.

### Data-Driven Components

Export named content props rather than `children` for leaf components:

- text: `label`, `title`, `placeholder`
- media: `image`, `video`, `icon`
- links: `link`, `href`
- collections: `items`, `options`, `menuItems`

Internal sub-components may still use `children` for composition.

### Container Components

Use `React.ReactNode` only when the specification defines a container or slot
that accepts arbitrary nested components. Put `dir="ltr"` on the element that
renders each `ReactNode` value so nested content does not inherit the component's
direction.

### Array Props

Array elements must be objects with named keys. This provides stable identity,
semantic field names, and room for non-breaking extension.

```ts
type GalleryProps = {
  images: Array<{ id: string; image: Image; caption?: string }>;
  tags: Array<{ id: string; label: string }>;
};
```

Do not export arrays of primitives, leaf Wix data types, or nested arrays:

```ts
// Avoid:
// Array<string>
// Array<Image>
// Array<Array<Item>>
// Array<{ items: Array<Image> }>
```

The parent owns the array. Item sub-components receive one item rather than
redeclaring the collection. Use a stable item identifier as the React key; do
not synthesize identity from the array index when stable identity is available.

### Active-Item Components

Apply this contract when an array-driven UI shows one item body at a time, such
as tabs, slides, or steps. Skip it for always-visible lists, multi-select UIs,
and multi-expand accordions.

- Give every item a `name: string`; Studio uses `name` for hat-selector labels.
- Pair the array prop with `ActiveItemIndex<'arrayPropName'>` from
  `@wix/react-component-utils`. The type argument must exactly match the array
  prop name, and `defaultProps` must initialize the index to `0`.
- Render every body with `.map()`. Mark the active body with a prefixed
  `--active` state class, hide inactive bodies with functional CSS visibility,
  and apply `aria-hidden` and `inert` to inactive content.
- Provide keyboard navigation between triggers and the matching ARIA pattern.

```ts
import type { A11y, Direction } from '@wix/editor-react-types';
import type { ActiveItemIndex } from '@wix/react-component-utils';

export type Step = { id: string; name: string; body: string };

export type StepsProps = {
  id?: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;
  steps: Array<Step>;
  activeItem: ActiveItemIndex<'steps'>;
};

export const defaultProps = {
  steps: [{ id: 'first', name: 'Step 1', body: 'First step' }],
  activeItem: 0,
} satisfies Omit<StepsProps, 'id' | 'className'>;
```

### Wix Data Types

Use types such as `Image`, `Link`, `Video`, `Audio`, `VectorArt`, and `RichText`
from `@wix/editor-react-types`. Inspect
`node_modules/@wix/react-component-schema/dist/editor-react-types.d.ts` when you
need the supported schema types.

## Defaults and Resources

Export `defaultProps` from `<component-name>.props.ts`. Both `component.tsx` and
the extension consume this object; do not duplicate fallback values in JSX.

Rendered media and runtime data must come from Wix-hosted services, local
bundled assets, or values supplied through props. Do not silently introduce an
external host or third-party runtime dependency.

For an `Image` default, populate only `uri`, `url`, and `alt`. Let the editor
populate dimensions and focal-point metadata after the site owner chooses an
image.

```ts
export const defaultProps = {
  image: {
    url: 'https://static.wixstatic.com/media/11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2.jpg',
    uri: '11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2.jpg',
    alt: 'Tropical beach viewed from above',
  },
} as const satisfies Omit<ExampleComponentProps, 'id' | 'className'>;
```

Use distinct Wix-hosted defaults for multiple image slots. Keep fallback data in
`defaultProps` so rendering reads the resolved prop instead of hardcoding a
second fallback in JSX.

Use this pool in order, cycling only when more than five defaults are needed:

| # | `fileName` | Description |
| --- | --- | --- |
| 1 | `11062b_2f97b87dcea2446fa48e9ad9c5457ae1~mv2.jpg` | Tropical beach aerial |
| 2 | `11062b_73f31c7e7d3544c69dc8ecd8d34c5717~mv2.jpg` | Dead Sea landscape |
| 3 | `11062b_3682ebfcb08e4da5b3168b62819a1e68~mv2.jpg` | Palm tree sunset |
| 4 | `11062b_45e67783d39c4963ab9e4fc418173233~mv2.jpg` | Abstract pink waves |
| 5 | `11062b_4c11f014b0d04948b2e6f554076bc40a~mv2.jpg` | Coastal village aerial |

For one image, use entry 1. For multiple slots, use a different entry for each
slot so the defaults are visually distinct.

## Internal File Splitting

Split a logical, independently understandable unit when doing so makes the main
component easier to read or test. Keep internal files within the scaffolded
component folder and use `.module.css`, matching the package convention.

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

- [ ] Identity, direction, and accessibility contracts are present.
- [ ] Props contain authored data or stable behavior; derived values stay internal.
- [ ] New or changed fixed-domain numeric props use `@min` and `@max`.
- [ ] Every named inner part has `elementProps` wiring and merged classes.
- [ ] Leaf components avoid exported `children`.
- [ ] Array elements are named objects with stable identity.
- [ ] One-body-visible arrays use the active-item contract and render all bodies.
- [ ] Defaults have one source of truth in the props file.
- [ ] Resources are Wix-hosted, prop-supplied, or locally bundled.
