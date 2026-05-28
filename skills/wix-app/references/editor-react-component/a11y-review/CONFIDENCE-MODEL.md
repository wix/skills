# Confidence Model

## Tier 0 (ESLint) Findings

ESLint findings do not carry a confidence level from the scanner. During the triage step, assign confidence based on the flagged element:

- **Native element** (`div`, `img`, `a`, `button`, etc.): treat as `high` confidence. The rule sees the actual semantic element.
- **Custom component that resolves to a known native element** (confirmed via Tier 1 scan or by reading the source): treat as `medium` confidence.
- **Custom component that cannot be resolved** or whose semantics are delegated through runtime props/spread: evaluate for `false-positive` or `not-relevant`. If neither applies, treat as `low` confidence.

After assigning confidence, apply the same fix eligibility rules as Tier 1 findings below.

---

## Tier 1 (Custom Scanner) and Tier 2 (Manual) Findings

## High

Use high confidence when:

- the element is a native tag
- a local or package component clearly resolves to a native semantic element
- a polymorphic prop explicitly sets a native semantic element

High-confidence findings can be presented as definite issues.

**Fix eligibility**: Fix immediately. No confirmation needed.

## Medium

Use medium confidence when:

- props strongly imply semantics
- a wrapper only partially resolves but still preserves likely semantics
- the component name and surrounding evidence strongly agree

Medium-confidence findings can be presented as likely issues, but the code should still be read before applying a fix.

**Fix eligibility**: Fix after reading the surrounding code to confirm the semantic inference is correct. If confirmed, fix without asking. If the code contradicts the inference, skip the fix and report the finding as unresolved.

## Low

Use low confidence when:

- only weak heuristics support the semantic guess
- the implementation cannot be resolved
- the component might be semantic but the evidence is thin

Low-confidence matches are not definite violations. Treat them as leads for manual review.

**Fix eligibility**: Read the code and attempt to resolve the semantics. If the code confirms the issue, upgrade to medium or high and fix. If the semantics remain unclear, skip the fix and report the finding as advisory only.

## Confidence vs. Actionability

Confidence answers "is this issue real?" It does not answer "is this issue important enough to fix?"

Use this decision rule after reading the code:

- Confirmed + safe/local fix => fix now.
- Confirmed + risky behavior change or non-local refactor => report as unresolved with the exact blocker.
- Unconfirmed or ambiguous => advisory only.

If you can see the violation in the code and describe a localized, behavior-preserving fix, treat it as confirmed and fix it.

## Valid Reasons to Skip a Fix

Only skip a fix when one of these is true:

- the semantics remain ambiguous after reading the code
- product intent cannot be derived from the code
- the fix would require a risky behavior change or a non-local refactor

## Invalid Reasons to Skip a Fix

Never skip a confirmed finding for any of these reasons:

- it seems low severity
- it is a secondary or convenience interaction
- it lives in a shared layer, wrapper, or component-library file
- it is outside the main component file or package the user first mentioned
- it is probably intentional without code evidence proving that intent
