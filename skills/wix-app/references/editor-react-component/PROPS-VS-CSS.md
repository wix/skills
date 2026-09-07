# Props vs CSS

Use this reference to decide whether a value belongs in the public React
contract, component logic, or editable CSS.

## Decision Table

| Value controls | Put it in | Examples |
| --- | --- | --- |
| User-authored content or data | React prop | `label`, `items`, `image`, `link` |
| Stable runtime behavior | React prop | `disabled`, `required`, `autoPlay`, `loop` |
| Value derived from props or state | Component logic | subtotal, active count, formatted label |
| Appearance or layout | CSS | spacing, alignment, orientation, icon position |
| Breakpoint-specific visibility | CSS/editor controls | show label, compact layout, mobile visibility |
| Direction | React prop plus logical CSS | `direction?: Direction` |

Ask in this order:

1. Can the value be derived? Compute it internally.
2. Does it select content or stable behavior? Use a prop.
3. Could a site owner reasonably vary it by breakpoint? Use CSS/editor controls.
4. Otherwise, keep visual and layout choices in CSS.

## Visibility Rules

Do not add `showLabel`, `showIcon`, `hideOnMobile`, `displayMode`, or similar
props for purely presentational visibility. Render the named part and let the
editor control that part per breakpoint.

Use this pattern:

```tsx
<div
  {...elementProps?.progressBar}
  className={classNames(
    'audio-player-progress-bar',
    styles.progressBar,
    elementProps?.progressBar?.className,
  )}
>
  {/* progress UI */}
</div>
```

Do not interpret this rule as "never conditionally render." Conditional output
is valid when data, semantics, or runtime behavior requires it—for example an
empty-state message, a loading branch, or content that does not exist.

Behavior-critical visibility may also be a prop when visibility itself changes
the interaction contract. `pauseButtonVisibility` in an autoplaying component
is the canonical exception: the editor preview must be able to force the
play/pause control visible.

## Examples

### Content and Behavior Props

```ts
export type AudioPlayerProps = {
  title?: string;
  audioUrl?: string;
  disabled?: boolean;
  autoPlay?: boolean;
};
```

### Visual Decisions Kept Out of Props

```ts
// Do not add these to the public contract:
// showIcon?: boolean
// orientation?: 'horizontal' | 'vertical'
// compact?: boolean
// hideOnMobile?: boolean
```

Define their resting appearance in the CSS Module and expose independently
editable elements as named parts with global/module classes and `elementProps`
wiring.

## Checklist

- [ ] Props represent authored data or stable behavior.
- [ ] Derived values are computed internally.
- [ ] Visual and layout choices live in CSS.
- [ ] Breakpoint visibility uses a named part, not a show/hide prop.
- [ ] Conditional rendering is used only for real data, semantic, or behavioral branches.
