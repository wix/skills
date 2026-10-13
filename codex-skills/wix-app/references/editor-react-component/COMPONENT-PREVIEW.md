# Editor Preview Entry

Use this when creating a component or changing its data, root, or editor-only
behavior.

## Preserve the Structure, Synchronize the Contract

The Wix CLI scaffold generates `component.preview.tsx` and wires its URL into
the extension's editor resource. It includes `withDefaults`,
`withFallbackPlaceholder`, required-data fields, and the root class name.

Keep the wrapper structure and synchronize its values. The renderer detects
preview defaults only when `withDefaults` wraps the result of
`withFallbackPlaceholder`. The calls may be nested directly:

```tsx
export default withDefaults(
  withFallbackPlaceholder(ComponentPreview, {
    requiredDataFields: ['animationUrl'],
    rootClassName: 'component-root',
  }),
  defaultProps,
);
```

- Wrap the preview adapter when one exists; otherwise wrap `Component`.
- In `requiredDataFields`, normally use only the one prop crucial to meaningful
  rendering, such as `animationUrl`. Use more only when each is essential.
- Set `rootClassName` to the elected root's exact global class, not `styles.root`.

Never remove either wrapper, export `withFallbackPlaceholder(...)` directly, or
invert their order. Preserve the equivalent of
`withDefaults(withFallbackPlaceholder(...), defaultProps)` even when editing
the preview component or fallback options. Assigning either wrapped component
to a variable is valid as long as that outer-to-inner order stays intact.

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

Pass the adapter to `withFallbackPlaceholder`, then pass that wrapped component
to `withDefaults`. This may be written inline as shown above or through component
variables. Synchronize the data field and root class either way.

## Checklist

- [ ] Generated wrappers target the preview adapter when one exists.
- [ ] The default export resolves to `withDefaults` outside
      `withFallbackPlaceholder`, whether inline or through component variables.
- [ ] Normally one crucial data field and the exact root global class are set.
- [ ] The extension still loads the preview URL as its editor resource.
- [ ] `useIsEditMode()` is called inside a component.
- [ ] Live/preview behavior still receives the site owner's original props.
