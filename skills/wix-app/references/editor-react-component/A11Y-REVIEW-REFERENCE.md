# Editor React Component A11y Review Reference

Use this reference for decisions that require code inspection after running the scanners in [`A11Y-REVIEW.md`](A11Y-REVIEW.md). The scanner output owns rule-specific context: rule ID, location, message, resolution path, evidence, and confidence. Do not maintain a separate rule catalog here.

## Scanner Result Handling

Treat every scanner finding as a lead until the component implementation confirms how the flagged behavior reaches the rendered element.

1. Read the full finding, including evidence and confidence when present.
2. Trace the component topology through local wrappers, shared primitives, and package implementations.
3. Deduplicate findings that identify the same issue at the same location.
4. Assign a verdict: `confirmed`, `false-positive`, or `not-relevant`.
5. Fix confirmed issues inline, then re-run both scanners on changed JSX files.

When both scanners flag the same issue, keep the finding with the strongest semantic evidence. The scanners complement each other; a finding from one scanner is not automatically stronger because of its tier.

## Confidence Model

### High

Use high confidence when the code and scanner evidence unambiguously show the violation, for example:

- the flagged rendered element and static props establish the behavior directly
- the component implementation resolves to the flagged semantic element
- an explicit polymorphic prop establishes the rendered element

Fix high-confidence findings immediately.

### Medium

Use medium confidence when:

- props strongly imply the rendered semantics
- the implementation only partially resolves but preserves likely semantics
- the component name, props, and surrounding evidence strongly agree

Read the surrounding code. If it confirms the inference, fix the issue. If it contradicts the inference, discard the finding. If the implementation remains unresolved, treat it as low confidence.

### Low

Use low confidence when:

- only weak heuristics support the semantic guess
- the implementation cannot be resolved
- runtime props or spreads can materially change the rendered semantics

Continue tracing the code. Fix only after the issue is confirmed; otherwise leave the code unchanged.

### Confidence vs. Actionability

Confidence answers whether the issue is real. It does not decide whether a confirmed fix is safe.

- Confirmed + safe/local fix: fix now.
- Confirmed + risky behavior change or non-local refactor: leave unchanged.
- Unconfirmed or ambiguous: leave unchanged.

If the violation is visible in the code and has a localized, behavior-preserving fix, treat it as confirmed and apply the fix.

Valid reasons to leave code unchanged:

- semantics remain ambiguous after reading the available code
- product intent cannot be derived from the code
- the fix requires a risky behavior change or a non-local refactor

Do not leave a confirmed safe/local issue unchanged because it is low severity, secondary, shared, or outside the first file in scope.

## Semantic Resolution

Resolve the rendered behavior in this order:

1. The flagged JSX element and its static props
2. Explicit polymorphic props such as `as="a"` or `component="button"`
3. The local component implementation
4. Installed package source or declarations in `node_modules`
5. Prop evidence such as `href`, `to`, `src`, `alt`, and `role`
6. Component-name heuristics

For local imports, follow the exported component's rendered root. Continue through local or package components until the semantics resolve or the evidence becomes too weak.

For package imports, resolve the import from `node_modules` and inspect its exported entry point. If the package hides its rendered semantics, use prop and naming evidence without assigning more confidence than the evidence supports.

## Tier 2 Manual Review Checklist

Run this checklist after scanner findings are triaged. Tier 2 is required even when both scanners return zero findings.

### Semantic Targeting

- Do ARIA attributes land on the semantically correct element instead of a layout wrapper?
- Do labels, descriptions, and roles reach the actual interactive or landmark element?
- Do wrappers preserve the semantics exposed by their API?

### Icon-Only and Visual-Only States

- Do icon-only buttons, links, or controls have an accessible name?
- If visible text is hidden, is it visually hidden in an accessibility-safe way instead of removed from the accessibility tree?
- Do meaningful icons or images expose accessible text when needed?

### CSS and Hidden Content

- Does `display: none` remove content that should remain available to assistive technology?
- Are hidden or collapsed states consistent across visuals, focusability, and the accessibility tree?
- Do conditional classes or CSS variables create states where labels or instructions disappear from assistive technology?

