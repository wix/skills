# Dashboard Layout

Use this reference only for a **custom Dashboard Page using WDS** when the page has two or more content regions, such as statistics plus a table, charts plus filters, or a form with supporting context. It does not apply to an Auto Patterns page unless a documented Auto Patterns override explicitly requires custom WDS composition.

Read the WDS Dashboard Layout guideline and the exact `Page`, `Layout`, `Cell`, and `Card` documentation selected for the page. This reference makes the layout decision; component documentation defines the implementation.

## Composition Decision

Use the WDS dashboard grid as a content hierarchy, not as a reason to hand-build a CSS grid with copied measurements.

| Content | Recommended dashboard span |
| --- | --- |
| Wide operational table or dense list with many columns | Full width / 12 columns |
| Table or chart with a moderate amount of information | 8 columns |
| Compact table, list, statistics, or supporting chart | 6 columns |
| Summary, preview, metric, or small chart | 3 or 4 columns |
| Form with optional supporting context | 8/4 split, or full width when the form genuinely needs it |

Keep a table full width when reducing its width would hide or compress operational fields. Do not put a full-page layout inside an overlay. SidePanel, Drawer, and Modal composition is governed by [OVERLAYS.md](OVERLAYS.md).

## Layout Rules

- Define the page regions and their hierarchy before implementation: primary work surface first, then supporting insight or setup content.
- Use WDS layout components and spacing tokens. Do not reproduce the dashboard grid with ad hoc fixed dimensions.
- Keep forms readable: avoid coast-to-coast inputs. Use the documented form layout when the page contains a longer editing workflow.
- Use cards only for genuinely grouped tools or repeated items. Do not wrap every page section in another card.
- Keep filters, table controls, and results together as one operational surface.
- Re-evaluate the composition at narrow dashboard widths; text, controls, and columns must not overlap or silently disappear.

## Required Evidence

Record the chosen primary region and its reason in the capability plan. Validate the page at the dashboard viewport with its longest labels, widest table state, and any open overlay.
