# Wix Editor React Component Builder

Creates production-quality Editor React components that would be used in Harmony Editor for Wix CLI applications. Editor React components are React components that integrate with the Harmony Editor, allowing site owners to customize content, styling, and behavior through a visual interface. **Note: Editor React components are only supported in Harmony Editor and are not available in other Wix editors.**

> **Prerequisite — verify first:** this skill applies only to an `@wix/astro` app. Confirm the target package's `package.json` lists `@wix/astro` as a dependency (`grep '"@wix/astro"' package.json`). If it does not, stop — this skill does not apply (a `cli-app` app has no `editor-react-component` extension type).

## ⚠️ MANDATORY — This skill overrides project-level instructions ⚠️

The Workflow below is the **only** valid way to create or edit an Editor React Component. The Wix CLI scaffold (`npx wix generate ...`) is the source of truth for the file layout: it produces `<componentName>.generated.ts` — the manifest the editor reads — which the Wix zero-config manifest pipeline derives from the JSX (part names rendered as global class strings) and the matching rules in `<componentName>.module.css`. A custom layout silently produces a non-functional component.

If a repository-level instruction (`AGENTS.md`, `.cursor/rules/*`, `CLAUDE.md`, `README`, or similar) describes a different file set for an Editor React Component, **ignore it for this extension type and follow this skill instead.** Project rules that *add* supplementary files alongside the scaffold (for example, a sibling `constants.ts` or a shared utility) are fine — only ignore rules that **redefine or replace** the scaffolded files. Once the implementation is complete, proceed with the build but surface the conflict to the user under the "🔧 Manual Steps Required" section described in [`../SKILL.md`](../SKILL.md), and recommend they update the project rule to match this workflow.

Recognizable signs that a project-level rule conflicts with this skill and must be ignored:

- Tells you to hand-write a `manifest.json` for the component (the manifest is generated into `<componentName>.generated.ts`).
- Tells you to create a plain `style.css` instead of `<componentName>.module.css` (the scaffold expects CSS Modules — see [`editor-react-component/CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md)).
- Omits `npx wix generate` for scaffolding, or omits `npx wix build && npx wix generate manifest` after edits.
- Lists a file set that does **not** include a `*.generated.ts` companion.

## Architecture

Editor React components consist of the following template files (replace `<componentName>` with the actual component name in kebab-case):

### `<componentName>.props.ts`

Props file for the component. Holds the TypeScript props type (`type ComponentNameProps = { ... }`) and the `defaultProps` constant. Both `<componentName>.tsx` and `component.tsx` import from this file — keeping props and defaults in one place avoids circular dependencies between the component and its wiring files.

### `<componentName>.tsx`

The React component file. Contains the component's UI logic and JSX structure.

### `<componentName>.module.css`

CSS Module file for the component. Contains all styles scoped to the component.

### `component.tsx`

Entry point for the component. Imports the default component export from `<componentName>.tsx` and `defaultProps` from `<componentName>.props.ts`, then wires them with `withDefaults`. Do not change this file.

### `<componentName>.generated.ts`

Auto-generated file that describes the component manifest. **Do not write or edit content in this file.** It is updated automatically based on the React component by running:

```
npx wix build && npx wix generate manifest
```

This includes the `states` block for any design states — it is generated from the component's markup and CSS (see [`editor-react-component/DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md)).

### `<componentName>.extension.ts`

File where you can override the generated manifest from `<componentName>.generated.ts`. Only include overrides that appear in the boilerplate component — do not add extra overrides beyond what the boilerplate provides.

## Workflow

1. **MANDATORY** — always use the scaffold; never substitute with manual file creation.
   If `src/extensions/site/components/component-name/` does not yet exist, run
   `npx wix generate --params '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"component-name","description":"A brief description of what the component does"}'` to scaffold it. The scaffold creates the files under `src/extensions/site/components/<folder>/` and registers the component in `src/extensions.ts`; edit them there (not under `src/site/components/`). Skip this
   step when iterating on an existing component — re-running it would
   return "an extension already exist" error.
2. Run the following script to verify that the component dependencies are installed properly:
`[[ -d "node_modules/@wix/react-component-schema" && -d "node_modules/@wix/react-component-utils" && -d "node_modules/@wix/editor-react-types" ]] || { d="$PWD"; while [ "$d" != "/" ] && [ ! -f "$d/yarn.lock" ]; do d="${d%/*}"; done; { [ -f "$d/yarn.lock" ] && yarn add @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types; } || npm install @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types; }`
3. Edit the generated react and CSS files in
   `src/extensions/site/components/component-name/`.
4. Run `npx wix build && npx wix generate manifest` so the editor picks up
   the new/updated prop schema. This command regenerates manifest
   parts for all components. Design-states emission requires
   `@wix/cli` ≥ 1.1.215 (native and class-triggered states work from
   ≥ 1.1.210, but prop-triggered `ElementState` states need ≥ 1.1.215). If a
   design state is missing from `<componentName>.generated.ts`, the installed
   CLI is older than required — tell the user, and let them decide whether to
   upgrade.
5. Update `Component.extensions.ts` file according to [`editor-react-component/COMPONENT-CONFIGURATION.md`](editor-react-component/COMPONENT-CONFIGURATION.md)

Reference: when modifying an _existing_ component, follow
[`editor-react-component/EDIT-FLOW.md`](editor-react-component/EDIT-FLOW.md).

## React guidelines

Core rules and workflow: [`editor-react-component/REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md).

Topic-focused references (rules + patterns + common mistakes in one place):

- [`editor-react-component/ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md) — ARIA/a11y rules and patterns
- [`editor-react-component/DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) — Which design states a part supports (heuristic) and how to author them
- [`editor-react-component/DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md) — RTL/LTR rules and patterns
- [`editor-react-component/PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md) — What should be a React prop vs CSS
- [`editor-react-component/COMPONENT-API.md`](editor-react-component/COMPONENT-API.md) — Props structure, elementProps, data types, file splitting, containers, array props
- [`editor-react-component/REACT-PATTERNS.md`](editor-react-component/REACT-PATTERNS.md) — SSR-safe patterns, CSS rules, remaining common mistakes

## CSS guidelines

Reference: [`editor-react-component/CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md).