### Decorative vs. Meaningful Content

- Are decorative separators, ornaments, and repeated icons hidden from assistive technology?
- Are meaningful visuals, status icons, or graphics named appropriately?

### Focus and Interaction Consistency

- Can hidden or collapsed items still receive focus?
- Do interactive-looking elements expose the correct role and keyboard behavior?
- Do disabled, inert, or collapsed states behave consistently for keyboard users and assistive technology?
- Search all in-scope files for `onClick` on elements without built-in interaction (`div`, `span`, `section`, `header`, `footer`, `li`, `td`, and similar tags). Include conditional patterns such as `{...(condition && { onClick: handler })}`. Verify that each match also has the required `role`, `tabIndex`, and keyboard handler (`onKeyDown` or `onKeyUp`). A missing combination is a high-confidence finding.
- Before fixing missing keyboard semantics, check for nested interactive children, existing focus management, and the condition that enables interaction. Use the [pre-fix checks](#pre-fix-checks-for-adding-button-semantics-to-a-non-interactive-element).

### Structural Semantics

- Are landmarks, headings, and list semantics preserved through wrappers and layout components?
- When the component implements breadcrumbs, tabs, menus, dialogs, or similar patterns, do the expected semantics reach the rendered structure?

### Editor React Component Contracts

- Are ARIA attributes routed through the typed `a11y` prop and converted at the correct element?
- Do icon-only labels come from `constants.ts` or user-configurable `a11y` instead of hardcoded strings?
- Does the component preserve direction support and isolate each `ReactNode` content prop with `dir="ltr"`?
- Do extension overrides preserve a11y-relevant manifest fields generated from JSX?

## Fix Principles

- Use the rule ID, message, and evidence emitted by the scanner as the rule-specific fix context.
- Read the surrounding code before editing.
- Preserve visual and runtime behavior.
- Prefer the smallest correct change and avoid unrelated refactors.
- Fix the semantic owner: the component root, the correct inner element, a shared base, or the call site that supplies the value.
- When a wrapper already accepts and forwards a required prop, fix the call site. When it does not, update the wrapper contract and forwarding before fixing the call site.
- Do not hardcode reusable accessibility values such as alternative text. Accept them through the component API when they depend on consumer content.
- Route Editor React Component ARIA through `a11y` and `convertA11yKeysToHtmlFormat(a11y)` according to [`ACCESSIBILITY.md`](ACCESSIBILITY.md).

## Pre-Fix Checks for Adding Button Semantics to a Non-Interactive Element

Before adding `role="button"`, `tabIndex`, and keyboard handlers to an element such as `<div>`, verify all four conditions below.

### 1. Interactive Children

Check whether the element conditionally or unconditionally contains `<a>`, `<button>`, `<input>`, `<Link>`, or a component that resolves to an interactive element. Button semantics on the parent would create nested interaction.

If interactive children are possible, either exclude that branch from the parent's interaction condition or use a separate control element.

### 2. Existing Focus Management

Check whether the element already receives `tabIndex` from another source, such as `getTabIndexAttribute`, an a11y prop spread, or an interactions framework. Determine the prop merge order and keep one source authoritative.

When an existing a11y spread should win, place the conditional interaction spread before it so `tabIndex: 0` only acts as a fallback.

### 3. Interaction Condition

Read the full boolean expression that enables interaction. Verify that it:

- excludes states that already render an interactive child
- excludes editor preview, externally controlled, disabled, or reduced-motion states when required
- uses explicit comparisons such as `=== undefined` or `=== true` when `true`, `false`, and `undefined` have different meanings

Fix a fragile condition as part of the accessibility change. Correct semantics attached to the wrong state are still incorrect behavior.

### 4. Accessible Name Scope

Decide whether an accessible label names the interaction or the component as a whole. Keep a component-level label outside the interaction condition so it persists in non-interactive states. Apply an action-specific label only while that action is available.

## After Fixing

Re-run both scanners on changed `.tsx` / `.jsx` files. Continue with `npx wix build`, `npx wix generate manifest`, and the project's TypeScript check as required by [`A11Y-REVIEW.md`](A11Y-REVIEW.md#phase-5-verify).
