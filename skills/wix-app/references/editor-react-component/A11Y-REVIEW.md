# Editor React Component A11y Review

Use this reference to audit and fix accessibility issues in an Editor React Component before reporting completion. This complements [`ACCESSIBILITY.md`](ACCESSIBILITY.md) (which covers ARIA prop conventions and patterns) by adding an automated scan + triage workflow over the component's runtime, manifest extension, and shared code.

This is not a separate skill — it runs as part of the Editor React Component workflow described in [`../EDITOR_REACT_COMPONENT.md`](../EDITOR_REACT_COMPONENT.md). Run it after editing the React/CSS sources and before `npx wix build && npx wix generate manifest`.

## Scanner Invocation

Two scanners live at the wix-app skill root:

```bash
node skills/wix-app/scripts/scan-a11y-eslint.js <file1> [file2] ...
node skills/wix-app/scripts/scan-a11y-code.js  <file1> [file2] ...
```

Run them from the consumer project root (the Wix CLI app's working directory) so dependencies resolve from the project's `package.json`. Pass paths relative to that cwd.

The ESLint scanner uses `eslint-plugin-jsx-a11y` (usually transitively available); the custom scanner performs cross-file semantic resolution (follows imports up to 4 levels deep) with confidence scoring.

## When To Run

Run the review when:

- You finished editing an Editor React Component's `.tsx` / `.module.css` files.
- The user asks for an a11y audit, accessibility review, or a11y fix on an Editor React Component.
- The user mentions missing alt text, invalid ARIA, broken semantics, direction issues, icon-only controls, or wrappers that hide accessibility issues.

Do not run on generated files (`*.generated.ts`) — they're regenerated from JSX and CSS Modules.

## Target Resolution

Resolve scope before scanning:

| User says | Required scope |
|-----------|----------------|
| Specific file | That file plus any imported wrappers / shared components it renders |
| "this component" | `<componentName>.tsx`, `component.tsx`, `<componentName>.extension.ts`, plus shared imports |
| A component name | All in-component files (excluding `*.generated.ts`) |
| "full audit" | Every Editor React Component folder under `src/site/components/`, excluding `*.generated.ts` |

## Workflow

Execute phases in order; do not pause for approval between phases.

### Phase 1: Resolve Topology

1. Enumerate in-scope files under `src/site/components/<componentName>/`.
2. Include any imported shared components or utilities that affect rendered semantics.
3. Exclude `*.generated.ts`.
4. Note the topology (wrapper → shared primitive → leaf element) before scanning.

### Phase 2a: ESLint JSX A11y Scan (Tier 0)

```bash
node skills/wix-app/scripts/scan-a11y-eslint.js <file1> [file2] ...
```

Single-file lint-level detections covering 31 `jsx-a11y` rules (interaction, focus, labeling, structural). High-signal for native elements; treat as leads for custom components. Full rule list: [`a11y-review/RULES.md`](a11y-review/RULES.md).

### Phase 2b: Custom Semantic Scan (Tier 1)

```bash
node skills/wix-app/scripts/scan-a11y-code.js <file1> [file2] ...
```

Cross-file semantic resolution with confidence scoring. Covers five rule families:

- `alt-text`
- `anchor-is-valid`
- `aria-props`
- `aria-role`
- `aria-unsupported-elements`

Neither scanner validates manifest contracts or all project-specific patterns — see Phase 3.

### Deduplication and Triage

After both scans, evaluate every Tier 0 finding before fixing.

**Deduplicate.** When both scanners flag the same location for the same issue, keep the richer one — prefer the custom scanner when it has semantic evidence; prefer ESLint when it covers a rule the custom scanner does not.

**Verdicts:**

| Verdict | Meaning | Action |
|---------|---------|--------|
| `confirmed` | The violation is real | Proceed to fix |
| `false-positive` | Lint rule fires but code is correct | Discard with one-sentence reason |
| `not-relevant` | Rule does not apply in this architecture | Discard with one-sentence reason |

**How to evaluate:**

1. **Native vs custom.** Native element findings are usually real. Custom component findings need verification — does the component render the element the rule assumes?
2. **Delegated semantics.** Editor React Components route ARIA through the typed `a11y` prop and `convertA11yKeysToHtmlFormat(a11y)` (see [`ACCESSIBILITY.md`](ACCESSIBILITY.md)). If a11y attributes reach the element via a runtime path the linter can't see, the finding is a false positive.
3. **Conditional interactivity.** When `onClick` is spread conditionally with `role`, `tabIndex`, and `onKeyDown`, the finding is a false positive. If only `onClick` is conditional, the finding is confirmed.
4. **Repo-specific exemptions** — see the originals in [`a11y-review/MANUAL-REVIEW-CHECKLIST.md`](a11y-review/MANUAL-REVIEW-CHECKLIST.md).
5. **When uncertain, default to `confirmed`.**

Only confirmed findings proceed to fix. Report discards in Phase 6 with reasons.

### Phase 3: Editor React Component Semantic Review

Perform a manual semantic review even when scanners return zero findings.

Editor React Component–specific checks:

- All ARIA attributes come through the typed `a11y?: A11y` prop — never individual `ariaLabel?: string`, `role?: string`, etc. (See [`ACCESSIBILITY.md`](ACCESSIBILITY.md).)
- `a11y` is forwarded to the root via `{...(a11y && convertA11yKeysToHtmlFormat(a11y))}`, or to an inner element via `elementProps.<name>.a11y` when requirements specify.
- Icon-only interactive elements (icon/emoji/image/svg with no text node) have an accessible name from `constants.ts` or from user-configurable `a11y` — never a hardcoded string literal.
- If the component supports text direction, the root applies `dir` (see [`DIRECTIONALITY.md`](DIRECTIONALITY.md)).
- `<componentName>.extension.ts` overrides do not strip a11y-relevant manifest fields generated from the JSX.
- Decorative-only output is hidden with `aria-hidden` when appropriate.
- Heading/tag selection (when configurable) reaches the rendered semantic element.
- Interactive-looking non-interactive elements expose keyboard behavior and roles.

Use the Tier 2 checklist in [`a11y-review/MANUAL-REVIEW-CHECKLIST.md`](a11y-review/MANUAL-REVIEW-CHECKLIST.md) alongside these checks.

### Phase 4: Fix

Apply fixes only to findings that survived triage. Confidence drives action:

- `high`: fix immediately
- `medium`: read surrounding code, confirm, then fix
- `low`: attempt to resolve semantics; fix only if confirmed

Confirmed safe/local fixes must be applied; only ambiguous or risky non-local changes may remain unresolved. See [`a11y-review/CONFIDENCE-MODEL.md`](a11y-review/CONFIDENCE-MODEL.md).

**Fix principles:**

- Preserve intended visual and runtime behavior.
- Fix the real semantic owner: component root, inner element via `elementProps`, or shared base.
- Prefer Editor React Component–native patterns: route ARIA through `a11y`, use `constants.ts` for required labels, never hardcode string literals.
- Before adding `role`, `tabIndex`, or keyboard handlers to a non-interactive element, run the pre-fix checks in [`a11y-review/FIX-STRATEGIES.md`](a11y-review/FIX-STRATEGIES.md#pre-fix-checks-for-adding-button-semantics-to-a-non-interactive-element).

### Phase 5: Verify

If any `.tsx` / `.jsx` file was edited:

1. Re-run both scanners on the modified files.
2. Run `npx wix build && npx wix generate manifest` so the manifest reflects any JSX changes (this is also required by the Editor React Component workflow).
3. Run the project's TypeScript check (`npx tsc --noEmit`) — already part of the wix-app validation flow.

Verification is mandatory after edits. Do not consider the review complete until it has run or you've explicitly reported why it could not.

### Phase 6: Report

Summarize:

1. **Topology and scope** — files reviewed, layers covered.
2. **Tier 0 ESLint findings** — grouped by rule with dispositions.
3. **Tier 1 custom scanner findings** — grouped by rule with dispositions.
4. **Tier 2 semantic findings** — including manifest/shared-layer items neither scanner catches.
5. **Verification** — scanner re-runs, `npx wix build && npx wix generate manifest`, `npx tsc --noEmit`.
6. **Unresolved items** — with exact blockers.

Every finding ends in one of:

- `fixed`
- `skipped-ambiguous`
- `skipped-risky`
- `false-positive` (one-sentence reason)
- `not-relevant` (one-sentence reason)

Any disposition other than `fixed` requires a one-sentence concrete blocker or reason.

## Confidence Handling

- `high`: fix immediately
- `medium`: confirm by reading code, then fix
- `low`: attempt to resolve semantics; fix only if confirmed; otherwise report as advisory

Severity affects reporting priority, not whether a confirmed safe/local fix should be applied.

See [`a11y-review/CONFIDENCE-MODEL.md`](a11y-review/CONFIDENCE-MODEL.md).

## References

- Rule criteria: [`a11y-review/RULES.md`](a11y-review/RULES.md)
- Fix strategies: [`a11y-review/FIX-STRATEGIES.md`](a11y-review/FIX-STRATEGIES.md)
- Tier 2 semantic checklist: [`a11y-review/MANUAL-REVIEW-CHECKLIST.md`](a11y-review/MANUAL-REVIEW-CHECKLIST.md)
- Semantic inference model: [`a11y-review/SEMANTIC-RESOLUTION.md`](a11y-review/SEMANTIC-RESOLUTION.md)
- Confidence handling: [`a11y-review/CONFIDENCE-MODEL.md`](a11y-review/CONFIDENCE-MODEL.md)
- Pattern examples: [`a11y-review/EXAMPLES.md`](a11y-review/EXAMPLES.md)
- ARIA conventions for Editor React Components: [`ACCESSIBILITY.md`](ACCESSIBILITY.md)
