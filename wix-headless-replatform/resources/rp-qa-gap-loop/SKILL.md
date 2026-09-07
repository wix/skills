---
name: rp-qa-gap-loop
description: Verify the running clone, perform auditable visual comparison and gap fixes, and finalize frontend completion.
---

# QA and visual gap loop

Load this resource only when a runnable clone requires build/QA, result extraction,
visual-review, gap fixing, release, or the migration completion receipt. It owns the
terminal frontend acceptance loop.

Read `references/qa-checklist.md`, `references/post-build-gap-contract.md`, and
`references/output-contract.md`.

Build the project; fix build errors and rerun. Validate local font declarations, internal
links/fallback behavior, SEO, control states, UI-normalization assertions, and every core
scene with browser-backed interaction QA before comparison.

Read `extraction/latest.json`, the frozen manifest, `build/section-implementation.json`, and
unit acceptance fields before QA. Attribute every finding to the smallest owning unit and its
spec hash. A local missing-evidence or low-confidence gap does not block unrelated QA or the
assembled home page.

Start the clone and run `post-build-gap.mjs --result-url <local-url>`. It re-extracts every
in-scope result route through the same pipeline as the source, but reads the immutable original
source analysis directly from `docs/site-clone/`; normal gap iterations must not recapture or
copy a `source-snapshot`. Inspect every source/result screenshot pair in `gap-analysis/latest.json`. Write the canonical
iteration's `visual-review.json` with one complete record per pair: matching `pairId` and
viewport, a non-empty observation, and either linked canonical findings or a non-empty
no-identity-gap rationale. Run `finalize-gap-review.mjs`; do not use a flag or prose claim
as a substitute for inspection evidence.

Fix findings in contract order: missing structure/text/media, composition and important
dimensions, core interactions, then supporting polish. Before a fix batch, name the target
section(s), expected visible change, and exact screenshot pair(s). Rebuild, re-extract, and
create a new immutable iteration. If the prior iteration had critical/high findings, complete
the generated `visual-progress.json`: for every prior blocking finding, link the canonical
source screenshot, prior result screenshot, current result screenshot, and a before/after
observation. Keep an implementation change only when that evidence says `improved`; report
`no-visible-improvement` or `regressed` truthfully and rediagnose. After two no-visible-
improvement attempts for the same section, stop repeating the same tactic. The extraction-gap
budget is also at most two distinct targeted attempts; repeating a tactic without new evidence
is not progress. After exhaustion, preserve the affected unit as provisional and continue.
Scores, finding counts, and changed code are not evidence
of visual progress. In manual/standalone work, use at most two fix passes by default and
report accepted residual medium/low findings. In migration `one_click` build work, continue automatically
until no critical/high identity findings remain, a genuine blocker is durable, or five visual gap cycles have completed.
At the five-cycle cap, finalize the fifth reviewed iteration and write a `done_with_gaps` completion receipt when blockers remain;
do not create a sixth cycle or claim acceptance.

Before stopping a one-click run for shell/browser/network failure, use the context
resource's aligned-shell and escalation retry policy. If the automation state requests a
facelift, return to the root supervisor after normal clone acceptance; it must load the
separate facelift resource before any final receipt. Otherwise, on accepted migration
completion, write `website/completion.json` with `finalize-migration-website.mjs --handoff ...
--release-url ...`. Backend import or the first successful build never authorizes that
receipt. If completion cannot proceed, record a blocked receipt with evidence, attempted
recovery, owner, and exact unblock action, then return control to the root supervisor.

Generate `final-report.json` and `.md`. For every unresolved or user-accepted gap include the
unit/location, unavailable fact and reason, evidence/confidence/attempts, provisional
implementation, assumptions/omissions, affected checks/dependents, and choices to accept,
retry/fix, provide material, replace, omit, or leave unresolved. Remaining local gaps produce
`done_with_gaps`; only a global blocker produces blocked.
