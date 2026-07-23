# headless-skill-eval

Advisory GitHub Action: on a PR touching `skills/wix-headless/**`, run the EvalForge
scenarios **mapped to the changed files** — the cheap dry-run decisions **and** the e2e
builds for the touched verticals both run — against a **branch-pinned** copy of the
skill, then post a PR comment. Adding the **`run-e2e-all`** label widens e2e to the full
set (all verticals) instead of just the touched ones.

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
Globs → `{ dryRun, e2e }` tags (union across all matching rules). No `"*"`/whole-suite and
no fallback — a file that matches no rule contributes nothing (keep the map complete).
Scenarios carry **granular** tags the map keys on — verticals (`hs-dr-cms`, `hs-dr-events`,
…) and topics (`hs-dr-imagery`, `hs-dr-framework`, `hs-dr-release`, `hs-dr-projecttype`,
`hs-dr-operation`, `hs-dr-routing`, `hs-dr-arch`) — plus the coarser family/intent tags
(`hs-dr-intra`, `hs-dr-gates`, …) kept for humans and manual runs. Dry-run + mapped e2e
always run; `run-e2e-all` swaps the mapped e2e for `e2e.allTags`.

## Rebuild after editing `src/`
`npm install && npm run build` (commits `dist/index.js`).

_Branch-install path confirmed via POC: a run pinned to a `.../tree/<branch>`-rewritten
entry version had the agent execute `npx skills@latest add https://github.com/wix/skills/tree/<branch>`
and judge correctly. (The inline `content.files` override is load-bearing — the wrong
`content.skillContent.files` shape is dropped and silently falls back to the published skill.)_
