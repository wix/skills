# Overlays

Choose an overlay by user context, not by loose wording such as “drawer” or “panel.”

## Canonical Implementation References

For Dashboard Modal, read [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md) and [WDS_MODAL_GUIDELINES.md](WDS_MODAL_GUIDELINES.md) before scaffolding or calling the dashboard API. For WDS SidePanel or Drawer, read [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md), invoke the Wix Design System skill, and read the exact component guidance before writing UI. This file chooses the overlay; it does not replace component documentation.

| User need | Primitive | Rules |
| --- | --- | --- |
| Inspect or edit a selected item while retaining desktop page context | WDS SidePanel | Required for a selected desktop table row unless the prompt explicitly asks for a blocking task. Default to `skin="floating"` as a non-blocking overlay. It must layer above the page, leave the source page interactive, and not become a fixed element inside the page layout. |
| Perform a focused, blocking, bounded task | Dashboard Modal | Create/use the Dashboard Modal extension and open it through the dashboard API. Use for confirmations, isolated forms, and non-contextual detail tasks. |
| Present a mobile sliding task surface | WDS Drawer | Use it for mobile drawer behavior, not as a generic desktop SidePanel substitute. |

## Layout Guardrails

- Before implementation, read the WDS `SidePanel` source and its `Skin` and `Quick view` examples. Use their component tree and documented props as the baseline; do not recreate component styling with custom CSS.
- Treat Storybook quick-view wrappers as demos, not drop-in dashboard frames. In particular, do not copy a demo's fixed page height or root `overflow: hidden` around a production table just to animate or clip an off-canvas panel.
- Use `skin="floating"` explicitly for the default overlay surface. Do not add a dimming scrim unless the task is explicitly blocking.
- `SidePanel` is a surface component, not a portal or positioning system: it owns its internal header/content/footer layout, while its host determines where it appears and how much viewport height it receives. Use the dashboard application's documented optional side-panel region for that host. Do not assume that mounting a `SidePanel` next to a table makes it an overlay.
- Do not mount a panel under a scrolling or clipping table/card wrapper. Mount it as a sibling of the page content in a dedicated dashboard-level overlay layer. The host must retain its height when the table filters, empties, grows, or shrinks, and must derive that height from the available dashboard content region rather than rendered page content.
- `SidePanel` defaults to `height="100%"`, which means **100% of its immediate host**, not necessarily the usable dashboard area. Read the installed `SidePanel` Height example and the page/layout source before choosing that host. Do not use `100vh`, `100dvh`, a fixed height, or a page-content height as a generic workaround inside an embedded Dashboard Page: dashboard chrome can make those values exceed or undershoot the actual content region.
- Use the documented dashboard page/layout region that owns the available content height. Let that stable host bound the panel, then let only `SidePanel.Content` scroll. Do not override the documented panel width or height merely to imitate a Storybook screenshot; use component defaults unless the task and source documentation justify a different value.
- The overlay layer may manage panel stacking, but it must not become the overflow or width container for the page's table. Keep table layout and any documented table scrolling in the page/table region; a SidePanel implementation must never clip the final table column, toolbar, or row action.
- Use the documented three-region structure only: `SidePanel.Header`, `SidePanel.Content`, then `SidePanel.Footer`. Let the component own its spacing and sizing; do not replace these regions with custom padded containers. The body is the only scrollable region, while the header and footer remain fixed.
- Give each region exactly one padding owner. For the standard composition, `SidePanel.Content` owns content padding and its first child must not add root padding. Use a `noPadding` or similar override only when the installed WDS source explicitly supports it; never leave compensating inner padding after that override is removed during type repair.
- Status badges must follow the installed `SidePanel.Header` example. Do not build a header from a custom `Box`/`div`, or add bare title/status siblings that bypass the header title area's horizontal padding. Use only the installed source-supported Header title/status composition. When several statuses exist, use the header's supported wrapping/summary pattern rather than allowing a badge row to escape the header bounds.
- Validate the panel with content longer than the available viewport: its footer must remain visible, and only `SidePanel.Content` may scroll. The panel's outer top and bottom, including its floating shadow, must fit within the available dashboard content region without creating a browser/page-level scrollbar. A clipped footer or shadow, a page-level scrollbar caused by the panel, a content-height-dependent panel, or doubled content padding is a failed overlay implementation.
- Use a push layout only when the user explicitly asks for a persistent side-by-side workspace, or when the capability plan explains why the manager must see the full main-page context while editing. Record that choice before implementation.
- "Keep the list visible" means leave the background page visible beneath a floating SidePanel; it does not imply that the panel should consume a grid or flex column beside the table.
- Keep close controls, focus handling, and page blocking behavior in the documented component.
- If a Dashboard Modal is explicitly required, read `DASHBOARD_MODAL.md` and its exact WDS modal-layout documentation before implementation. Give one element ownership of scrolling: constrain the modal to the viewport, let only its content region scroll when needed, and prevent horizontal overflow. Do not use a modal as a fallback for a selected-row SidePanel.

## Language Guardrail

When writing instructions, name the exact component: `SidePanel`, `Drawer`, or `Dashboard Modal`. Do not write “drawer/side panel” unless responsive behavior deliberately uses both and the breakpoint behavior is specified.
