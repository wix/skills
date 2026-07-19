# Dashboard Components

Use this map after choosing a custom Dashboard Page or a documented Auto Patterns override. It narrows common dashboard choices; it does not duplicate Wix Design System documentation.

## Required Documentation Gate

Before importing a WDS component:

1. Choose the matching row below.
2. Invoke the `wix-design-system` skill and open the exact component documentation in `packages/wix-design-system`.
3. Record the selected component and documentation target in the capability plan.
4. Follow the documented composition, accessibility, focus, and scroll behavior. Do not recreate the component with custom CSS.

For any dashboard UI not listed below, use the `wix-design-system` skill to search `packages/wix-design-system`, read the exact component documentation and example, then record that target before implementation.

## Common Dashboard Decisions

| Need | Route | Documentation target | Guardrail |
| --- | --- | --- | --- |
| Supported single-collection CRUD, filters, pagination, and table actions | Auto Patterns first | [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md) | Do not rebuild this in WDS when Auto Patterns supports the full page. |
| Custom table or multi-source data list | Custom Dashboard Page + WDS `Table`, `TableToolbar`, `TableActionCell`, and `Pagination` as needed | `packages/wix-design-system`: selected table component documentation | Define loading, empty, error, sorting, filters, and row-action behavior before coding. |
| Search and filters | WDS `Input`, `Dropdown` or `MultiSelect`, and `DatePicker` as needed | `packages/wix-design-system`: selected filter component documentation | Match the data contract; do not add controls that cannot affect the query. |
| Labeled input or form field | WDS `FormField` plus the selected input control | `packages/wix-design-system`: `FormField` and selected control documentation | Use visible labels and documented validation; do not use placeholder-only labels. |
| Destructive or primary action | WDS `Button`; use `IconButton` only for a familiar icon action | `packages/wix-design-system`: selected button documentation | Give icon-only actions an accessible label and tooltip when needed. |
| Desktop contextual inspect, edit, or assign flow | WDS `SidePanel` | `packages/wix-design-system`: `SidePanel` documentation | Keep the source page visible; use the documented host, focus, close, and scroll behavior. |
| Mobile sliding task surface | WDS `Drawer` | `packages/wix-design-system`: `Drawer` documentation | Do not substitute this for a desktop SidePanel. |
| Focused blocking task or standalone form | Dashboard Modal extension | [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md) | This is not a WDS `Modal` inside a Dashboard Page. |
| Persistent warning, permission, or setup issue | WDS `TopBanner` or the documented feedback component | `packages/wix-design-system`: selected feedback component documentation | Explain the consequence and next action; do not use a banner as a hidden console log. |
| Success, error, or completion feedback after an action | WDS `Notification` or the documented feedback component | `packages/wix-design-system`: selected feedback component documentation | Tie the feedback to the action outcome and preserve an error recovery path. |
| Loading, empty, or recoverable error state | Documented WDS or Auto Patterns state component | `packages/wix-design-system`: selected state component documentation | Never leave a blank page after a failed request; each state needs an intentional message and recovery action. |
| Page frame, responsive grid, or grouped content | WDS `Page`, `Layout`, `Cell`, and `Card` as needed | `packages/wix-design-system`: selected layout component documentation | Use the documented dashboard grid and spacing tokens; do not nest full-page layouts inside overlays. |
| KPI or chart | Custom visualization after [VISUALIZATIONS.md](VISUALIZATIONS.md) | Exact chart/library documentation selected for the project | Do not claim an Auto Patterns chart capability unless its docs explicitly support it. |

## Plan Evidence

For every WDS-backed capability, add its selected components and documentation targets to the plan. Example:

```json
{
  "id": "class-assignment",
  "implementationPrimitive": "wds-side-panel",
  "wdsComponents": ["SidePanel", "FormField", "Dropdown", "Button"],
  "documentationTargets": [
    "packages/wix-design-system: SidePanel",
    "packages/wix-design-system: FormField",
    "packages/wix-design-system: Dropdown",
    "packages/wix-design-system: Button"
  ]
}
```

The completion report must name the WDS components and documentation targets actually used. Do not report a generic claim such as “used WDS.”
