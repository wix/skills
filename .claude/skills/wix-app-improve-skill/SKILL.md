---
name: wix-app-improve-skill
description: Improve this repo's `wix-app` skill content — trim redundancy, rightsize oversized files, fix or extend `skills/wix-app/SKILL.md` and `skills/wix-app/references/**`, verify the change is actually correct (not just that it lints), and open a PR for it. Use this whenever asked to edit, clean up, shrink, or fix the wix-app skill, or for "improve the wix-app skill" requests.
---

# Improve the wix-app skill

A checklist + script for changing this repo's `wix-app` skill content well: finding what's
actually worth changing, changing it without breaking a cross-reference, verifying the result
is correct rather than just well-formed, and only then opening a PR.

`CONTRIBUTING.md`, `docs/eval-scenarios.md`, and `docs/skill-evaluation.md` at the repo root are
the actual wiring rules — read those for anything this skill doesn't cover. This skill exists
because those documents state the wiring rules but don't catch the failure mode of a change
that satisfies every wiring rule and still ships bad or unverified content.

## The core failure mode this exists to catch

No adding comments of what you deleted or moved — a skill doc describes the topic, not its
own edit history. That belongs in the PR description or commit message.

## Finding what's worth improving

Before adding anything, check whether the file already says it — badly:

- **The same fact or mapping stated in two places** (a checklist item and a full section both
  explaining the same lookup procedure; a "quick decision" list and a "decision flow" prose
  section restating the same extension-type mapping) is a defect, not reinforcement. Keep the
  one that's actually referenced elsewhere and cut or tighten the other.
- **A section whose every row/bullet restates a rule stated in more detail elsewhere** (an
  anti-patterns table that just repeats each checklist gate; a "tips" section repeating Step 3's
  workflow) earns nothing by existing twice. Check each row against the rest of the file before
  assuming a summary table is pulling its weight.
- **Content this skill's own job doesn't own** — e.g. `@wix/design-system` component APIs
  belong to the `wix-design-system` skill, not restated here. If something is already covered
  by a sibling skill, point to it instead of repeating it, unless what's here is genuinely
  orchestration (*when* to call the other skill) rather than that skill's own content.
- **A large pure lookup table with no decision logic** (an entity→SDK module map, a full
  permissions matrix) is the easiest thing to extract to its own reference file — a rule +
  pointer stays in `SKILL.md`, the table moves. A section that mixes a rule with a table
  usually isn't worth splitting; only pull out the part that's pure data.
- **`SKILL.md` body over ~500 lines** is a hard CI gate on any PR that touches it
  (`scripts/check-skill-md-size.mjs`, wired into the `typecheck` job) — it's always loaded once
  the skill triggers, so it's the most expensive real estate in the skill. **A reference file
  over ~300 lines with no `## Contents`** is the same skill-creator guideline, not yet CI-gated.

## Before removing or moving anything

`grep -rn '#your-anchor' skills/ yaml/ docs/ CONTRIBUTING.md` for any heading you're about to
delete, rename, or shrink — other reference files link into `SKILL.md`'s headings (e.g.
`BACKEND_API.md`, `DASHBOARD_PAGE.md`, `SITE_PLUGIN.md` all link to `#identity-and-elevation-requirement`),
and a broken anchor fails silently: no linter catches it, the link just goes nowhere. Keeping a
heading's exact text in place while shrinking only the body under it is almost always cheaper
than renaming and fixing every inbound link. This also covers a table of contents you're
adding: its own links are anchors into the same file, and a typo'd slug there is exactly as
silent as a broken inbound one — the linter only checks relative *file* links, not anchors.

## Validating the change

Do this after every edit, not just once at the end — chain into as few tool calls as you can,
but don't skip a step because the file "looks right". Steps 3 and 5 exist to catch what a
prose edit can't break: skip them only when the change touches no code fence and makes no new
API or behavior claim (a pure prose tightening, a table of contents, a typo fix).

1. **Mechanical checks, one call:**
   ```bash
   node .claude/skills/wix-app-improve-skill/scripts/check-pr-content.mjs --base=main
   ```
   Flags the size/TOC and frontmatter thresholds from "Finding what's worth improving" above,
   plus relative links that don't resolve. It deliberately does **not** check for process
   narration (see above) — that's a judgment call about what a sentence is *for*, and a fixed
   phrase list either misses new phrasings or flags a doc discussing the pattern itself (like
   this one). Read the diff for that yourself. **It's also scoped to the diff against `--base`:**
   a file identical to `main` is silently excluded, not "checked and found clean" — if you're
   validating a change that isn't committed yet, confirm the file actually shows up in the
   tool's own file count before trusting a clean result. The `SKILL.md`-over-500-lines part of
   this is also a separate, hard CI gate (`scripts/check-skill-md-size.mjs`, in the `typecheck`
   job) on any PR that touches the file — this local run just lets you catch it before pushing.
