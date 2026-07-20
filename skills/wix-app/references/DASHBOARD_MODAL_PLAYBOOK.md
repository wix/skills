# Dashboard Modal Playbook

Use this route for a focused, blocking, bounded dashboard task such as confirmation or an isolated form. Do not use it for selected-row inspection that should preserve desktop page context.

## Required Documentation

Read [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md), the Dashboard API method used to open it, and the installed modal-layout documentation selected by the guide.

## Modal Contract

- **DM-01:** Scaffold a Dashboard Modal extension and open it through the documented dashboard API. Do not render a hand-built or WDS Modal directly inside a Dashboard Page.
- **DM-02:** Keep the task focused and bounded. Use a SidePanel for non-blocking selected-record context and Drawer for mobile sliding work.
- **DM-03:** Use the documented modal header, content, and footer composition. Secondary actions precede a right-aligned primary action.
- **DM-04:** Give one element ownership of scrolling. Constrain the surface to its documented viewport behavior; only Content scrolls when necessary, and horizontal overflow is forbidden.
- **DM-05:** Validate inputs, preserve entered data on recoverable failure, communicate success, and intentionally close or return a result to the caller.

## Acceptance

Open the modal from its real caller, complete and cancel the task, test validation and request failure, and verify focus, content containment, footer visibility, console, network, and persisted result.
