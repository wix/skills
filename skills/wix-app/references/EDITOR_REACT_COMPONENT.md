# Wix Editor React Component Builder

For Harmony/Studio2 Wix CLI apps. Decide create vs edit; inspect before edits.
New components use supplied code/designs, or the site theme when the request or
the host's rules ask for it; honor scoped styling. Brik tool imports keep the
`wix-brik` skill's styling.

## File Contract

| File | Ownership | Purpose |
| --- | --- | --- |
| `<component-name>.props.ts` | Edit | Props type + `defaultProps` |
| `<component-name>.tsx` | Edit | Component UI and behavior |
| `<component-name>.module.css` | Edit | Scoped component styles |
| `component.tsx` | Keep generated | Wire component and `defaultProps` with `withDefaults` |
| `component.preview.tsx` | Edit narrowly | Sync preview adapter, one crucial data field, root class |
| `<component-name>.generated.ts` | NEVER edit | Generated manifest |
| `<component-name>.extension.ts` | Edit narrowly | Supported partial manifest overrides |

## Required Reading

Read every matched reference in full before coding. Open paths directly;
no skim or grep. Unopened references fail.

| Scope | References |
| --- | --- |
| Creating (untouched scaffolds included) | [`BRANDED-COMPONENTS.md`](editor-react-component/BRANDED-COMPONENTS.md) when the request or host rules ask for the theme; then [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |
| Writing or porting a view | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`PARTS.md`](editor-react-component/PARTS.md), [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md), [`VISUAL-QUALITY.md`](editor-react-component/VISUAL-QUALITY.md), [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md), [`OVERFLOW.md`](editor-react-component/OVERFLOW.md), [`FUNCTION-HANDLERS.md`](editor-react-component/FUNCTION-HANDLERS.md), [`DEFAULT-IMAGES.md`](editor-react-component/DEFAULT-IMAGES.md) |
| Editing React or JSX | [`REACT-GUIDELINES.md`](editor-react-component/REACT-GUIDELINES.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md) |
| Public contract, semantic root, or named parts | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PARTS.md`](editor-react-component/PARTS.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md) |
| Public data props or elected root global class | [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| Item array where only one body is visible | [`COMPONENT-CONTRACT.md`](editor-react-component/COMPONENT-CONTRACT.md), [`PROPS-VS-CSS.md`](editor-react-component/PROPS-VS-CSS.md), [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md), [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| CSS | [`CSS-GUIDELINES.md`](editor-react-component/CSS-GUIDELINES.md), [`VISUAL-QUALITY.md`](editor-react-component/VISUAL-QUALITY.md) |
| Layout/content | [`OVERFLOW.md`](editor-react-component/OVERFLOW.md) |
| Interactions/callbacks | [`FUNCTION-HANDLERS.md`](editor-react-component/FUNCTION-HANDLERS.md) |
| Root direction contract, direction-sensitive behavior, or `ReactNode` slot | [`DIRECTIONALITY.md`](editor-react-component/DIRECTIONALITY.md) |
| Sizing, installation, or manifest overrides | [`EDITOR-EXTENSION-CONFIGURATION.md`](editor-react-component/EDITOR-EXTENSION-CONFIGURATION.md) |

## Workflow

1. **Scaffold new components if missing.** An untouched scaffold skips only
   this step. Run in the Wix app (`wix.config.json`).
   Check this directory, then the workspace; never search the OS:

   ```bash
   npx wix generate --params '{"extensionType":"EDITOR_REACT_COMPONENT","name":"ComponentName","folder":"component-name","description":"What visitors see and can do"}'
   ```

   Describe the UI, use cases and tradeoffs
   in 1–2 sentences (≤300 chars); omit names and implementation details.

2. **Run the dependency preflight.**

   ```bash
   deps=(@wix/react-component-schema @wix/react-component-utils @wix/editor-react-types clsx deepmerge-ts)
   dev=(@babel/parser @babel/traverse @babel/types eslint eslint-plugin-jsx-a11y @typescript-eslint/parser 'typescript@<7' @types/eslint-plugin-jsx-a11y jsdom axe-core)

   node - "${deps[@]}" "${dev[@]}" <<'JS' || {
   const fs = require('fs'), path = require('path');
   const missing = process.argv.slice(2)
     .map(p => p.replace(/@<7$/, ''))
     .filter(p => !require.resolve.paths(p)?.some(d => fs.existsSync(path.join(d, p, 'package.json'))));
   try { require.resolve('@wix/react-component-schema/theme-variables.module.css'); }
   catch { missing.push('schema theme export'); }
   if (missing.length) {
     console.error(`Missing or incompatible: ${missing.join(', ')}`);
     process.exit(1);
   }
   JS
     d="$PWD"
     while [[ "$d" != / && ! -f "$d/yarn.lock" ]]; do d="$(dirname "$d")"; done
     if [[ -f "$d/yarn.lock" ]]; then install=(yarn add); else install=(npm install); fi
     "${install[@]}" "${deps[@]}" && "${install[@]}" -D "${dev[@]}"
   }
   ```

3. **Plan.** Identify props, root, parts and states. Read package types only
   for undocumented APIs or type errors.

4. **Implement.** Format edited source files with the app's formatter. Never edit or format `*.generated.ts`.

5. **Check accessibility (mandatory).** After JSX, run from the app root
   (`<SKILL_ROOT>` holds `SKILL.md`):

   ```bash
   node <SKILL_ROOT>/scripts/scan-a11y-review.cjs src/extensions/site/components/<component-name>
   ```

   Follow `ACCESSIBILITY.md`; fix and rerun at most twice; report remaining
   findings.

6. **Configure the editor extension.** For creation or a requested sizing,
   installation, or manifest change, apply `EDITOR-EXTENSION-CONFIGURATION.md`
   to the extension; otherwise leave it unchanged. Synchronize preview
   `requiredDataFields` and `rootClassName`.

7. **Generate and validate.** Batch implementation edits, then build and
   generate the manifest once:

   ```bash
   npx wix build && npx wix generate manifest
   ```

   Run `npx tsc --noEmit` and relevant tests/lint; after any later source
   edit, rebuild and regenerate the manifest, then rerun affected checks.
   Inspect the manifest; never hand-repair it.

   For creation/layout changes, run the overflow resize review.

8. **Report.** Summarize files, checks, blockers and skipped checks.
   List references read; finish unread ones.

## Reference Policy

Read optional references on trigger. Preserve unrelated behavior. References
are leaves.

### Optional References

| Trigger | Read |
| --- | --- |
| Supplied code, designs or images | [`USER-SOURCES.md`](editor-react-component/USER-SOURCES.md) |
| Interactive/selectable part, custom state, or open/reveal toggle | [`DESIGN-STATES.md`](editor-react-component/DESIGN-STATES.md) |
| Disabled or invalid state | [`DISABLED-INVALID.md`](editor-react-component/DISABLED-INVALID.md) |
| Browser APIs, effects, or time-dependent output | [`SSR.md`](editor-react-component/SSR.md) |
| Non-established CSS feature or DOM API, or user asks for one by name | [`BROWSER-SUPPORT.md`](editor-react-component/BROWSER-SUPPORT.md) |
| `npx wix build` or manifest generation errors or warns | [`MANIFEST-ERRORS.md`](editor-react-component/MANIFEST-ERRORS.md) |
| Animation, video, carousel, or other playable/looped/autoplaying content | [`ANIMATED-COMPONENTS.md`](editor-react-component/ANIMATED-COMPONENTS.md), [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) |
| Site/runtime/editor context hooks needed | [`SITE-CONTEXT-HOOKS.md`](editor-react-component/SITE-CONTEXT-HOOKS.md) (+ [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md) when design-mode behavior differs) |
| Editing themed styling, or a requested own look | [`BRANDED-COMPONENTS.md`](editor-react-component/BRANDED-COMPONENTS.md) |
| Owner-replaceable icon/SVG (not fixed UI glyphs) | [`VECTOR-ART.md`](editor-react-component/VECTOR-ART.md) |

## Non-Negotiables

- React 18 only; no React 19 runtime features.
- Interactive titles keep title typography; action/navigation labels,
  field labels and captions use control/body typography.
- Include typed `id`, `className`, `direction`, and `a11y` support.
- Elected root: `dir={direction}`, fallback-direction class, logical CSS for
  direction-sensitive layout.
- Deterministic render; no browser globals during render.
- Baseline Widely Available CSS/DOM only, or fallbacks.
- Accessibility per part, per [`ACCESSIBILITY.md`](editor-react-component/ACCESSIBILITY.md):
  read only `a11y.ariaLabel`, and only for a control without a visible name;
  never spread the `a11y` object or add one-off ARIA props.
- Named parts: global class, module class, and `elementProps` (root uses
  top-level props).
- Every visible text: a text prop plus a named part; no JSX text literals.
- Native design states: interactive elements only; pair selectors with injected
  modifiers. Custom states need a class toggle from logic or data, or a root prop
  trigger; styled states need matching `:global()` rules.
- Open/close/reveal: props-only root
  `isOpen: ElementState<boolean>` synced to state; module classes, no `--open` class.
- Single-visible-body arrays: `ActiveItemIndex<'prop'>`, render all bodies,
  hide inactive accessibly; item `name` only when rendered.
- No arrays inside array items; keep group fields flat (no object props).
- Autoplay/loop: play/pause control, honor reduced motion, suppress autoplay in
  editor design mode.
- Resizable layout: keep required content usable at 320px, per
  [`OVERFLOW.md`](editor-react-component/OVERFLOW.md).
- Preview: `withDefaults` outermost, one crucial data field, matching root
  class, per [`COMPONENT-PREVIEW.md`](editor-react-component/COMPONENT-PREVIEW.md).
