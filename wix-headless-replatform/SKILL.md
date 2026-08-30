---
name: wix-headless-replatform
description: Clone, rebuild, migrate, or reverse-engineer a public website home page into a Wix Headless frontend while preserving source identity, SEO, interactions, and visual fidelity.
---

# wix-headless-replatform

## Role

Drive a close-enough, visually polished Wix Headless frontend from a source website.
The implemented scope is one resolved home page and the default output is
`projects/<project-name>`, derived from the hostname. Use Wix CLI Headless, Astro,
TypeScript, and Tailwind; use React only for complex interactive islands.
Reject additional-page and explicit-URL scope with an actionable explanation until a later
approved workflow defines page resolution and shared evidence across routes.

This entry skill is the supervisor. It decides the next workflow stage and loads only the
resource for that stage. Do not preload every resource or reference: stage-specific rules
are deliberately demand-loaded.

Two modes exist:

- **Standalone clone:** source URL to a new, real Wix CLI Headless project.
- **Migration phase:** `--handoff <migration-project>/website/handoff.json` continues on
  the migration-owned destination. Never omit `--handoff` for an integrated migration:
  the standalone command creates a second site.

## Non-negotiable invariants

- Treat the requested public branded homepage as authorized; apply the boundaries in
  `references/safety.md` without asking a separate routine authorization question.
- Browser-backed extraction is mandatory. Do not substitute HTML-only extraction.
- Resolve the home page before capture. Build only from a validated frozen extraction
  manifest; raw observations are never builder inputs.
- A standalone output must be a successful Wix CLI scaffold with valid Wix identity and
  runnable `dev` and `build` scripts. Never hand-create a Wix-shaped substitute.
- In migration mode, reuse the handoff's site/project and route/data-binding intent; do
  not create or retarget a second destination.
- Preserve source structure, first-viewport evidence, chrome hierarchy, source assets,
  fonts, core interactions, SEO, internal URL behavior, and branded fallback behavior.
- A build is not completion. Completion requires the accepted post-build visual-review and
  gap-loop evidence described by `rp-qa-gap-loop`, plus optional facelift acceptance only
  when the user explicitly selected facelift mode.

## Supervisor protocol

On every new or resumed run:

1. Resolve the source URL, output directory, and mode. In migration mode read
   `website/handoff.json` and `docs/site-clone/frontend-automation-state.json` first.
2. Select the first incomplete stage from the table below and read only that resource's
   `SKILL.md` plus the references it explicitly needs.
3. Execute that stage until it writes its required durable artifact, or records a specific
   genuine blocker with evidence and an exact unblock action.
4. Re-select the stage after every boundary. Do not say that a required next step “needs to
   happen” and end the run; load its resource and perform it.

| Stage | Load only when | Resource | Durable outcome |
| --- | --- | --- | --- |
| Context | mode, scope, project, or browser environment is unresolved | `resources/rp-project-context/SKILL.md` | valid context, approval record, runnable project/plan state, or blocker |
| Evidence | frozen home-page extraction is absent or stale | `resources/rp-source-evidence/SKILL.md` | validated `extraction/latest.json` and frozen manifest, or global blocker |
| Implementation | frozen build plan exists and home UI is incomplete | `resources/rp-ui-implementation/SKILL.md` | manifest-hash-aware runnable home implementation |
| Verify and improve | build, QA, comparison, review, fix, report, release, or receipt is incomplete | `resources/rp-qa-gap-loop/SKILL.md` | accepted result, `done_with_gaps`, or global blocker |
| Optional facelift | normal clone accepted and automation state says facelift is requested | `resources/rp-facelift/SKILL.md` | accepted facelift review, or blocker |

When `frontendPhase.allowedNow` is `plan`, complete only the plan-eligible context and
evidence work and leave a resumable plan-state record. When it is `build`, continue through
implementation and verification against the migration-owned project.

## One-click continuation

A migration handoff declaring `automationMode: "one_click"` authorizes routine scope and
frontend checkpoints. Record those approvals in
`docs/site-clone/frontend-automation-state.json`; do not pause to ask whether to proceed
with a required stage, screenshot review, or authorized gap-fix pass.
An explicit facelift request may be carried from 1-click intake, but it remains gated until
normal clone acceptance; 1-click never implies facelift by itself.

In a one-click build run, keep selecting and executing stages until one of these durable
outcomes exists:

- `website/completion.json` is valid and the latest visual review is complete with no open
  critical/high identity finding; or
- five visual gap cycles have been completed and `website/completion.json` records the
  truthful terminal status `done_with_gaps` with the final reviewed evidence; or
- a genuine blocker is recorded with owner, evidence, attempted recovery, and exact next
  authority/action needed.

An owned local extraction gap is not a genuine blocker. Continue unrelated work, use no more
than two distinct targeted recovery attempts, then build the affected dependency closure
provisionally and surface post-assembly choices in `final-report.json` and `.md`.

Before classifying a shell, browser, or network failure as a blocker, use the
repo-local Wix/Yarn toolchain PATH ordering and follow the recovery order in
`resources/rp-project-context/SKILL.md`: aligned-shell retry, then the
required browser/network escalation and retry, then blocker only if it still
fails or approval is pending. After every gap iteration, immediately return to
the stage table; never treat a first build, a reported plan, or backend import
as frontend completion.

## Commands

Run `node scripts/site-clone.mjs <source-url>` for standalone mode, or
`node scripts/site-clone.mjs <source-url> --handoff <path>` for migration mode. The active
resource gives the exact commands and inputs for its stage.

## References

Resources load their own references. The shared contracts are kept under `references/`:
`safety.md`, `workflow.md`, `extraction-schema.md`, `output-contract.md`,
`qa-checklist.md`, and the interaction/layout/control/normalization/gap contracts.
