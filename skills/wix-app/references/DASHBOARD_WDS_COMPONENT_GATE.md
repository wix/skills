# Dashboard WDS Component Gate

Use this gate after the Auto Patterns route has been evaluated. It serves either an Auto Patterns extension that needs the exact WDS composition for a supplemental surface, or a genuinely unsupported workflow that requires a custom dashboard route.

## Documentation Target

Use the bundled `wix-design-system` skill rather than a hard-coded Storybook or source-repository URL. Its `wds.cjs` helper resolves the version installed in the generated app, so the props and examples match the package that will run.

```bash
WDS="<wix-design-system skill>/scripts/wds.cjs"
node "$WDS" component <Component>
node "$WDS" example <Component> "<Example>"
```

Use a direct source or Storybook link only when the installed documentation lacks the required behavior. Record that exception and the version or commit it applies to.

## Required Record

Before supplemental or custom JSX, record:

```text
Auto Patterns capability: <supported-via-override or unsupported capability>
primary owner: <Auto Patterns collection page or custom dashboard>
required surface: <surface>
documentation read: <installed WDS component/example or chart-library API>
reason: <why this surface fits the workflow>
```

## Surface Map

| Required workflow surface | Exact installed documentation to retrieve | Route rule |
| --- | --- | --- |
| Moderate-depth view or edit that should preserve table context | `component SidePanel`; examples: `Skin`, `Height`, `Header`, `Custom header`, `Content sections`, `Custom footer`, `Quick view` | Keep Auto Patterns primary and mount the floating SidePanel through its documented row-action/AppContext extension. |
| Short, focused, blocking view/edit task, confirmation, or destructive decision | `components Modal CustomModalLayout`; the `CustomModalLayout` composition example; Dashboard Modal API | Use Dashboard Modal for the bounded task without replacing the collection page. |
| Extensive or multi-section view/edit flow, complex validation, deep linking, or long work | Auto Patterns `entity-page.md` and relevant entity-page action reference | Use the linked entity page; viewing and editing are both valid when the workflow depth warrants a full page. |
| Mobile sliding work | `component Drawer`; its relevant composition example | Do not substitute it for desktop SidePanel. |
| Metrics or summary band | `components StatisticsWidget Layout Cell Card`; relevant layout examples | Use the analytics playbook. |
| Chart or graph | Exact installed/supported chart-library API plus `components Layout Cell Card` | Do not invent chart APIs or claim Auto Patterns chart support. |
| Custom operational table | `components Table TableToolbar TableActionCell EmptyState`; selected control examples | Use the table playbook selected by the workflow. |

## Rules

- A component name in a prompt is not enough: retrieve its exact documentation and composition example first.
- Choose SidePanel, Modal, or entity page from information depth, task duration, blocking behavior, need for table context, validation complexity, and deep-linking needs. Do not map `view` or `edit` to one mandatory component.
- A WDS component gate does not transfer ownership of a supported one-collection table from Auto Patterns to custom React. Extend the generated page with the narrow documented action/AppContext/entity-page path instead.
- Do not hand-compose a documented surface from generic `Box` or a copied scaffold template. A floating `SidePanel` is the exception only for its mount: use the selected playbook's standard `DashboardSidePanelHost` for fixed viewport anchoring. Do not invent other panel positioning, sizing, shadow, or overflow styles.
- When multiple surfaces are needed, read only the component documentation mapped to those surfaces. Do not load the whole WDS library.
- Validate the real browser behavior specific to the surface: containment and scrolling for overlay components; empty, populated, and interaction states for tables; data shape and failure states for charts.
