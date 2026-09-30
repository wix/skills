# Overflow and Resizing

Apply when creating a component or changing its layout, content, or sizing.
Custom components own their internal layout; do not assume the editor exposes
native-container overflow settings for their DOM. The component must keep
content and controls usable within its assigned size.

## Choose What Happens When Content Does Not Fit

- **Content-height component:** reflow at narrower widths and let normal-flow
  content establish height. Do not constrain it with `height: 100%`, a fixed
  height, or absolute positioning of all content.
- **Bounded-height component:** propagate the height constraint through growing
  wrappers (`min-height: 0` for flex/grid items). Fit the content or give the
  intended content region `overflow: auto`; keep essential controls reachable.
  Choose scrolling only when it suits the requested interaction.
- **Carousel or other intentional overflow:** contain the oversized track in
  its own viewport and provide working navigation/scrolling to every item.
  Treat a requested count such as "show four items at a time" as the
  default/initial-width presentation unless the user explicitly requires that
  column count at every width. Each carousel page should still contain that
  requested group at narrow widths, but its internal layout must reflow so every
  required item is usable. Stacking or wrapping the current page's items
  preserves the group; squeezing them into tiny columns or clipping later items
  does not. Choose the installation width, gaps, padding, and usable item
  minimum together so the requested count actually fits at the initial size.

  A container-driven group page can preserve the requested grouping without
  changing the carousel's item-count logic:

  ```css
  .trackViewport {
    min-width: 0;
    overflow: hidden;
  }

  .page {
    box-sizing: border-box;
    display: grid;
    flex: 0 0 100%;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 16px;
  }

  .item {
    min-width: 0;
  }
  ```

  At a wide initial width, the page uses the requested presentation count. When
  the component is narrower than a usable item minimum, the same group wraps to
  fewer columns or a single column and its content-height component grows.
  Equivalent container-query or wrapping layouts are valid. A fixed
  `repeat(<count>, minmax(0, 1fr))` or percentage basis derived from the count is
  not sufficient as the only layout for a horizontally resizable component.

Do not apply blanket `overflow: hidden`/`clip` to the root or page as a repair.
It can hide text, focus indicators, navigation, and overlays while leaving the
layout defect intact. Clip a dedicated media/track/decorative region only when
that is its intended behavior. Preserve deliberate shadows and overlays.

## Remove Intrinsic Sizing Traps

`width: 100%` and `box-sizing: border-box` on the root are necessary, but do not
constrain descendants. A bare `1fr` track has an automatic minimum; three such
tracks can exceed the container even when the grid itself is correctly sized.

- Use `min-width: 0` on flex/grid items that must shrink, including nested
  content wrappers. For a fixed column count, use `minmax(0, 1fr)`; still adapt
  the layout when columns would become too narrow to use.
- Prefer fewer columns or wrapping to squeezing text and controls. An intrinsic
  collection can use the following pattern; the minimum never exceeds its
  container's content width:

  ```css
  .grid {
    box-sizing: border-box;
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 16px;
  }
  ```

  `minmax(280px, 1fr)` alone still overflows a slot narrower than 280px.
  This grid is suitable for a wrapping collection, not a substitute for a
  carousel's item/navigation contract.
- For user-authored prose, allow wrapping and use `overflow-wrap: anywhere`
  where long words/URLs could force intrinsic width. Use truncation only when
  the product intends it and essential content remains available.
- Constrain images/media to the space available; preserve aspect ratio or use
  an intentional fitted media frame. Check fixed-size media plus adjacent text,
  padding, borders, and gaps together.
- Let control rows and pagination adapt without losing buttons, focus rings,
  or usable target sizes. `min-width: 0` does not make fixed children or large
  padding fit by itself.

Adapt to the component's width, including a narrow slot on a desktop viewport.
Do not derive the layout from `window.innerWidth` or viewport breakpoints. If
container queries are needed, establish the query container on an appropriate
ancestor; a query cannot restyle its own container based on that container's
size. Do not add size containment on an auto-height component that prevents
content from establishing its height.

## Review Before Reporting Completion

First inspect the sizing chain in source. Identify the root, growing wrappers,
tracks, cards, text, media, and controls; check each constrained axis. Do not
infer safety from a CSS keyword or a successful build.

When a runnable browser preview is available, exercise the actual component:

1. Vary the **component container** independently of the page viewport. Cover
   its initial size, 320px, a narrower stress probe such as 240px, and a wider
   slot. For a vertically resizable component, also test a short bounded height;
   for content height, verify the root grows without overlapping the next block.
   A horizontally resizable top-level component must keep required content
   usable at 320px unless an actual supported editor minimum is part of its
   contract. Treat 240px as a stress probe. Report any unsupported size and its
   remaining usability limit.
2. Use long prose and an unbroken token, larger text, changed padding/borders,
   and representative item counts. For carousels, test navigation and the
   longest item; include RTL when direction changes layout or navigation.
3. Compare root/region `scrollWidth` with `clientWidth` (allow about 1px for
   rounding), and inspect descendant bounds. For bounded height, also compare
   `scrollHeight` and `clientHeight`. An intentional scroll region/track may
   exceed its client size, but its content must remain reachable and contained.
   Check the component itself: a page ancestor may clip overflow while the
   document has no horizontal scrollbar. Conversely, shadows/overlays do not
   automatically mean the content layout is broken.
4. Visually inspect and use the controls/keyboard. Passing geometry checks by
   clipping required content is a failure. Verify intentional scroll regions
   are usable with keyboard and touch, focus stays visible, and navigation can
   reach every item.

Fix confirmed component-owned defects and repeat affected cases. If the first
incorrect constraint comes from the host layout, report that boundary instead
of masking it inside the component. For existing components, preserve unrelated
public props, editor overrides, and behavior.

Report sizes/states tested and any remaining overflow or inaccessible content.
If no browser preview or fixture is available, perform the source review and
state that rendered resize behavior is **unverified**; do not claim the resize
review passed. Build, typecheck, a11y scans, and manifest generation do not
establish that layout fits.
