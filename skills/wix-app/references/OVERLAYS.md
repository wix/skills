# Overlay Compatibility Route

Choose by user context, not loose wording such as "drawer" or "panel."

| Need | Route |
| --- | --- |
| Selected desktop record in a supported one-collection manager | [DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md), its row-action/AppContext references, and WDS SidePanel documentation |
| Selected desktop record in an unsupported custom table | [DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md](DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md) and WDS SidePanel documentation |
| Focused blocking task | [DASHBOARD_MODAL_PLAYBOOK.md](DASHBOARD_MODAL_PLAYBOOK.md) |
| Mobile sliding task surface | WDS Drawer documentation |

Use the Auto Patterns entity page for structured record inputs before introducing an overlay. Do not use Drawer as a desktop SidePanel synonym or Modal as a selected-row fallback. The selected playbook owns composition and validation; installed WDS documentation owns exact props and examples.
