# Wix Editor React Component Builder

Build Editor React Components for Harmony Editor and Studio2 in Wix CLI
applications. These components are not supported in other Wix editors.

## Before You Start

Determine whether the request creates a component or edits an existing one.
Inspect the existing component before changing it.

## File Contract

Use the Wix CLI scaffold as the source of truth. Do not replace it with a custom
layout or a hand-written manifest. After applying this workflow, preserve these
file responsibilities:

| File | Ownership | Purpose |
| --- | --- | --- |
| `<component-name>.props.ts` | Edit | Export the props type and `defaultProps` from one shared source. |
| `<component-name>.tsx` | Edit | Implement the component UI and behavior. |
| `<component-name>.module.css` | Edit | Define scoped component styles. |
| `component.tsx` | Keep generated | Wire the component and `defaultProps` with `withDefaults`. |
| `component.preview.tsx` | Usually keep generated | Customize only for editor-specific behavior, such as suppressing autoplay. |
| `<component-name>.generated.ts` | NEVER edit | Generated manifest consumed by the editor. |
| `<component-name>.extension.ts` | Edit narrowly | Apply supported partial manifest overrides. |

Supplementary files such as `constants.ts`, hooks, or internal sub-components
are allowed when the implementation needs them. Keep the scaffolded files and
their responsibilities intact.

## Workflow

1. **Scaffold only when creating.** If the component folder does not exist, run:

   ```bash
   npx wix generate --params '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"component-name","description":"A brief description"}'
   ```

   The command creates `src/extensions/site/components/<component-name>/` and
   registers the extension in `src/extensions.ts`. Do not rerun it for an
   existing component.

2. **Run the dependency preflight.** Verify that all component creation and
   accessibility-review dependencies are installed:

   ```bash
   node -e "const fs=require('fs'),path=require('path'),ps=['@wix/react-component-schema','@wix/react-component-utils','@wix/editor-react-types','@babel/parser','@babel/traverse','@babel/types','eslint','eslint-plugin-jsx-a11y','@typescript-eslint/parser','typescript','@types/eslint-plugin-jsx-a11y'];const missing=ps.filter(p=>!(require.resolve.paths(p)||[]).some(d=>fs.existsSync(path.join(d,p,'package.json'))));if(missing.length){console.error('Missing dependencies: '+missing.join(', '));process.exit(1)}" || { d="$PWD"; while [ "$d" != "/" ] && [ ! -f "$d/yarn.lock" ]; do d="${d%/*}"; done; if [ -f "$d/yarn.lock" ]; then yarn add @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types && yarn add -D @babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y; else npm install @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types && npm install --save-dev @babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y; fi; }
   ```

3. **Plan the contract and structure.** Identify content and behavior props,
   elect the semantic root, identify named inner parts, and decide which design
   states each part supports. Read the relevant references from the routing
   table below before writing code.

4. **Implement the editable sources.** Preserve the scaffold contract. Keep
   props/defaults in the props file, component logic in the main TSX file, and
   static styling in the CSS Module. Do not edit `*.generated.ts`.

5. **Run the accessibility review.** Follow
   [`editor-react-component/ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md): run both bundled
   scanners, triage their output, complete the manual semantic checklist, fix
   confirmed issues, and rerun the scanners on changed JSX files.

6. **Configure the editor extension when required.** For a new component or a
   requested sizing, installation, or manifest change, apply
   [`editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md)
   to `<component-name>.extension.ts`. Otherwise preserve the existing file.

7. **Generate and validate.** Run:

   ```bash
   npx wix build && npx wix generate manifest
   npx tsc --noEmit
   ```

   Run relevant project tests and lint commands when available. Inspect the
   regenerated manifest; never repair it by hand. Design-state generation needs
   `@wix/cli` 1.1.210 or newer, and prop-triggered `ElementState` generation
   needs 1.1.215 or newer. If expected states are absent on an older CLI, report
   the version constraint and let the user decide whether to upgrade. If the
   build or manifest command exits with an error, diagnose it with
   [`editor-react-component/MANIFEST-ERRORS.md`](editor-react-component/MANIFEST-ERRORS.md), apply the
   matching fix, and rerun both commands.

