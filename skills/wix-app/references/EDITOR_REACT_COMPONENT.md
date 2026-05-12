# Wix Editor React Component Builder

Creates production-quality Editor React components that would be used in Harmony Editor for Wix CLI applications. Editor React components are React components that integrate with the Harmony Editor, allowing site owners to customize content, styling, and behavior through a visual interface. **Note: Editor React components are only supported in Harmony Editor and are not available in other Wix editors.**

## Architecture

Editor React components consist of the following template files (replace `<componentName>` with the actual component name in kebab-case):

### `<componentName>.tsx`

The React component file. Contains the component's UI logic, JSX structure, and TypeScript props interface.

### `<componentName>.module.css`

CSS Module file for the component. Contains all styles scoped to the component.

### `component.tsx`

Entry point for the component. Imports the default prop values defined in `<componentName>.tsx` and wires them up so the component renders correctly when first added to the stage.

### `<componentName>.generated.ts`

Auto-generated file that describes the component manifest. **Do not write or edit content in this file.** It is updated automatically based on the React component by running:

```
npx wix build && npx wix generate manifest
```

### `<componentName>.extension.ts`

File where you can override the generated manifest from `<componentName>.generated.ts`. Only include overrides that appear in the boilerplate component — do not add extra overrides beyond what the boilerplate provides.

## Workflow

1. If `src/site/components/component-name/` does not yet exist, run
   `npx wix generate --params '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"component-name","description":"A brief description of what the component does"}'` to scaffold it. Skip this
   step when iterating on an existing component — re-running it would
   return "an extension already exist" error.
2. Run the following script to verify that the component dependencies are installed properly:
`[[ -d "node_modules/@wix/react-component-schema" && -d "node_modules/@wix/react-component-utils" && -d "node_modules/@wix/editor-react-types" ]] || ([ -f yarn.lock ] && yarn add @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types || npm install @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types)`
3. Edit the generated react and CSS files in
   `src/site/components/ComponentName/`.
4. Run `npx wix build && npx wix generate manifest` so the editor picks up
   the new/updated prop schema. This command regenerates manifest
   parts for all components.
5. Update `Component.extensions.ts` file according to [`editor-react-component/COMPONENT-CONFIGURATION.md`](editor-react-component/COMPONENT-CONFIGURATION.md)

Reference: when modifying an _existing_ component, follow
[`editor-react-component/EDIT-FLOW.md`](editor-react-component/EDIT-FLOW.md).

## React guidelines

Core rules and workflow: [`editor-react-component/REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md).

Topic-focused references (rules + patterns + common mistakes in one place):

- [`editor-react-component/ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md) — ARIA/a11y rules and patterns
- [`editor-react-component/DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md) — RTL/LTR rules and patterns
- [`editor-react-component/PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md) — What should be a React prop vs CSS
- [`editor-react-component/COMPONENT-API.md`](editor-react-component/COMPONENT-API.md) — Props structure, elementProps, data types, file splitting, containers, array props
- [`editor-react-component/REACT-PATTERNS.md`](editor-react-component/REACT-PATTERNS.md) — SSR-safe patterns, CSS rules, remaining common mistakes

## CSS guidelines

Reference: [`editor-react-component/CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md).
