# Vector Art

Use this reference when a component shows an icon or other SVG the site owner
can replace. Fixed glyphs stay inline per
CSS-GUIDELINES.md "SVG Icons".

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

Declare the controls per CSS-GUIDELINES.md "SVG Icons", plus `--icon-rotation`
via `rotate`. Add no border, background, or padding.

```css
.icon {
  --icon-size: 24px;
  --icon-color: #116dff;
  --icon-rotation: 0deg;
  display: block;
  inline-size: var(--icon-size);
  block-size: var(--icon-size);
  fill: var(--icon-color);
  rotate: var(--icon-rotation);
}

.icon svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}
```

With several icons, give each part its own class and prefixed properties;
shared names merge into one control. Only the property-free `svg` rule may be
shared (`.startIcon svg, .endIcon svg`).

## Defaults

Populate all six fields in `defaultProps`; keep them there, with no second
fallback in JSX. Never invent a `uri` or use a `data:` URI.

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

For further slots substitute `uri` and the path `d` (same `viewBox` and `contentBox`):

| `uri` | Shape | path `d` |
| --- | --- | --- |
| `417ddd_3d6ddf28b43e45499ea8557b8d963c79.svg` | Arch | `M100 10c49.704 0 90 37.654 90 84.102V190H10V94.102C10 47.654 50.294 10 100 10` |
| `417ddd_c4e65c20d3844ffd97c9b2551ce7d269.svg` | Heptagon | `m100 10 72.174 35.651L190 125.76 140.054 190H59.946L10 125.759l17.826-80.108z` |

## Checklist

- [ ] A replaceable icon is a `VectorArt` prop, not an inline `<svg>` or URL string.
- [ ] Each icon is its own named part injecting `svgContent` unmodified, with prefixed `--icon-*` properties.
- [ ] `defaultProps` carries all six fields with a `uri` from the pool.