2. **Anchors, one call:** re-run the `grep -rn '#your-anchor'` search from above against the
   *new* file — confirm every heading anything still links to still exists with the same text.
3. **The repo's real CI gate for `wix-app` content, one call (when `skills/wix-app/**` changed):**
   ```bash
   cd .github/wix-app-typecheck && corepack yarn install --immutable >/dev/null 2>&1; node extract.mjs
   ```
   This extracts every fenced ` ```typescript`/` ```tsx` block and runs `tsc` with the pinned
   `yarn.lock` versions — not whatever's installed in a scratch test app. Read its output
   carefully: it deliberately treats parse errors from non-self-contained fragments as
   non-blocking and fails only on *semantic* type errors, so a run that prints a wall of
   `error TS...` lines can still exit 0 and be the correct, passing result.
4. **Any API claim you're relying on, verified against a real source, not memory — batched
   into one call, not one call per claim.** For a `@wix/patterns`/`@wix/design-system` import
   path or prop location, check the installed package directly:
   ```bash
   node -e "
   const p = JSON.parse(require('fs').readFileSync('.github/wix-app-typecheck/node_modules/@wix/patterns/dist/docs/index.json'));
   for (const name of ['usePatternsNavigate', 'SidePanel']) console.log(name, '=>', p[name]);
   "
   ```
   For a permission scope, SDK method, or REST field, use the Wix MCP docs tools instead —
   the installed package's own docs won't have those. For a manual admin-console step (a Dev
   Center toggle, a dashboard setting) there's no doc or MCP tool to check it against — that's
   also the category of thing an agent shouldn't be doing itself; the doc should tell the agent
   to have the *user* do it and report it as a manual step, not narrate the agent doing it.
5. **Live-test that the change actually works** — see "Live-testing a change" below. Steps 1-4
   only prove the doc is well-formed and compiles; they don't prove that following it produces
   a correct extension.
6. **Confirm you haven't committed anything you didn't mean to:** `git status` / `git diff`.
   Always, right before opening the PR — not just when you happen to be iterating locally.

## Live-testing a change

The linter and the typecheck harness both check that the doc's code *compiles* — neither
checks that following the doc actually produces a working extension. Before calling a change
to `skills/wix-app/**` done, confirm it by building the thing the doc now tells an agent to
build:

1. **Get a test app.** Ask the user whether they already have a Wix CLI app to test against —
   reuse it if so, since a fresh app means re-doing any one-time setup (dev site link, app
   install) every time. Otherwise scaffold one: `npm create @wix/new@latest app`.
2. **Evaluate with a subagent, not yourself.** Spawn a subagent with only the changed doc as
   context (not this whole conversation) and have it build the extension type the change
   affects, from a realistic prompt. This tests what an agent with no more context than the
   doc itself would actually do — the thing the change is meant to improve.
3. **Verify in the UI with Playwright when the change touches anything visual** (a dashboard
   page, modal, widget, or any `@wix/patterns`/`@wix/design-system` component) — a page can
   type-check and build cleanly while still rendering a component that misbehaves or a route
   that crashes on open. Reading the compiled output is not a substitute for opening it.

## Opening the PR

Only once the change is validated (API claims included — see "Validating the change" above):

1. **Placement:** new content goes into `skills/wix-app/references/` as a new or updated
   reference, or into `skills/wix-app/SKILL.md` itself — never a new top-level `skills/`
   folder (admin-only, see `CONTRIBUTING.md`).
2. **Coverage:** every `wix-app` change needs, in the same PR: the reference/`SKILL.md` edit
   itself, its `SKILL.md` index entry, and an eval scenario under `yaml/wix-app-evals/` (a
   `skill_was_called` assertion pointing at the changed reference file(s), plus an
   `llm_judge`, minimum 3 assertions total).

## What to test before trusting a change to this skill or its script

- **True positives:** run `check-pr-content.mjs` against a branch you know has a violation
  (a `SKILL.md` past 500 lines, a reference file past 300 with no `## Contents`, a broken
  relative link, a `SKILL.md` with no frontmatter or an over-limit `description`) and confirm
  each one is actually reported, at the right file and line.
- **True negatives:** run it against a clean branch and confirm it reports zero findings —
  a linter that also flags good content trains people to ignore it.
- **The CI typecheck chain:** confirm `node extract.mjs` still exits 0 on unmodified
  `wix-app` content, and exits non-zero when you deliberately introduce a real semantic type
  error (not a parse error from a placeholder) into a reference file's code example.
- **The batched API spot-check pattern:** confirm the `node -e` one-liner against
  `dist/docs/index.json` actually resolves a real symbol's `importPath`/`bundle`, so you trust
  it over a PR body's prose claim.
