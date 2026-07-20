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
- Use `skin="floating"` explicitly for the default overlay surface. Do not add a dimming scrim unless the task is explicitly blocking.
- `SidePanel` is a surface component, not a portal or positioning system: it owns its internal header/content/footer layout, while its host determines where it appears and how much viewport height it receives. Use the dashboard application's documented optional side-panel region for that host. Do not assume that mounting a `SidePanel` next to a table makes it an overlay.
- Do not mount a panel under a scrolling or clipping table/card wrapper. Do not create a custom split layout or hard-coded positioning just to imitate a floating panel. If the current Dashboard Page host has no documented panel region, record that limitation instead of presenting a shrunken or clipped panel as a valid floating implementation.
- Use the documented three-region structure only: `SidePanel.Header`, `SidePanel.Content`, then `SidePanel.Footer`. Let the component own its spacing and sizing; do not replace these regions with custom padded containers. The body is the only scrollable region, while the header and footer remain fixed.
- Validate the panel with content longer than the available viewport: its footer must remain visible, and only `SidePanel.Content` may scroll. A clipped footer or a page-level scrollbar is a failed overlay implementation.
- Use a push layout only when the user explicitly asks for a persistent side-by-side workspace, or when the capability plan explains why the manager must see the full main-page context while editing. Record that choice before implementation.
- "Keep the list visible" means leave the background page visible beneath a floating SidePanel; it does not imply that the panel should consume a grid or flex column beside the table.
- Keep close controls, focus handling, and page blocking behavior in the documented component.
- If a Dashboard Modal is explicitly required, read `DASHBOARD_MODAL.md` and its exact WDS modal-layout documentation before implementation. Give one element ownership of scrolling: constrain the modal to the viewport, let only its content region scroll when needed, and prevent horizontal overflow. Do not use a modal as a fallback for a selected-row SidePanel.

## Language Guardrail

When writing instructions, name the exact component: `SidePanel`, `Drawer`, or `Dashboard Modal`. Do not write “drawer/side panel” unless responsive behavior deliberately uses both and the breakpoint behavior is specified.
