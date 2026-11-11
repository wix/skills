# Vector Art

Use this reference when a component shows an icon tied to its content (a
subject, feature or per-item icon): the site owner can replace it. Fixed UI
glyphs (chevron, play/pause, close) stay inline per CSS-GUIDELINES.md "SVG Icons".

## The Prop

Import `VectorArt` from `@wix/editor-react-types`. All fields are required; keep
the whole object, never flatten it to a URL string.

Declare it at the top level or as an array-item field, never in `elementProps`,
which stays `className` only:

```ts
export type FeatureRowProps = {
  icon?: VectorArt;
  elementProps?: { featureRowIcon?: { className?: string } };
};
```

In a list, the icon is a field of each item:

```ts
export type FeatureListProps = {
  items?: Array<{ label?: string; icon?: VectorArt }>;
};
```

## Render and Style

The icon is a named part per `PARTS.md`. Inject `svgContent` unmodified (no
`.replace()` or added attributes). Mark it `aria-hidden="true"` beside a visible label, or name the
control with `a11y.ariaLabel` per `ACCESSIBILITY.md`.

```tsx
{icon && (
  <span
    {...elementProps?.featureRowIcon}
    className={clsx('feature-row-icon', styles.icon, elementProps?.featureRowIcon?.className)}
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: icon.svgContent }}
  />
)}
```

Declare the controls per CSS-GUIDELINES.md "SVG Icons", plus `--*-icon-rotation`
via `rotate`, on the root when the icon repeats. Add no border, background, or
padding. `--*-icon-color` matches the text color, as its literal or `wst-*-color`
token, never `currentColor`.

```css

.icon {
  --feature-row-icon-size: 24px;
  --feature-row-icon-color: #151514;
  --feature-row-icon-rotation: 0deg;
  display: block;
  inline-size: var(--feature-row-icon-size);
  block-size: var(--feature-row-icon-size);
  fill: var(--feature-row-icon-color);
  rotate: var(--feature-row-icon-rotation);
}

.icon svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}

/* Icon parts that carry their own colors. */
.icon svg [data-color] {
  fill: var(--feature-row-icon-color);
}
```

With several icons, give each part its own class and prefixed properties;
shared names merge into one control. Only the layout `svg` rule may be
shared (`.startIcon svg, .endIcon svg`).

## Defaults

Populate all six fields in `defaultProps`; keep them there, with no second
fallback in JSX. Never invent a `uri` or use a `data:` URI.

Copy each default from `<SKILL_ROOT>/scripts/default-vector-art.json`, without
its `subject` and `tags`. Fill slots in order:

1. The icon whose `subject` or `tags` match the item's meaning; an icon the
   user names wins.
2. When none match, the `general` icons not used yet.
3. Then the shapes below, then repeats in the same order.

```ts
export const defaultProps = {
  icon: {
    uri: '417ddd_00f94d35a8f84b959241a5d4293ee772.svg',
    viewBox: '0 0 200 200',
    contentBox: '10 10 180 180',
    colors: {},
    contentType: 'shape',
    svgContent:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" data-type="shape"><path d="M100 190c49.706 0 90-40.294 90-90s-40.294-90-90-90-90 40.294-90 90 40.294 90 90 90"/></svg>',
  },
} as const satisfies Omit<FeatureRowProps, 'id' | 'className'>;
```

For a shape slot substitute `uri` and the path `d` (same `viewBox` and `contentBox`):

| `uri` | Shape | path `d` |
| --- | --- | --- |
| `417ddd_3d6ddf28b43e45499ea8557b8d963c79.svg` | Arch | `M100 10c49.704 0 90 37.654 90 84.102V190H10V94.102C10 47.654 50.294 10 100 10` |
| `417ddd_c4e65c20d3844ffd97c9b2551ce7d269.svg` | Heptagon | `m100 10 72.174 35.651L190 125.76 140.054 190H59.946L10 125.759l17.826-80.108z` |

## Checklist

- [ ] A content icon is a `VectorArt` prop, not an inline `<svg>` or URL string.
- [ ] A list icon is an item field, not picked by index from a constant.
- [ ] Each icon is its own named part injecting `svgContent` unmodified, with prefixed `--icon-*` properties.
- [ ] `defaultProps` carries all six fields from `default-vector-art.json` or the shapes.
