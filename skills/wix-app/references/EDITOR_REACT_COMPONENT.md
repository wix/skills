# Wix Editor React Component Builder

Build Editor React Components for Harmony/Studio2 Wix CLI apps only. First
determine **create vs edit**; for edits, inspect the existing component and
never re-scaffold.

## File Contract

Use the Wix CLI scaffold as the source of truth. Do not replace it with a custom
layout or a hand-written manifest. Preserve these file responsibilities:

| File | Ownership | Purpose |
| --- | --- | --- |
| `<component-name>.props.ts` | Edit | Props type + `defaultProps` |
| `<component-name>.tsx` | Edit | Component UI and behavior |
| `<component-name>.module.css` | Edit | Scoped component styles |
| `component.tsx` | Keep generated | Wire component and `defaultProps` with `withDefaults` |
| `component.preview.tsx` | Edit narrowly | Sync preview adapter, one crucial data field, root class |
| `<component-name>.generated.ts` | NEVER edit | Generated manifest — do not edit |
| `<component-name>.extension.ts` | Edit narrowly | Supported partial manifest overrides |

Supplementary files (constants, hooks, sub-components) are allowed; keep scaffold
roles intact.

## Workflow

1. **Scaffold only when creating.** If the component folder does not exist, run:

   ```bash
   npx wix generate --params '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"component-name","description":"A brief description"}'
   ```

   Creates `src/extensions/site/components/<component-name>/` and registers the
   extension in `src/extensions.ts`. Do not rerun for an existing component.

2. **Run the dependency preflight.** Verify that all component creation and
   accessibility-review dependencies are installed:

   ```bash
   node -e "const fs=require('fs'),path=require('path'),ps=['@wix/react-component-schema','@wix/react-component-utils','@wix/editor-react-types','@babel/parser','@babel/traverse','@babel/types','eslint','eslint-plugin-jsx-a11y','@typescript-eslint/parser','typescript','@types/eslint-plugin-jsx-a11y'];const missing=ps.filter(p=>!(require.resolve.paths(p)||[]).some(d=>fs.existsSync(path.join(d,p,'package.json'))));if(missing.length){console.error('Missing dependencies: '+missing.join(', '));process.exit(1)}" || { d="$PWD"; while [ "$d" != "/" ] && [ ! -f "$d/yarn.lock" ]; do d="${d%/*}"; done; if [ -f "$d/yarn.lock" ]; then yarn add @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types && yarn add -D @babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y; else npm install @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types && npm install --save-dev @babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y; fi; }
   ```

3. **Plan the contract and structure.** Identify props, semantic root, named
   parts, and design states; read routed references below before writing code.

4. **Implement the editable sources.** Preserve the scaffold contract: props in
   the props file, logic in TSX, styles in the CSS Module. Do not edit
   `*.generated.ts`.

5. **Run the accessibility review.** Follow
   [`editor-react-component/ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md): run scanners,
   triage output, complete the manual checklist, fix issues, rerun on changed
   JSX.

6. **Configure the editor extension when required.** For a new component or a
   requested sizing, installation, or manifest change, apply
   [`editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md)
   to `<component-name>.extension.ts`. Otherwise leave the file unchanged.
   Synchronize `requiredDataFields` and `rootClassName` in
   `component.preview.tsx`.

7. **Generate and validate.** Run:

   ```bash
   npx wix build && npx wix generate manifest
   npx tsc --noEmit -p .
   ```

   Run relevant tests and lint when available. Inspect the regenerated manifest;
   never repair it by hand. On failure, diagnose with
   [`editor-react-component/MANIFEST-ERRORS.md`](editor-react-component/MANIFEST-ERRORS.md).

8. **Report the result.** Summarize edited files and checks. Call out any
   unresolved conflict, missing dependency, unsupported CLI version, or check
   that could not run.

## Reference Policy

- Read **only** matching required + triggered optional rows; optional triggers
  become required when they match.
- References refine the active step; they do not restart workflow or expand scope.
- Never re-scaffold an existing component or edit `*.generated.ts`.

`SKILL.md` is the only reference router; reference files are self-contained
leaves. For existing components, preserve out-of-scope public props, styling,
extension configuration, and supporting files.

### Required References

| Scope | Required references |
| --- | --- |
| Creating a component | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md), [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md), [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |
| Editing React or JSX | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md) |
| Changing public contract, semantic root, or named parts | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md) |
| Changing public data props or elected root global class | [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| Item array where only one body is visible | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Creating or changing CSS | [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md) |
| Root direction contract, direction-sensitive behavior, or `ReactNode` slot | [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md) |
| Sizing, installation, or manifest overrides | [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |

### Optional References

| Trigger | Read |
| --- | --- |
| Interactive/selectable part or custom state | [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Public event callbacks added or changed | [`FUNCTION-HANDLERS.md`](editor-react-component/FUNCTION-HANDLERS.md) |
| Browser APIs, effects, or time-dependent output | [`SSR.md`](editor-react-component/SSR.md) |
| Non-established CSS feature or DOM API, or user asks for one by name | [`BROWSER-SUPPORT.md`](editor-react-component/BROWSER-SUPPORT.md) |
| `npx wix build` or manifest generation exits with an error | [`MANIFEST-ERRORS.md`](editor-react-component/MANIFEST-ERRORS.md) |
| Animation, video, carousel, or other playable/looped/autoplaying content | [`ANIMATED-COMPONENTS.md`](editor-react-component/ANIMATED-COMPONENTS.md), [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| Site/runtime/editor context hooks needed | [`SITE-CONTEXT-HOOKS.md`](editor-react-component/SITE-CONTEXT-HOOKS.md) (+ [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) when design-mode behavior differs) |
| Branded, themed, or brand-aware component requested | [`BRANDED-COMPONENTS.md`](editor-react-component/BRANDED-COMPONENTS.md) |

## Non-Negotiables

- React 18 only; do not assume React 19 runtime features.
- Include typed `id`, `className`, `direction`, and `a11y` support.
- Elected root: `dir={direction}`, fallback-direction class, logical CSS for
  direction-sensitive layout.
- Deterministic render; no browser globals during render.
- Explicit foreground colors need a known contrasting background; transparent
  roots inherit from the host.
- Baseline Widely Available CSS/DOM only, or supported fallbacks.
- Route ARIA through `a11y`; no one-off ARIA props.
- Named parts: global class, module class, and `elementProps` (root uses
  top-level props).
- Native design states: pair selectors with injected modifiers; keep non-input
  `:focus-visible` standalone unless editable focus is requested; toggle custom
  state classes from data.
- Single-visible-body arrays: `name` per item, `ActiveItemIndex<'prop'>`, render
  all bodies, hide inactive accessibly.
- Autoplay/loop: play/pause control, honor reduced motion, suppress autoplay in
  editor design mode.
- `component.preview.tsx`: keep `withDefaults` and `withFallbackPlaceholder`,
  wrap the preview adapter when present, one crucial `requiredDataFields`
  entry, and `rootClassName` matching the root global class.
