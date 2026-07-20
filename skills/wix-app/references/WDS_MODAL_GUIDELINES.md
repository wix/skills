# WDS Modal Guidelines

Use this reference only after the routing decision has selected a **Dashboard Modal extension** or another explicitly appropriate WDS modal surface. It does not authorize rendering a WDS `<Modal />` directly inside a Dashboard Page; follow [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md) for the dashboard extension and API contract.

Read the WDS Modals and Overlays guideline plus the exact selected modal-layout documentation before implementation.

## Choose The Correct Modal

| Need | Desktop primitive | Mobile adaptation |
| --- | --- | --- |
| Short, focused confirmation or alert | Message Modal | Drawer when page context matters; Mobile Modal when it does not |
| User-initiated form, rich content, or bounded multi-step task | Custom Modal | Drawer for a short contextual form; Full Screen Modal for long or complex work |
| Promotion or optional entry point | Announcement Modal | Full Screen Modal or Drawer as appropriate |

Do not use a modal for selected-record inspection/editing that should retain desktop table context; use `SidePanel` through [OVERLAYS.md](OVERLAYS.md). Do not substitute a Drawer for a desktop SidePanel.

## Implementation Rules

- Desktop modals are centered overlays with a backdrop. Use the documented WDS layout rather than a custom container that imitates one.
- Match the modal to content length and task complexity. Short decisions belong in a Message Modal; richer forms belong in a Custom Modal.
- Give every modal an obvious exit path: close and/or cancel without completing the primary action.
- Use a specific verb in the primary CTA, especially for destructive actions. Explain destructive consequences before the action.
- Give one region ownership of scrolling. Follow the selected layout's documented content region; do not add a second page-level scroll wrapper or allow horizontal overflow.
- Do not stack modals unless unavoidable; prefer content replacement or in-context feedback for non-blocking follow-up.
- Preserve the documented focus behavior: focus trap while open, Escape dismissal on desktop, and focus return to the trigger after close. Never auto-focus a destructive action.

## Required Evidence

Test the open and close path, Escape behavior, focus return, long content, visible primary and cancel actions, and horizontal overflow in the browser.
