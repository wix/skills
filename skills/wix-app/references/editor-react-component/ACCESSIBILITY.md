# Accessibility Implementation and Review

Use this reference while authoring Editor React Component props and JSX and
after every JSX edit.

## Contents

- [Implementation Contract](#implementation-contract)
- [Review Scope](#review-scope)
- [Automated Scanners](#automated-scanners)
- [Finding Triage](#finding-triage)
- [Manual Review](#manual-review)
- [Pre-Fix Checks for Non-Interactive Controls](#pre-fix-checks-for-non-interactive-controls)
- [Completion Criteria](#completion-criteria)

## Implementation Contract

### Route ARIA Through `a11y`

Do not add individual public props such as `ariaLabel`, `ariaDescribedBy`, or
`role`. Use the platform `A11y` type and convert it at the semantic target.

```tsx
import type { A11y, Direction } from '@wix/editor-react-types';
import { convertA11yKeysToHtmlFormat } from '@wix/react-component-utils';

export type TabsProps = {
  id?: string;
  className?: string;
  direction?: Direction;
  a11y?: A11y;
};

<nav {...(a11y && convertA11yKeysToHtmlFormat(a11y))}>{tabs}</nav>;
```

Apply root accessibility to the elected root. If requirements assign
accessibility to a named inner part, route it through that part's
`elementProps.<name>.a11y` contract and convert it on the actual semantic
element.

### Provide Accessible Names

Use this priority order:

1. Prefer visible text that already names the control.
2. Use user-configurable `a11y` when the name depends on site-owner content.
3. Use the project's translation mechanism or a `constants.ts` value only for a
   stable system-owned label required by the component contract.

Never hardcode an `aria-label` string directly in JSX.

```tsx
// constants.ts
export const ARIA_LABELS = {
  playButton: 'Play animation',
  pauseButton: 'Pause animation',
} as const;

// component JSX
<button
  aria-label={isPlaying ? ARIA_LABELS.pauseButton : ARIA_LABELS.playButton}
>
  {isPlaying ? <PauseIcon /> : <PlayIcon />}
</button>;
```

Icon-only controls require an accessible name. Controls with visible text,
including an icon plus visible text, usually do not need another ARIA label.

### Preserve Semantic Ownership

- Put roles, labels, descriptions, keyboard handling, and focusability on the
  element that owns the behavior, not on a layout wrapper.
- Prefer native elements over recreating their semantics with `role`.
- Hide decorative-only output with `aria-hidden="true"` when appropriate.
- Preserve heading, list, navigation, and landmark semantics through wrappers.
- Keep hidden or collapsed state consistent across visuals, focusability, and
  the accessibility tree.

## Review Scope

Run this review after creating or editing JSX.

| Request | Scan and inspect |
| --- | --- |
| Specific file | That file and rendered wrappers or shared components it imports |
| A component name or "this component" | All hand-edited files in its component folder plus relevant shared imports |
| Full audit | Every component under `src/extensions/site/components/` plus relevant shared imports |

Exclude `*.generated.ts`; it is regenerated from JSX and CSS.
Imported shared components are inspection context, not automatic edit scope.
Report a confirmed shared-component issue instead of changing a broadly reused
primitive unless the requested fix requires that shared change and its impact is
understood.

## Automated Scanners

`<SKILL_ROOT>` is the absolute directory containing the active `SKILL.md`. Run
both commands from the consumer Wix package so dependencies resolve from that
project. Pass `.tsx` or `.jsx` paths relative to the current directory.

```bash
node <SKILL_ROOT>/scripts/scan-a11y-eslint.cjs <file1> [file2] ...
node <SKILL_ROOT>/scripts/scan-a11y-code.cjs <file1> [file2] ...
```

Do not treat scanner startup failure as a clean result. The ESLint scanner
reports JSX accessibility rules. The semantic scanner follows imports up to
four levels and emits resolution evidence and confidence. Neither scanner
covers every Editor React Component contract, so complete the manual review
even when both return zero findings.

## Finding Triage

For every finding:

1. Trace the rendered semantic element through local and shared components.
2. Deduplicate findings for the same issue and location; keep the finding with
   stronger evidence.
3. Assign `confirmed`, `false-positive`, or `not-relevant`.
4. Fix only confirmed findings.

Scanner output is a lead, not permission to edit blindly.

### Confidence and Action

| Confidence | Evidence | Action |
| --- | --- | --- |
| High | The rendered element and static props directly establish the issue. | Confirm and fix when the change is safe and local. |
| Medium | Props or partial component resolution strongly imply the semantics. | Inspect surrounding code, then confirm or discard. |
| Low | Heuristics or unresolved runtime spreads are the main evidence. | Trace further and fix only after confirmation. |
| Unknown | The semantic target cannot be resolved. | Leave unchanged and report the ambiguity when material. |

Confidence establishes whether a finding is real, not whether its fix is safe.
Apply confirmed local, behavior-preserving fixes. Leave a confirmed issue
unchanged only when product intent is unknowable or the fix requires risky,
non-local behavior changes.

### Semantic Resolution Order

Resolve rendered behavior in this order:

1. Flagged JSX element and static props
2. Explicit polymorphic props such as `as="a"` or `component="button"`
3. Local component implementation
4. Installed package source or declarations
5. Prop evidence such as `href`, `to`, `src`, `alt`, and `role`
6. Component-name heuristics

Follow local imports to their rendered root. For package imports, inspect the
resolved package entry when available. Do not assign more confidence than the
evidence supports.

## Manual Review

Verify all of the following after triaging scanner output.

### Semantic Targeting

- `a11y` is typed and converted on the correct semantic element.
- Wrappers and polymorphic components preserve their documented semantics.
- Configurable heading or tag choices reach the rendered element.
- Extension overrides preserve generated accessibility fields.

### Names and Visual Content

- Icon-only controls have configurable or stable system-owned names.
- Visually hidden text remains in the accessibility tree when needed.
- Meaningful images and icons are named; decorative repetitions are hidden.
- Accessibility strings are not hardcoded directly in JSX.

### Hidden Content and Focus

- Hidden or collapsed state agrees across visuals, focusability, and the
  accessibility tree.
- Invisible content cannot receive focus unless the interaction requires it.
- Disabled and inert states behave consistently for keyboard and assistive
  technology users.

### Interaction and Structure

- Interactive-looking elements use native semantics or complete role, focus,
  and keyboard behavior.
- `onClick` on a non-interactive tag is checked, including conditional spreads.
- Nested interactive children and existing focus management are inspected
  before semantics are added to a wrapper.
- Lists, headings, landmarks, tabs, menus, dialogs, and breadcrumbs keep their
  intended structure.
- The root implements the direction contract, and every `ReactNode` slot
  isolates nested content with `dir="ltr"`.

## Pre-Fix Checks for Non-Interactive Controls

Before adding `role="button"`, `tabIndex`, and keyboard handlers to a non-native
control, verify:

1. **Interactive children:** it cannot contain a link, button, input, or another
   interactive component in the active branch.
2. **Focus ownership:** existing `tabIndex` or accessibility spreads have a
   clear merge order and one authoritative source.
3. **Interaction condition:** the same condition gates pointer, focus, and
   keyboard behavior and excludes disabled or editor-controlled states when
   needed.
4. **Accessible-name scope:** the label intentionally names the component or
   action and persists in every state where it is needed.

Prefer a native element when it preserves product behavior.

## Completion Criteria

The accessibility review is complete only when:

- both scanners start successfully;
- every finding is triaged;
- confirmed issues are fixed when safe;
- the manual review is complete; and
- both scanners are rerun on every changed `.tsx` or `.jsx` file.

Preserve visual and runtime behavior. Fix the semantic owner: root, named inner
part, shared primitive, or call site. Then return to the main workflow for the
Wix build, manifest generation, TypeScript check, and relevant project tests.
