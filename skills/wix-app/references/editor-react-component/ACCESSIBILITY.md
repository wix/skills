# Accessibility Implementation and Review

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

The shared-default rule in `COMPONENT-CONTRACT.md` applies to a11y fields too:
root defaults go in `defaultProps.a11y`; named-part defaults go in
`defaultProps.elementProps.<part>.a11y`.

```ts
// toggle.props.ts
import type { A11y } from '@wix/editor-react-types';

export type ToggleProps = {
  elementProps?: { toggle?: { className?: string; a11y?: A11y } };
};

export const defaultProps = {
  elementProps: { toggle: { a11y: { ariaLabel: 'Toggle details' } } },
} satisfies ToggleProps;
```

```tsx
// toggle.tsx
import type { ToggleProps } from './toggle.props';

export function Toggle({ elementProps }: ToggleProps) {
  const { a11y: toggleA11y, ...toggleProps } = elementProps?.toggle ?? {};
  return (
    <button {...toggleProps} aria-label={toggleA11y?.ariaLabel}>
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" />
      </svg>
    </button>
  );
}
```

Keep the root's `a11y?: A11y` prop even when it reads no field. Destructure
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

For example, a system-owned playback label can use
`aria-label={isPlaying ? ARIA_LABELS.pauseButton : ARIA_LABELS.playButton}`,
with those strings defined in `constants.ts`.

Icon-only controls need an accessible name; controls with visible text usually
do not need another ARIA label.

### Preserve Semantic Ownership

- Put roles, labels, descriptions, keyboard handling, and focusability on the
  element that owns the behavior, not on a layout wrapper.
- Prefer native elements over recreating their semantics with `role`.
- Hide decorative-only output with `aria-hidden="true"` when appropriate.
- Preserve heading, list, navigation, and landmark semantics through wrappers.
- Keep hidden or collapsed state consistent across visuals, focusability, and
  the accessibility tree.

## Review Scope

Review completed JSX and rerun after fixes, at most two passes. After a clean
result, rerun only if JSX changes.

| Request | Pass to the command |
| --- | --- |
| Specific file | That file; its component folder is rendered |
| A component name or "this component" | The component folder |
| Full audit | `src/extensions/site/components/` |

`*.generated.ts` is regenerated from JSX and CSS and is never scanned.
Inspect imported shared components, but edit them only when the requested fix
requires it and the impact is understood; otherwise report the issue.

## Automated Review

`<SKILL_ROOT>` is the absolute directory containing the active `SKILL.md`. Run
from the consumer Wix package so dependencies resolve from that project.

```bash
node <SKILL_ROOT>/scripts/scan-a11y-review.cjs <component-dir | files...>
```

The command runs jsx-a11y ESLint rules, a semantic scanner that follows imports,
and an SSR/jsdom/axe-core audit with `defaultProps` and CSS Modules.
`component.preview.tsx` must render without the placeholder.

Read `summary.line`, `findings`, and `notChecked` in the JSON report.
Exit `0` means clean, `1` means findings, and `2` means inconclusive, never clean.
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

### Confidence and Action

| Confidence | Evidence | Action |
| --- | --- | --- |
| High | Rendered element and static props prove it. | Fix when safe and local. |
| Medium | Props or partial resolution suggest it. | Inspect, then confirm or discard. |
| Low | Only heuristics or unresolved spreads. | Trace before fixing. |
| Unknown | Semantic target unresolved. | Leave unchanged; report material ambiguity. |

Apply confirmed local, behavior-preserving fixes. Report issues needing unknown
product intent or risky, non-local behavior changes.

### Semantic Resolution Order

Resolve semantics in this order:

1. Flagged JSX element and static props
2. Explicit polymorphic props such as `as="a"` or `component="button"`
3. Local component implementation
4. Installed package source or declarations
5. Prop evidence such as `href`, `to`, `src`, `alt`, and `role`
6. Component-name heuristics

Follow local imports to their rendered root and package imports to their
resolved entry. Match confidence to evidence.

## Manual Review

The command audits default-state semantics, names, ARIA, focus visibility,
the a11y contract, and SSR. Also verify:

- Every meaningful non-default state (expanded, selected, playing, error,
  empty, hover/focus) keeps correct names, focusability, hidden state, and
  structure; the command audits only the default render.
- Trace each a11y field read, including aliases and inner parts, to its matching
  `defaultProps` path and meaningful default. An unused `a11y?: A11y` declaration
  needs no default. Check source; no extra manifest generation is required.
- Wrappers and polymorphic components preserve their documented semantics;
  extension overrides preserve generated accessibility fields.
- Accessible names describe the action, and visually hidden text that carries
  meaning stays in the accessibility tree.
- State hidden through `--display` or transforms agrees with focusability and
  the accessibility tree; disabled and inert states behave consistently.
- Custom widgets (tabs, menus, dialogs, sliders) implement their full APG
  keyboard pattern (arrow keys, Home/End, Escape, roving `tabIndex`) and
  structural relationships, or use a plain native element instead of
  borrowing the role.
- Interactive controls have a hit area of at least 24×24 CSS px and visible
  focus.
- The root implements the direction contract, and every `ReactNode` slot
  isolates nested content with `dir="ltr"`.

- An auto-rotating set of readable parallel items uses `aria-live="off"` while
  it is rotating and `aria-live="polite"` while it is stopped.

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

After two fix passes, report remaining findings with their triage. Preserve
visual and runtime behavior. Fix the semantic owner, then resume only the
build, manifest, TypeScript, and test steps required by the task.
