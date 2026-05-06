# Component Configuration

After scaffolding the component and running `yarn generate:manifest`,
configure the component's behavior in the editor by writing **partial
manifest overrides** in the component's hand-edited extension file
(`<ComponentName>.extension.ts`). That file imports the auto-generated
manifest and spreads it; specific fields are overridden inline. Re-running
`yarn generate:manifest` regenerates the `<ComponentName>.generated.ts`
companion but never touches the overrides authored in the extension file.

---

## 1. Verifying that height sizing type meets user needs

Set `installation.initialSize.height.sizingType` based on whether the
component's own content decides how tall it is.

### Heuristic — one question

**Does the component's own content decide how tall it is?**

- **Yes — height should grow with text the user types or children they drop inside** → `LAYOUT.SIZING_TYPE.content`. Omit `pixels`.
- **No — the component is a framed visual** (a graphic, an embedded media surface, a form control with a standard height, an empty placeholder) → `LAYOUT.SIZING_TYPE.pixels`. Provide a `pixels` default that matches its natural visual size.

**Tiebreaker:** if a designer would drag a handle to set the height, it's `pixels`. If the height should just fit whatever is inside, it's `content`.

### Where to write the override

```ts
import { extensions } from '@wix/astro/builders';
import { LAYOUT } from '@wix/react-component-schema';
import { manifest } from './ComponentName.generated';

const componentExtension = extensions.editorReactComponent({
  ...manifest,
  // …other fields…
  installation: {
    ...manifest.installation,
    initialSize: {
      width: {
        sizingType: LAYOUT.SIZING_TYPE.pixels,
        pixels: 250,
      },
      height: {
        sizingType: LAYOUT.SIZING_TYPE.updateMe,
      },
    },
  },
});
```

### Examples

**Content-driven** (`LAYOUT.SIZING_TYPE.content`) — testimonial card,
FAQ accordion, pricing tier, blog-post body, list/grid of arbitrary
children:

```ts
height: {
  sizingType: LAYOUT.SIZING_TYPE.content,
}
```

**Framed visual** (`LAYOUT.SIZING_TYPE.pixels`) — hero banner with a
fixed image, video embed, color-picker swatch grid, OTP input, empty
placeholder slot:

```ts
height: {
  sizingType: LAYOUT.SIZING_TYPE.pixels,
  pixels: 320,
}
```

---

## 2. Verifying that resize direction meets user needs

Set `editorElement.layout.resizeDirection` based on which axes the
designer should be able to control with a drag handle. Allow an axis
if dragging it produces a meaningful, intended change. Disallow it if
dragging would do nothing visible or would break the component's
identity.

### Heuristic — which axes are meaningful?

| Choice | When to use |
|--------|-------------|
| `LAYOUT.RESIZE_DIRECTION.horizontalAndVertical` | Components the designer frames freely — framed media, embeds, icons, form controls, and any container the designer should be able to grow in either direction. |
| `LAYOUT.RESIZE_DIRECTION.horizontal` | Only the horizontal axis is meaningful. Text and list-like components that flow along a row, one-dimensional primitives like bars and rails, anything whose vertical size is determined by what's inside or by the component spec. |
| `LAYOUT.RESIZE_DIRECTION.vertical` | Mirror of `horizontal` — only the vertical axis is meaningful. Stacks of arbitrary children, ribbons, vertical rails. |
| `LAYOUT.RESIZE_DIRECTION.aspectRatio` | The component carries proportion-critical identity that distortion would damage — logos, animations, illustrations. Not a default for anything merely image-shaped. |
| `LAYOUT.RESIZE_DIRECTION.none` | Reserved for nested children whose size is fully owned by a parent layout. **Not** for top-level components. |

**Tiebreaker:** if a drag handle on an axis would feel inert or wrong
to a designer, take it away.

### Where to write the override

```ts
import { extensions } from '@wix/astro/builders';
import { LAYOUT } from '@wix/react-component-schema';
import { manifest } from './ComponentName.generated';

const componentExtension = extensions.editorReactComponent({
  ...manifest,
  // …other fields…
  editorElement: {
    ...manifest.editorElement,
    layout: {
      ...manifest.editorElement?.layout,
      resizeDirection: LAYOUT.RESIZE_DIRECTION._selectedResizeDirection_,
    },
  },
});
```

### Examples

**Free framing** (`horizontalAndVertical`) — hero banner, video embed,
icon tile, color picker, generic container:

```ts
resizeDirection: LAYOUT.RESIZE_DIRECTION.horizontalAndVertical,
```

**Single-axis flow** (`horizontal` or `vertical`) — paragraph block,
tag row, slider rail, vertical stack of testimonials:

```ts
resizeDirection: LAYOUT.RESIZE_DIRECTION.horizontal,
```

**Proportion-critical** (`aspectRatio`) — logo, illustration, animation
whose meaning depends on its proportions:

```ts
resizeDirection: LAYOUT.RESIZE_DIRECTION.aspectRatio,
```
