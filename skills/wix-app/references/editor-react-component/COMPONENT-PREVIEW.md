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

Use `useIsEditMode()` from `@wix/react-component-utils` only in
`component.preview.tsx`:

```tsx
const isEditMode = useIsEditMode();
```

- `true`: editor design mode
- `false`: editor preview mode

It is also `true` on the published site, so never call it in
`<component-name>.tsx` or its hooks.

Call the hook inside a React component, never at module scope or conditionally.

## Modify Only When Needed

Keep the generated passthrough unchanged unless the component requires
editor-specific runtime behavior. The primary case is suppressing autoplay
or timers while a site owner is designing.

In both modes, render `Component` with the site owner's props; design mode only
overrides existing prop values, such as `autoPlay={false}`. Never render
placeholder text or other markup instead.

For autoplaying components, force autoplay off in editor design mode and keep
the live/preview prop values unchanged.

Pass the adapter to `withFallbackPlaceholder`, then pass that wrapped component
to `withDefaults`. This may be written inline as shown above or through component
variables. Synchronize the data field and root class either way.

## Switch Off Writes in the Editor

When the component sends a request by itself (on mount or a timer) that
changes data or costs money, such as counting a visit, tracking, or sending a
message, give it an optional `allowWrites` prop that defaults to `true`. Mark it
`/** @ignore */` so it stays out of the manifest, and leave it out of
`defaultProps`. The preview passes `false` in both modes:

```tsx
// <component-name>.props.ts
/** @ignore */
allowWrites?: boolean;

// <component-name>.tsx: destructure `{ allowWrites = true, ...props }`
useEffect(() => {
  if (!allowWrites) return;
  // send the request
}, [allowWrites]);

// component.preview.tsx
return <Component {...props} allowWrites={false} />;
```

Requests that only read the data the component shows still run in the editor.

## Checklist

- [ ] Generated wrappers target the preview adapter when one exists.
- [ ] The default export resolves to `withDefaults` outside
      `withFallbackPlaceholder`, whether inline or through component variables.
- [ ] Normally one crucial data field and the exact root global class are set.
- [ ] The extension still loads the preview URL as its editor resource.
- [ ] `useIsEditMode()` is called only in the preview component.
- [ ] Both modes render `Component`, never a placeholder.
- [ ] A request that changes data or costs money is gated on an `@ignore`
      `allowWrites` prop the preview sets to `false`.
- [ ] Live/preview behavior still receives the site owner's original props.
