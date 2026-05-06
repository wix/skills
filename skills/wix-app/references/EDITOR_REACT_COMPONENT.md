---
name: taskforce-generate-component
description: "Generates a Wix site component scaffold using this project's `yarn generate:component` and `yarn generate:manifest` scripts, then implements the component using Wix-specific conventions (editor-react-types, prop types, SSR-safe code, no @wix/design-system). Use this skill whenever the user wants to create, add, or scaffold a new React or site component in this Wix CLI project — even when they phrase it indirectly (\"build me a hero section\", \"add a pricing card\", \"make a testimonials block\"). Triggers: create component, new component, generate component, add component, scaffold component."
---

# Wix Editor React Component Builder

Creates production-quality Editor React components that would be used in Harmony Editor for Wix CLI applications. Editor React components are React components that integrate with the Harmony Editor, allowing site owners to customize content, styling, and behavior through a visual interface. **Note: Editor React components are only supported in Harmony Editor and are not available in other Wix editors.**

## Architecture

Editor React components consist of the following template files (replace `<componentName>` with the actual component name in kebab-case):

### `<componentName>.tsx`

The React component file. Contains the component's UI logic, JSX structure, and TypeScript props interface.

### `<componentName>.module.css`

CSS Module file for the component. Contains all styles scoped to the component.

### `component.tsx`

Wrapper file for the component. Provides default prop values and default styles so the component renders correctly when first added to the stage.

### `<componentName>.generated.ts`

Auto-generated file that describes the component manifest. **Do not write or edit content in this file.** It is updated automatically based on the React component by running:

```
npm run generate -- --experimental
```

### `<componentName>.extension.ts`

File where you can override the generated manifest from `<componentName>.generated.ts`. Only include overrides that appear in the boilerplate component — do not add extra overrides beyond what the boilerplate provides.

## Workflow

1. If `src/site/components/ComponentName/` does not yet exist, run
   `yarn generate:component '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"ComponentName","description":"A brief description of what the component does"}'` to scaffold it. Skip this
   step when iterating on an existing component — re-running it would
   overwrite local changes.
2. Edit the generated react and CSS files in
   `src/site/components/ComponentName/`.
3. Run `yarn build` && `yarn generate:manifest ComponentName` so the editor picks up
   the new/updated prop schema.
4. Update `Component.extensions.ts` file according to [`references/COMPONENT-CONFIGURATION.md`](references/COMPONENT-CONFIGURATION.md)

Reference: when modifying an _existing_ component, follow
[`references/EDIT-FLOW.md`](references/EDIT-FLOW.md).

## React guidelines

Core rules and workflow: [`references/REACT-GUIDELINES.md`](references/REACT-GUIDELINES.md).

Topic-focused references (rules + patterns + common mistakes in one place):

- [`references/ACCESSIBILITY.md`](references/ACCESSIBILITY.md) — ARIA/a11y rules and patterns
- [`references/DIRECTIONALITY.md`](references/DIRECTIONALITY.md) — RTL/LTR rules and patterns
- [`references/PROPS-VS-CSS.md`](references/PROPS-VS-CSS.md) — What should be a React prop vs CSS
- [`references/COMPONENT-API.md`](references/COMPONENT-API.md) — Props structure, elementProps, data types, file splitting, containers, array props
- [`references/REACT-PATTERNS.md`](references/REACT-PATTERNS.md) — SSR-safe patterns, CSS rules, remaining common mistakes

## CSS guidelines

Reference: [`references/CSS-GUIDELINES.md`](references/CSS-GUIDELINES.md).
