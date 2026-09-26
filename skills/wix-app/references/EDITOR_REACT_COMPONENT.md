# Wix Editor React Component Builder

Build Editor React Components for Harmony/Studio2 Wix CLI apps only. First
determine **create vs edit**; for edits, inspect the existing component and
never re-scaffold.

## File Contract

Keep the Wix CLI scaffold and these file responsibilities:

| File | Ownership | Purpose |
| --- | --- | --- |
| `<component-name>.props.ts` | Edit | Props type + `defaultProps` |
| `<component-name>.tsx` | Edit | Component UI and behavior |
| `<component-name>.module.css` | Edit | Scoped component styles |
| `component.tsx` | Keep generated | Wire component and `defaultProps` with `withDefaults` |
| `component.preview.tsx` | Edit narrowly | Sync preview adapter, one crucial data field, root class |
| `<component-name>.generated.ts` | NEVER edit | Generated manifest — do not edit |
| `<component-name>.extension.ts` | Edit narrowly | Supported partial manifest overrides |

Supplementary files are allowed; keep scaffold roles intact.

## Workflow

1. **Scaffold only when creating.** If the component folder does not exist, run
   inside the Wix app project (the folder with `wix.config.json`):

   ```bash
   npx wix generate --params '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"component-name","description":"A brief description"}'
   ```

   This creates and registers the component. Never rerun it for an existing one.

2. **Run the dependency preflight.** Verify that all component creation and
   accessibility-review dependencies are installed:

   ```bash
   node -e "const fs=require('fs'),path=require('path'),ps=['@wix/react-component-schema','@wix/react-component-utils','@wix/editor-react-types','@babel/parser','@babel/traverse','@babel/types','eslint','eslint-plugin-jsx-a11y','@typescript-eslint/parser','typescript','@types/eslint-plugin-jsx-a11y','jsdom','axe-core'];const missing=ps.filter(p=>!(require.resolve.paths(p)||[]).some(d=>fs.existsSync(path.join(d,p,'package.json'))));if(missing.length){console.error('Missing dependencies: '+missing.join(', '));process.exit(1)}" || { d="$PWD"; while [ "$d" != "/" ] && [ ! -f "$d/yarn.lock" ]; do d="${d%/*}"; done; if [ -f "$d/yarn.lock" ]; then yarn add @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types && yarn add -D @babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y jsdom axe-core; else npm install @wix/react-component-schema @wix/react-component-utils @wix/editor-react-types && npm install --save-dev @babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y jsdom axe-core; fi; }
   ```

3. **Plan.** Identify props, semantic root, named parts, and design states; read
   the routed references before writing code.

4. **Implement.** Keep props, logic, and styles in their scaffolded editable
   files. Never edit `*.generated.ts`.

5. **Run the accessibility review.** Once the JSX is complete, run from the
   same folder (`<SKILL_ROOT>` is the directory containing the active `SKILL.md`):

   ```bash
   node <SKILL_ROOT>/scripts/scan-a11y-review.cjs src/extensions/site/components/<component-name>
   ```

   Follow [`editor-react-component/ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md); fix and
   rerun at most twice, then report remaining findings.

6. **Configure the editor extension.** For creation or a requested sizing,
   installation, or manifest change, apply
   [`editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md)
   to the extension; otherwise leave it unchanged. Synchronize preview
   `requiredDataFields` and `rootClassName`.

7. **Generate and validate.** Run:

   ```bash
   npx wix build && npx wix generate manifest
   npx tsc --noEmit
   ```

   Run relevant tests/lint. Inspect the manifest; never hand-repair it. Diagnose
   failures with
   [`editor-react-component/MANIFEST-ERRORS.md`](editor-react-component/MANIFEST-ERRORS.md).

   For creation/layout changes, complete the routed overflow resize review.

8. **Report.** Summarize files, checks, blockers, and checks that could not run.

## Reference Policy

Read only matching required and triggered optional rows. References refine the
active step. Preserve unrelated existing behavior; never re-scaffold or edit a
generated manifest. `SKILL.md` is the only router; references are leaves.

### Required References

| Scope | Required references |
| --- | --- |
| Creating a component | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md), [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md), [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |
| Editing React or JSX | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md) |
| Changing public contract, semantic root, or named parts | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md) |
| Changing public data props or elected root global class | [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| Item array where only one body is visible | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Creating or changing CSS | [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md) |
| Creating or changing layout/content | [`OVERFLOW.md`](editor-react-component/OVERFLOW.md) |
| Root direction contract, direction-sensitive behavior, or `ReactNode` slot | [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md) |
| Sizing, installation, or manifest overrides | [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |

### Optional References

| Trigger | Read |
| --- | --- |
| Interactive/selectable part or custom state | [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Creating interactive components or changing interactions/callbacks | [`FUNCTION-HANDLERS.md`](editor-react-component/FUNCTION-HANDLERS.md) |
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
- Accessibility per part, per [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md):
  read only `a11y.ariaLabel`, and only for a control without a visible name;
  never spread the `a11y` object or add one-off ARIA props.
- Named parts: global class, module class, and `elementProps` (root uses
  top-level props).
- Native design states: pair selectors with injected modifiers; keep non-input
  `:focus-visible` standalone unless editable focus is requested; toggle custom
  state classes from data.
- Single-visible-body arrays: `name` per item, `ActiveItemIndex<'prop'>`, render
  all bodies, hide inactive accessibly.
- Autoplay/loop: play/pause control, honor reduced motion, suppress autoplay in
  editor design mode.
- Resizable layout: required content stays usable at 320px. Reflow a requested
  visible group inside its page; never squeeze fixed columns or clip at root.
  Cap track minima with `minmax(min(100%, <minimum>), 1fr)`. A non-scroll
  descendant over 1px wider than its client fails. Follow
  [`OVERFLOW.md`](editor-react-component/OVERFLOW.md).
- Preview composition, inline or through variables:
  `withDefaults(withFallbackPlaceholder(PreviewOrComponent, options), defaultProps)`.
  Keep `withDefaults` outermost; use one crucial data field and match the root
  class.
