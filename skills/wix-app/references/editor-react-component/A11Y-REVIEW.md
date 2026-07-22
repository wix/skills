# Editor React Component A11y Review

Use this reference to audit and fix accessibility issues in an Editor React Component. This complements [`ACCESSIBILITY.md`](ACCESSIBILITY.md), which covers ARIA prop conventions and patterns, with an automated scan and triage workflow over the component's runtime, manifest extension, and shared code.

This is not a separate skill. It runs as part of the Editor React Component workflow described in [`../EDITOR_REACT_COMPONENT.md`](../EDITOR_REACT_COMPONENT.md). Run it after editing the React/CSS sources and before `npx wix build && npx wix generate manifest`.

## Scanner Invocation

Two scanners live at the Editor React Component skill root:

```bash
node skills/wix-app/scripts/scan-a11y-eslint.cjs <file1> [file2] ...
node skills/wix-app/scripts/scan-a11y-code.cjs  <file1> [file2] ...
```

Run them from the consumer project root (the Wix CLI app's working directory) so dependencies resolve from the project's `package.json`. Pass paths relative to that cwd. The dependency preflight is part of the workflow in [`../EDITOR_REACT_COMPONENT.md`](../EDITOR_REACT_COMPONENT.md).

The ESLint scanner uses the explicitly declared `eslint-plugin-jsx-a11y` dev dependency. The semantic scanner follows imports up to four levels deep and adds resolution evidence and confidence to its findings.

## When To Run

Run the review when:

- You finished editing an Editor React Component's `.tsx` / `.module.css` files.
- The user asks for an a11y audit, accessibility review, or a11y fix on an Editor React Component.
- The user mentions missing alt text, invalid ARIA, broken semantics, direction issues, icon-only controls, or wrappers that hide accessibility issues.

Do not run on generated files (`*.generated.ts`); they are regenerated from JSX and CSS Modules.

## Target Resolution

Resolve scope before scanning:

| User says | Required scope |
|-----------|----------------|
| Specific file | That file plus any imported wrappers / shared components it renders |
| "this component" | `<componentName>.tsx`, `component.tsx`, `<componentName>.extension.ts`, plus shared imports |
| A component name | All in-component files (excluding `*.generated.ts`) |
| "full audit" | Every Editor React Component folder under `src/extensions/site/components/`, excluding `*.generated.ts` |

## Workflow

Execute every phase inline while editing. Do not pause for approval or add a separate summary phase.

### Phase 1: Resolve Topology

1. Enumerate in-scope files under `src/extensions/site/components/<componentName>/`.
2. Include imported shared components or utilities that affect rendered semantics.
3. Exclude `*.generated.ts`.
4. Trace the topology from the component through wrappers and shared primitives to the rendered element.

### Phase 2a: ESLint JSX A11y Scan (Tier 0)

```bash
node skills/wix-app/scripts/scan-a11y-eslint.cjs <file1> [file2] ...
```

Use each finding's rule ID, message, and location as the rule-specific context. Validate the finding against the component implementation before editing.

### Phase 2b: Semantic Scan (Tier 1)

```bash
node skills/wix-app/scripts/scan-a11y-code.cjs <file1> [file2] ...
```

Use the emitted resolution path, evidence, and confidence to trace each finding. The scanner output is the source of rule-specific details; the reference only defines how to evaluate and act on those details.

Neither scanner validates manifest contracts or all Editor React Component patterns. Complete Phase 3 even when both scanners return zero findings.

### Deduplication and Triage

Evaluate every finding before fixing it.

**Deduplicate.** When both scanners flag the same location for the same issue, keep the finding with richer evidence. Prefer the semantic scanner when it resolved the component topology; prefer ESLint when the issue is outside the semantic scanner's scope.

| Verdict | Meaning | Action |
|---------|---------|--------|
| `confirmed` | The violation is real | Fix it |
| `false-positive` | The rule fires but the rendered behavior is correct | Discard it |
| `not-relevant` | The rule does not apply to this architecture | Discard it |

Use this order to evaluate a finding:

1. Trace the component implementation and confirm that the flagged behavior reaches the rendered element.
2. Check delegated semantics. Editor React Components route ARIA through the typed `a11y` prop and `convertA11yKeysToHtmlFormat(a11y)` (see [`ACCESSIBILITY.md`](ACCESSIBILITY.md)). If the attributes reach the correct element through a runtime path the scanner cannot see, discard the finding as a false positive.
3. Check conditional interactivity. When `onClick` is spread conditionally with `role`, `tabIndex`, and `onKeyDown`, discard the finding as a false positive. If only `onClick` is conditional, confirm it.
4. Apply the semantic checks in [`A11Y-REVIEW-REFERENCE.md`](A11Y-REVIEW-REFERENCE.md#tier-2-manual-review-checklist).
5. When uncertain, continue tracing the implementation. Default to `confirmed` only after checking the available code and evidence.

Only confirmed findings proceed to edits.

### Phase 3: Editor React Component Semantic Review

Perform a manual semantic review even when scanners return zero findings.

- All ARIA attributes come through the typed `a11y?: A11y` prop, never individual `ariaLabel?: string`, `role?: string`, and similar props. See [`ACCESSIBILITY.md`](ACCESSIBILITY.md).
- `a11y` is forwarded to the root via `{...(a11y && convertA11yKeysToHtmlFormat(a11y))}`, or to an inner element via `elementProps.<name>.a11y` when requirements specify.
- Icon-only interactive elements (icon/emoji/image/svg with no text node) have an accessible name from `constants.ts` or user-configurable `a11y`, never a hardcoded string literal.
- Direction support is mandatory: props include `direction?: Direction`, the root applies `dir={direction}` and the unconditional `fallbackDirection` class, and CSS defines `.fallbackDirection:not([dir])`. See [`DIRECTIONALITY.md`](DIRECTIONALITY.md).
- Every `ReactNode` content prop is rendered inside an element with `dir="ltr"` so user-provided nested content does not inherit the component direction.
- `<componentName>.extension.ts` overrides do not strip a11y-relevant manifest fields generated from the JSX.
- Decorative-only output is hidden with `aria-hidden` when appropriate.
- Heading/tag selection, when configurable, reaches the rendered semantic element.
- Interactive-looking elements expose the required keyboard behavior and roles.

Use the full Tier 2 checklist in [`A11Y-REVIEW-REFERENCE.md`](A11Y-REVIEW-REFERENCE.md#tier-2-manual-review-checklist).

### Phase 4: Fix

Apply fixes only to findings that survived triage:

- `high`: fix immediately
- `medium`: read the surrounding code, confirm, then fix
- `low`: resolve the semantics from code and evidence; fix only when confirmed

Confirmed safe/local fixes must be applied. Leave code unchanged only when the semantics remain ambiguous or the fix requires a risky, non-local behavior change. See [`A11Y-REVIEW-REFERENCE.md`](A11Y-REVIEW-REFERENCE.md#confidence-model).

Fix principles:

- Preserve intended visual and runtime behavior.
- Fix the real semantic owner: component root, inner element via `elementProps`, or shared base.
- Follow established Editor React Component patterns: route ARIA through `a11y`, use `constants.ts` for required labels, and never hardcode string literals.
- Before adding `role`, `tabIndex`, or keyboard handlers to a non-interactive element, run the [pre-fix checks](A11Y-REVIEW-REFERENCE.md#pre-fix-checks-for-adding-button-semantics-to-a-non-interactive-element).

### Phase 5: Verify

If any `.tsx` / `.jsx` file was edited:

1. Re-run both scanners on the modified files.
2. Run `npx wix build && npx wix generate manifest` so the manifest reflects any JSX changes.
3. Run the project's TypeScript check (`npx tsc --noEmit`), which is already part of the wix-app validation flow.

Verification is mandatory after edits. Continue directly from fixes to verification, and do not consider the workflow complete while a required check remains unrun.

## References

- [`A11Y-REVIEW-REFERENCE.md`](A11Y-REVIEW-REFERENCE.md) - triage, confidence, semantic resolution, Tier 2 checks, and pre-fix safeguards
- [`ACCESSIBILITY.md`](ACCESSIBILITY.md) - ARIA conventions for Editor React Components
