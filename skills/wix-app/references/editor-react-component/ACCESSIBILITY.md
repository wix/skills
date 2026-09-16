# Accessibility Implementation and Review

Use this reference while authoring Editor React Component props and JSX, then
run the review command once the JSX is complete.

## Contents

- [Implementation Contract](#implementation-contract)
- [Review Scope](#review-scope)
- [Automated Review](#automated-review)
- [Finding Triage](#finding-triage)
- [Manual Review](#manual-review)
- [Pre-Fix Checks for Non-Interactive Controls](#pre-fix-checks-for-non-interactive-controls)
- [Completion Criteria](#completion-criteria)

## Implementation Contract

### Own Accessibility per Part

Use the platform `A11y` type instead of individual public props such as
`ariaLabel`, `ariaDescribedBy`, or `role`. For each part:

- Prefer a native element.
- Keep roles, heading levels, keyboard and focus behavior, relationships, live
  regions, and widget state in component code.
- Read `a11y.ariaLabel` only when a control has no visible name.

Every `a11y` field that reaches the DOM becomes an editor control. Read only the
field the part needs and write it as its HTML attribute,
`aria-label={a11y?.ariaLabel}`. Never spread the whole object.

```tsx
import type { A11y } from '@wix/editor-react-types';

type ToggleProps = {
  elementProps?: { toggle?: { className?: string; a11y?: A11y } };
};

function Toggle({ elementProps }: ToggleProps) {
  const { a11y: toggleA11y, ...toggleProps } = elementProps?.toggle ?? {};

  return (
    <button {...toggleProps} aria-label={toggleA11y?.ariaLabel ?? ARIA_LABELS.toggle}>
      <ChevronIcon aria-hidden="true" />
    </button>
  );
}
```

Keep the root's typed `a11y?: A11y` prop even when it reads no field. Destructure
`a11y` out of an `elementProps` entry before spreading the entry; a spread entry
records the nested object as a whole. Image alt text comes from the `Image`
type's `alt` field, not from `a11y`.

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

Run this review once the JSX is complete and again after each fix pass, at
most two passes. Do not rerun after a clean result unless JSX changed.

| Request | Pass to the command |
| --- | --- |
| Specific file | That file; its component folder is rendered |
| A component name or "this component" | The component folder |
| Full audit | `src/extensions/site/components/` |

`*.generated.ts` is regenerated from JSX and CSS and is never scanned.
Imported shared components are inspection context, not automatic edit scope.
Report a confirmed shared-component issue instead of changing a broadly reused
primitive unless the requested fix requires that shared change and its impact is
understood.

## Automated Review

`<SKILL_ROOT>` is the absolute directory containing the active `SKILL.md`. Run
from the consumer Wix package so dependencies resolve from that project.

```bash
node <SKILL_ROOT>/scripts/scan-a11y-review.cjs <component-dir | files...>
```

One command, one report. It runs the jsx-a11y ESLint rules, a semantic scanner
that follows imports and checks the per-part `a11y` contract, and a render
audit: the component is rendered with `defaultProps` in Node (an SSR check),
loaded into jsdom with its CSS Modules, and audited with axe-core.
`component.preview.tsx` must render without falling back to the placeholder.

The JSON report has `summary.line`, then `findings` grouped by rule with a
count, locations or DOM target, the scanner message, and the axe help link,
then `notChecked`. Exit `0` means every scanner ran and found nothing, `1`
means findings, `2` means the review is inconclusive; never treat `2` as clean.
Exit `2` with `render FAILED (missing-deps)` means `jsdom` or `axe-core` is not
installed: install them (SKILL.md step 2) and rerun. Exit `2` with
`render FAILED (loader)` means the audit could not load a module the component
imports; that is a scanner limit, not a component defect. Change the import
only if `tsc` also rejects it; otherwise stop and report the loader limit in the
final summary as a check that could not run. Color contrast, target size, and
keyboard behavior need a browser and remain manual.

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

In the default rendered state the command checks names, alt text, ARIA
validity, nesting, list and heading structure, hidden-but-focusable content,
the `a11y` contract, and SSR safety. Verify what it cannot see:

- Every meaningful non-default state (expanded, selected, playing, error,
  empty, hover/focus) keeps correct names, focusability, hidden state, and
  structure; the command audits only the default render.
- Wrappers and polymorphic components preserve their documented semantics;
  extension overrides preserve generated accessibility fields.
- Accessible names describe the action, and visually hidden text that carries
  meaning stays in the accessibility tree.
- State hidden through `--display` or transforms agrees with focusability and
  the accessibility tree; disabled and inert states behave consistently.
- Custom widgets (tabs, menus, dialogs, sliders) implement their keyboard
  pattern: arrow keys, Home/End, Escape, roving `tabIndex`.
- Interactive controls have a hit area of at least 24×24 CSS px and visible
  focus.
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

- the last run exited `0` or `1`; exit `2` is acceptable only for a reported
  `loader` limit;
- every finding is triaged and confirmed issues are fixed when safe;
- the command was rerun after the last fix pass; and
- the manual review is complete.

After two fix passes, stop and report the remaining findings with their triage.
Preserve visual and runtime behavior. Fix the semantic owner: root, named inner
part, shared primitive, or call site. Then return to the main workflow for the
Wix build, manifest generation, TypeScript check, and relevant project tests.
