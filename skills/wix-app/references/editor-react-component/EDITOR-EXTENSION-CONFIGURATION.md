# Editor Extension Configuration

Use this reference to edit `<component-name>.extension.ts` after scaffolding and
before the final build. Preserve the scaffold's generated editor element,
client and editor resources, merge order, and defaults wiring. Manifest
generation rewrites
`<component-name>.generated.ts`; it does not rewrite the extension file.

For a new component, complete the scaffolded installation and layout fields.
For an existing component, change only the sizing, installation, or manifest
behavior requested by the user; preserve every other extension field.

## Contents

- [Preserve the Extension Shape](#preserve-the-extension-shape)
- [Choose Initial Height](#choose-initial-height)
- [Choose Resize Direction](#choose-resize-direction)
- [Checklist](#checklist)

## Preserve the Extension Shape

For a new component, the extension should continue to:

- import `editorElement` from `<component-name>.generated.ts`
- load `component.tsx?url` for the client and `component.preview.tsx?url` for
  the editor
- apply `defaultProps` from `<component-name>.props.ts` through
  `withEditorElementDefaults`
- merge layout overrides into the editor element after applying defaults

For an existing component, preserve its generated export shape. Older
extensions may import and spread `manifest.editorElement` and
`manifest.resources`; do not migrate that wiring during an unrelated edit.

Preserve the generated `defaultProps` import from `./<component-name>.props`.
That file remains the single source of truth.

## Choose Initial Height

Determine from the component contract whether its own content decides its
height. Ask the user only when the requested behavior leaves this materially
ambiguous.

| Answer | Sizing type |
| --- | --- |
| Text or nested content should grow the component | `LAYOUT.SIZING_TYPE.content`; omit `pixels` |
| The component is a framed visual/control with a natural fixed height | `LAYOUT.SIZING_TYPE.pixels`; provide `pixels` |

Tiebreaker: if a designer should drag a height handle, use `pixels`; if height
should fit content, use `content`.

## Choose Resize Direction

Allow an axis only when dragging it produces a meaningful result.

| Value | Use when |
| --- | --- |
| `horizontalAndVertical` | Content meaningfully fills both axes; default for framed visuals and most layouts |
| `horizontal` | Height is intrinsic or intentionally rigid |
| `vertical` | Width is intrinsic or intentionally rigid |
| `aspectRatio` | Distortion would break the component's identity |
| `none` | A parent fully owns size; do not use for a top-level component |

Edit the scaffolded `layout`, `installation`, and `resources` fields in place;
do not reconstruct the extension from an example. For a new component, add
`staticContainer: 'HOMEPAGE'`. For an existing component, preserve its current
`staticContainer` value unless the request explicitly changes installation
behavior.

## Checklist

- [ ] Defaults are applied to the generated editor element before layout
      overrides are merged.
- [ ] Client and editor resources still point to their generated entry files.
- [ ] The extension and `component.tsx` consume the same `defaultProps` source.
- [ ] Initial sizing and resize axes match component behavior.
- [ ] A new component has `staticContainer: 'HOMEPAGE'`; an existing
      component keeps its prior installation behavior unless explicitly changed.
