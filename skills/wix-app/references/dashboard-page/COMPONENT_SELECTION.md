# Component Selection Order

The full selection rules for dashboard UI: which library owns what, how to look a component up, the WDS fallback, overlaps, and the create/edit flow for a listed record. [SKILL.md](../../SKILL.md#component-selection-order) holds the summary.

**For the page shell, provider nesting, and routing — the part every dashboard page needs — start from [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md), not this section.** It finds the page templates the installed `@wix/patterns` ships (read-only list, list with create/edit, settings only, and a CMS collection on its schema); copy the one the request matches and adapt it. What follows here is for individual UI elements the template doesn't already show — a filter type, a column renderer, a component the request needs that isn't in it.

Dashboard pages at Wix are built from two libraries. For **every** UI element not already covered by the template, resolve in this order and stop at the first hit. Never skip a step, and never decide a component is missing from memory — check.

## 1. `@wix/patterns` — page structure and data collections

Patterns owns the page shell and everything collection-shaped: page shells and their header /
content / footer sub-parts, tables and grids and the switch between them, folder views,
collection state (paging, sorting, selection, loading), filters, search, view presets, row and
bulk actions, drag-and-drop, in-extension routing, the overlays tied to a collection, and the
add / edit / view page for one listed item. If you need one of those, it is patterns' — look it
up rather than assembling it from WDS parts.

**Which component serves a given need is the library's own answer, not this skill's.** It ships
that answer as guides inside the installed package, with every component name in them checked
against the real package at build time. Walk them: [The Discovery Chain](../WIX_PATTERNS_DOCS.md#the-discovery-chain).

Whole pages are the package's too: the router wiring for a multi-page extension, and a
**collection whose fields the CMS owns** — `useCmsSchemaSource` from `@wix/patterns-cms`, with
`@wix/patterns/schema`, where the schema supplies fetch, filters, columns and the form — both ship
as page templates. See [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md).

The short version: list every patterns name you plan to write, and resolve them all in one
`node <pkgRoot>/bin/patterns-lookup.cjs <name…>` call, not one index probe per name.
Its output gives each name's import line (no read needed), its worked examples, and the one
file that holds its props. Read the one artifact your open question needs. Resolve `<pkgRoot>` once per session
([Prerequisites](../WIX_PATTERNS_DOCS.md#prerequisites)) and reuse it.

**Opening one item from a collection uses an editable `EntityPage` by default; create/edit flows also use `EntityPage`, never a dashboard modal** — see
[Entity create and edit](#entity-create-and-edit), and `Collection to Entity Flow.md` in the
package for the flow itself.

**Falling through to step 2 because a lookup was inconvenient is the single most common way a
dashboard page ends up built entirely from WDS.** A missing index means the lookup has not
happened yet, not that patterns lacks the component.

## 2. `@wix/design-system` — everything inside the shell

The leaf-level UI patterns does not own: inputs, buttons, form fields, text, layout primitives, cards, badges, tooltips, toasts, icons. Pick the component by lookup, not recall — invoke the **`wix-design-system` skill**, whose bundled helper reads the installed package:

```bash
node <wix-design-system-skill-dir>/scripts/wds.cjs search <keyword>
node <wix-design-system-skill-dir>/scripts/wds.cjs component <Name>
```

**If that skill is not installed** — it is a separate skill, and some hosts ship `wix-app` without
it — do **not** fall through to writing WDS from memory, and do not treat the missing skill as
permission to hand-roll the component. Read the installed package instead, which is where the skill
would have read from anyway:

```bash
ls node_modules/@wix/design-system/dist/types/            # the component inventory
cat node_modules/@wix/design-system/dist/types/<Name>/<Name>.d.ts   # its real props
```

Name the file you read before using the component, exactly as the Component Docs Gate requires for
patterns. A missing skill lowers the convenience, not the bar.

## 3. Custom React — only after both came back empty

Compose from WDS layout primitives (`Box`, `Card`, `Text`). Do not add a third UI dependency, and do not restyle patterns or WDS internals.

## Overlaps and scope

- When both libraries ship the same concept (page header, page container), the **patterns** one wins inside a patterns page — it is the piece wired into the shell's layout and collection state. Use the WDS equivalent only outside a patterns page shell.
- **Patterns has its own overlays.** `PickerModal` / `usePickerModal` and `bulkActionModal` cover collection-related overlays. "It's a modal" is not a reason to leave patterns.
- **Dashboard Plugins** render outside a patterns page shell, so WDS is the default there. Patterns collection components still apply when such a surface displays a data collection.

## Grid cards

**Give each `Grid` card at most two fields: `title` and `subtitle`, returned from `renderItem`, and set `preset="full"`.** The default preset (`title`) does not render a subtitle, and the types still accept one, so without `preset="full"` the second field silently disappears. Keep each field to one line of text. Every card in a grid has the same fixed height, so extra lines render below the card.

## Entity create and edit

**Opening a record listed by a collection page uses an editable `EntityPage` by default, whether the records come from CMS or a vertical SDK.** A request for a table or list is enough; the user does not need to ask for editing separately. The three read-only cases are in [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md#2-choose-then-read-the-chosen-templates-page); a read-only detail page still opens as a route, never a Dashboard Modal or side panel.

**Any create or edit form for a listed record is an `EntityPage`, not a Dashboard Modal.** A create / "add new" form is included: it writes the record, so it is an `EntityPage` even though nothing is being edited yet. "It's a simple data-entry dialog, not an entity edit" is the wrong reading of this rule.

A page that lists nothing — a settings page, an embedded-script config page — carries no `EntityPage` obligation. But "I built the list without `@wix/patterns`" is not an exception: a page that lists records should be a `CollectionPage`.

This is the most common place the selection order gets dropped: the collection gets built correctly with patterns, then the "add item" flow is hand-built as a WDS form in a modal.

**Add `react-router-dom` to the app's `dependencies` before using the entity page template.** The template reads the route id with `useParams` from `react-router-dom`, which `@wix/patterns` declares as an optional peer (`^6 || ^7`; its `useEntityPage.md` imports `useParams` from it), so a fresh app does not have it and `tsc` fails with `TS2307: Cannot find module 'react-router-dom'`.

The documented flow:

1. From the collection page's action cell or primary action, call `navigateToEntityPage({ path, entity })` from `usePatternsNavigate()`. (The patterns docs give this exact use case — "navigate to an entity page on an action cell click on a collection page" — and it renders the entity header immediately, before the fetch resolves.) On the **create** route there is no record to pass: omit `entity` and read the **Create route** section of `<pkgRoot>/dist/docs/useEntityPage.md`, which is what the whole "add new" flow turns on.
2. Register the route with `PatternsReactRoute` inside `PatternsReactRouter`.
3. Follow the selected template's entity hook: for SDK/API data, `useEntityPage({ fetch, onSave })` owns fetching, saving, validation, dirty state, loading skeletons, and error states; for CMS, the schema variant derives reads and writes from the source. Form state comes from `@wix/patterns/form`. Use the chosen template's documented signature, and wire saves to the real source rather than local state or a no-op.
4. Compose the body from `EntityPage.Header`, `EntityPage.MainContent`, `EntityPage.AdditionalContent`, and `EntityPage.Card`. **WDS goes inside those cards** — `FormField`, `Input`, `Text` for the individual fields.

Use a Dashboard Modal for dialogs that neither write nor display a listed record: a delete or discard confirmation, an unsaved-changes prompt, an informational notice, or any dialog on a page that lists nothing. Dialog size and field count are not exceptions — a one-field create form over a listed record is still an `EntityPage`. Reach for a modal because the interaction persists nothing, never because "the form should open in a modal."
