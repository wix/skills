# Tier 2 Manual Review Checklist

Use this checklist after Tier 1 scanner results are reviewed. Tier 2 is required even when Tier 1 returns zero findings.

## Semantic Targeting

- Do ARIA attributes land on the semantically correct element rather than a non-semantic wrapper?
- Do labels, descriptions, and roles reach the actual interactive or landmark element?
- Do wrapper components preserve the semantics they appear to expose?

## Icon-Only and Visual-Only States

- Do icon-only buttons, links, or controls still have an accessible name?
- If visible text is hidden, is it visually hidden in an accessibility-safe way rather than removed from the tree?
- Do meaningful icons or images expose accessible text when needed?

## CSS and Hidden Content

- Does `display: none` remove content that should remain available to assistive technology?
- Are hidden or collapsed states consistent between visuals, focusability, and the accessibility tree?
- Do CSS variables or conditional classes create states where labels or instructions disappear from assistive technology?

## Decorative vs Meaningful Content

- Are decorative separators, ornaments, and repeated icons hidden from assistive technology?
- Are meaningful visuals, status icons, or graphics named appropriately?

## Focus and Interaction Consistency

- Can hidden or collapsed items still receive focus?
- Do interactive-looking elements expose the right semantic role and keyboard behavior?
- Do disabled, inert, or collapsed states behave consistently for both keyboard users and assistive technology?
- Search all in-scope files for `onClick` on non-interactive native elements (`div`, `span`, `section`, `header`, `footer`, `li`, `td`, etc.). Include conditional patterns such as `{...(condition && { onClick: handler })}`. For each match, verify that the element also has `role`, `tabIndex`, and a keyboard event handler (`onKeyDown` or `onKeyUp`). A missing combination is a high-confidence finding.
- Before proposing a fix for a missing-keyboard-semantics finding, perform these additional checks:
  1. **Nested interactives**: Does the element already contain interactive children (`<a>`, `<button>`, `<input>`, `<Link>`, or components that resolve to them)? If yes, adding `role="button"` to the wrapper creates a nested interactive violation. The fix must either exclude the interactive-child case from button semantics or use a separate control element.
  2. **Existing focus management**: Does the same element already receive `tabIndex` from another source (e.g., a utility like `getTabIndexAttribute`, a separate a11y prop spread, or an interactions framework)? If yes, the fix must not add a competing `tabIndex` without understanding the merge order and override behavior.
  3. **Gating condition audit**: Read the boolean expression that controls interactivity (e.g., `isClickable`). Verify it uses explicit comparisons (`=== undefined`, `=== true`) rather than truthiness/falsiness when the variable's type includes `undefined`, `false`, and `true` as semantically distinct states. A fragile condition can silently enable interactivity in unintended states.

## Structural Semantics

- Are landmarks, headings, and list semantics preserved through wrappers and layout components?
- When a component appears to implement breadcrumbs, tabs, menus, dialogs, or similar patterns, do the expected semantics reach the rendered structure?

## Fix and Reporting Guidance

- Fix Tier 2 issues inline as they are discovered. Use the same confidence-based approach as Tier 1.
- If you can see the violation in the code and describe a localized, behavior-preserving fix, it is confirmed. Apply the fix immediately.
- Do not label confirmed Tier 2 findings as advisory.
- Severity affects reporting priority, not whether a confirmed safe/local fix should be applied.
- Do not skip a confirmed fix because it is minor, secondary, in a shared layer, or outside the first file the user mentioned.
- Report Tier 2 findings and fixes separately from Tier 1 scanner findings.
- When Tier 2 reveals issues that the scanner missed, say so explicitly and state what was fixed.
- Only describe the component as clean if both tiers are complete, all fixes are verified, and no unresolved issues remain.
