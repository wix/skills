# Editor Preview Entry

Use this reference when `component.preview.tsx` must behave differently in
Harmony Editor design mode than on the live site.

## Preserve the Generated Contract

The Wix CLI scaffold generates `component.preview.tsx` and wires its URL into
the extension's editor resource. It includes `withDefaults`,
`withFallbackPlaceholder`, required-data fields, and the root class name.

Do not repeat or replace that boilerplate. Keep the generated wrappers and
metadata, and change only the preview component when editor behavior must differ
from live behavior.

## Detect Editor Design Mode

Use `useIsEditMode()` from `@wix/react-component-utils`:

```tsx
const isEditMode = useIsEditMode();
```

- `true`: editor design mode
- `false`: editor preview mode or live-equivalent rendering

Call the hook inside a React component, never at module scope or conditionally.

## Modify Only When Needed

Keep the generated passthrough unchanged unless the component requires
editor-specific runtime behavior. The primary case is suppressing autoplay,
timers, or network activity while a site owner is designing.

For autoplaying components, force autoplay off in editor design mode and keep
the live/preview prop values unchanged.

## Checklist

- [ ] Generated defaults and fallback-placeholder behavior remain intact.
- [ ] Required data fields and root class metadata are unchanged.
- [ ] The extension still loads the preview URL as its editor resource.
- [ ] `useIsEditMode()` is called inside a component.
- [ ] Live/preview behavior still receives the site owner's original props.