8. **Report the result.** Summarize edited files and checks. Call out any
   unresolved instruction conflict, missing dependency, unsupported CLI
   version, or check that could not run.

## Reference Policy

Read every reference required for the current scope. Read an optional reference
only when its trigger applies; when it does, that reference becomes required.
Apply every matching row; do not load the entire reference set by default.

References refine the active workflow step; they do not restart the workflow or
expand the user's requested scope. `SKILL.md` is the only reference router;
reference files are self-contained leaves and do not route to other references.
For an existing component, preserve out-of-scope public props, styling,
extension configuration, and supporting files. Never re-scaffold an existing
component or edit `*.generated.ts` as a reference-driven fix.

### Required References

| Scope | Required references |
| --- | --- |
| Creating a component | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md), [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), and [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |
| Editing React or JSX | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md) and [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md) |
| Changing the public contract, semantic root, or named parts | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), and [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md) |
| Creating or changing an item array where only one body is visible | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), and [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Creating or changing CSS | [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md) |
| Changing the root direction contract, direction-sensitive behavior, or a `ReactNode` slot | [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md) |
| Changing sizing, installation, or manifest overrides | [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |

### Optional References

| Trigger | Read |
| --- | --- |
| An interactive or selectable part is created or changed—for example a button, link, input, tab, accordion trigger, or carousel control—or a custom state is added | [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Public event callbacks are added or changed | [`FUNCTION-HANDLERS.md`](editor-react-component/FUNCTION-HANDLERS.md) |
| Browser APIs, effects, or time-dependent output are introduced | [`SSR.md`](editor-react-component/SSR.md) |
| `npx wix build` or manifest generation exits with an error | [`MANIFEST-ERRORS.md`](editor-react-component/MANIFEST-ERRORS.md) |
| Primary content is playable, looped, or autoplaying | [`ANIMATED-COMPONENTS.md`](editor-react-component/ANIMATED-COMPONENTS.md) and [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| Runtime site pages, URLs, JavaScript direction, or reduced-motion context is needed | [`SITE-CONTEXT-HOOKS.md`](editor-react-component/SITE-CONTEXT-HOOKS.md) |
| Non-animation behavior must differ in editor design mode | [`SITE-CONTEXT-HOOKS.md`](editor-react-component/SITE-CONTEXT-HOOKS.md) and [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| The prompt explicitly requests a branded, themed, or brand-aware component | [`BRANDED-COMPONENTS.md`](editor-react-component/BRANDED-COMPONENTS.md) |

## Core Invariants

- Use React 18-compatible APIs; do not assume React 19 runtime features.
- Include typed `id`, `className`, `direction`, and `a11y` support.
- Apply `dir={direction}` and the unconditional fallback-direction class to the
  elected root. Use logical CSS properties for direction-sensitive layout.
- Keep render output deterministic and avoid browser globals during render.
- Route ARIA through the typed `a11y` contract; do not add one-off ARIA props.
- Give every named inner part a global class, a CSS Module class, and a matching
  `elementProps` entry. The elected root uses top-level props instead.
- Pair each eligible native editor design-state selector with its
  editor-injected global modifier. Keep a non-input control's keyboard-only
  `:focus-visible` indicator standalone unless editable focus styling is
  explicitly requested. Toggle custom global state classes from data.
- For an item array where only one body is visible, give every item a `name`,
  use `ActiveItemIndex<'arrayPropName'>`, render every body, and hide inactive
  bodies accessibly.
- If primary content autoplays or loops, provide an accessible play/pause
  control, honor reduced motion, and suppress autoplay in editor design mode.
