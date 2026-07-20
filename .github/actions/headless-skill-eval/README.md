# headless-skill-eval

Advisory GitHub Action: on a PR touching `skills/wix-headless/**`, run the EvalForge
scenarios **mapped to the changed files** (dry-run always; e2e only under a `run-e2e`
label), against a **branch-pinned** copy of the skill, then post a PR comment.

## Flow
diff changed files → `headless-eval-map.yaml` resolves them to scenario tags →
create/reuse a `wix-headless-entry` version whose install line targets
`github.com/<repo>/tree/<branch>` → one EvalForge run per selected scenario pinned to
it → poll → PR comment. Nothing blocks the merge.

## Files
- `headless-eval-map.yaml` — the file→tag map (**edit this** as scenarios/verticals change)
- `src/` — TS (`resolve.ts`, `evalforge.ts`, `comment.ts`, `index.ts`); build with `npm run build` (ncc → `dist/index.js`)
- `action.yml` — node20 action entry

## Required repo config (Settings → Actions)
Variables: `HEADLESS_EVALFORGE_URL` (`https://bo.wix.com/_api/evalforge-backend`),
`HEADLESS_EVALFORGE_PROJECT_ID` (`cd479f00-…`), `HEADLESS_EVALFORGE_AGENT_ID`
(`4a3df44f-…`, claude-code-opus-4-6), `HEADLESS_EVALFORGE_ENTRY_CAP_ID` (`f5c7581b-…`).
Secrets: `HEADLESS_EVALFORGE_APP_ID`, `HEADLESS_EVALFORGE_APP_SECRET`.
The EvalForge app needs an AI Gateway budget (Prompt Hub) or runs 404.

## Editing the map
Globs → `{ dryRun, e2e }` tags (union across matches). `dryRun: ["*"]` = whole dry-run
suite (broad-impact files). e2e tags run only with the `run-e2e` label, trimmed
cheapest-first to `e2e.budgetUsd`. Unmatched files fall back to the whole dry-run suite.

## Rebuild after editing `src/`
`npm install && npm run build` (commits `dist/index.js`).

_Branch-install path confirmed via POC: a run pinned to a `.../tree/<branch>`-rewritten
entry version had the agent execute `npx skills@latest add https://github.com/wix/skills/tree/<branch>`
and judge correctly. (The inline `content.files` override is load-bearing — the wrong
`content.skillContent.files` shape is dropped and silently falls back to the published skill.)_
