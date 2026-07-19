# Overlays

Choose an overlay by user context, not by loose wording such as “drawer” or “panel.”

## Canonical Implementation References

For Dashboard Modal, read [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md) before scaffolding or calling the dashboard API. For WDS SidePanel or Drawer, read [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md), invoke the Wix Design System skill, and read the exact component guidance before writing UI. This file chooses the overlay; it does not replace component documentation.

| User need | Primitive | Rules |
| --- | --- | --- |
| Inspect or edit a selected item while retaining desktop page context | WDS SidePanel | Use the documented overlay component. It must layer above the page and not become a fixed element inside the page layout. |
| Perform a focused, blocking, bounded task | Dashboard Modal | Create/use the Dashboard Modal extension and open it through the dashboard API. Use for confirmations, isolated forms, and non-contextual detail tasks. |
| Present a mobile sliding task surface | WDS Drawer | Use it for mobile drawer behavior, not as a generic desktop SidePanel substitute. |

## Precedence

Choose SidePanel when the manager must keep the source table or page visible while working on the selected record. Choose Dashboard Modal when the task should block page interaction and stand alone. Choose Drawer only for a mobile sliding surface.

SidePanel and Drawer are primitives hosted by a Dashboard Page; neither is a CLI extension. Dashboard Modal is a separate extension. When an Auto Patterns page cannot add the primitive through a documented override, use a custom Dashboard Page or split the workflow.

## Layout Guardrails

- Do not set a nested content layout to the same fixed dimensions as its overlay host.
- Do not use `overflow: auto` on the outer host by default.
- Let the host control containment; place scroll behavior only in the documented content region when needed.
- Keep close controls, focus handling, and page blocking behavior in the documented component.

## Language Guardrail

When writing instructions, name the exact component: `SidePanel`, `Drawer`, or `Dashboard Modal`. Do not write “drawer/side panel” unless responsive behavior deliberately uses both and the breakpoint behavior is specified.
