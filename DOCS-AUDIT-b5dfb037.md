# Docs audit — a clean run that still paid 15 forbidden lookups

**Session** `b5dfb037-07ad-45d1-bc25-d1f3636f4fcb` · **App** `8449225d-40c0-4bfe-8b53-d0a287ff8e8c` (`my-site-21`)
**Ran** 2026-09-06 17:07 UTC · **Harness** headless `claude -p` · **Model** `claude-sonnet-5` · **Skill** `wix-app` at `wix/skills` HEAD `2133c187`
**Verified against** `@wix/patterns@1.462.0` · `@wix/design-system@1.316.0` · `@wix/bex-core@2.368.0` · `react-hook-form@7.86.0` · `typescript@5.9.3`

| Metric | Value | Note |
|---|---:|---|
| Wall clock | 7 m 44 s | headless — not comparable to the interactive c646996e run |
| Model generation | 330.7 s (71.3 %) | 58 messages, 22,635 thinking tokens |
| Unattributed | 82.7 s (17.8 %) | harness overhead between a message landing and the next dispatch |
| Tool execution | 50.6 s (10.9 %) | 98 calls — but 20.1 s of that is a chosen `sleep 20` |
| Tool execution, sleep removed | **30.5 s (6.6 %)** | the honest toolchain figure |
| tsc errors | **0** | first run in this series to typecheck clean on the first attempt |
| Build / preview / release | all clean | released app v8.0.0 |

**Prompt:** *"Build a dashboard page that lets store owners manage employee shifts. The page should have a table where each row is a shift with these fields: employee name, date and hours. The store owner must be able to add new shifts to the table."*

**Generated:** `shifts.tsx`, `App.tsx`, `ShiftsCollectionPage.tsx`, `ShiftEntityPage.tsx`, `shiftsApi.ts`, `collectionId.ts`, `dateUtils.ts`, `types.ts`, `backend/data-collections/shifts.ts` — released as app v8.0.0

**The headline is not an error this time.** The run produced correct code that compiled, built and released on
the first attempt. What it paid for instead was **finding out what the documented recipe's own symbols were**:
15 hand probes into `node_modules` — which `WIX_PATTERNS_DOCS.md:46` forbids outright — spread across the two
phases that consumed 240 s (51.7 %) of the run and 84 % of its thinking tokens.

**4 defects found across two repos** — cairo 3, wix/skills 1. All four are the same shape: a symbol the docs
*require* is invisible to every lookup path the docs *prescribe*.

Supporting reports (private artifacts): [time profile](https://claude.ai/code/artifact/e3f62c82-78bd-4c43-a7aa-f4680d587dc6) ·
[issue register](https://claude.ai/code/artifact/832d7454-e816-4308-92ea-fd5f93901421)

---

## Prior art — this closes the verification checklist in `DOCS-AUDIT-c646996e.md`

Same prompt, 3 days earlier, on the interactive harness. That audit found two TypeScript errors and 17 defects.
**This run hit zero TypeScript errors.** `npx tsc --noEmit -p .` at 17:13:53 returned clean in 2.0 s, on the first
and only attempt. Three of that audit's items are the reason:

| c646996e item | Status | Evidence in this run |
|---|---|---|
| **P0** — `tsc --noEmit <glob>` silently discards `tsconfig.json` | **shipped, works** | run used `npx tsc --noEmit -p .`; `APP_VALIDATION.md:50` now only teaches `-p .` (PR #1232) |
| **P3** — 52 doc examples omit the `fetchData` parameter type | **shipped, works** | run wrote `fetchData: async (query: OffsetQuery) =>` unprompted; 0 `fetchData: (query) =>` remain in `dist/docs`, 192 typed |
| **P7** — zero-arg `useTableCollection` example; `register` never warned about | **shipped, works** | `WIX_PATTERNS_DOCS.md:115` types the param, `:161` says "useController, never register"; run used `useController` throughout (PR #1257) |
| **P6** — invented `EntityPage.Card.Content` | **shipped** | 0 hits in `dist/docs/*.md` |
| **P2** — bare `@wix/bex-core/react` in 10 bundles | **shipped** | 0 files match in `dist/dts-bundle`; `CollectionConfigWithConditionals` inlined at `useTableCollection.d.ts:317` |
| **C2 / C3 / C6** — legacy `CollectionPage`, stubbed `UseEntityPageParams`, missing `OffsetQuery` | **shipped** | all three verified present and correct in 1.462.0 |
| **P8** — lifecycle `status` never populated in `dts-bundle/index.json` | **shipped** | 6 entries carry `status`; `PrimaryPageButton` is `deprecated` with a `statusMessage` |

Still open from that audit, re-verified today against 1.462.0 and `wix/skills` HEAD `2133c187`:

- **P1 (`strictNullChecks`)** — open. The playground `tsconfig.json` still ships `"strictNullChecks": false`,
  unchanged since the initial commit `540d52b`, so it is the CLI template default and the decision still needs an owner.
- **P4 (WDS `min`/`max` narrower than the DOM)** — open. `Input.types.d.ts:7-8` still declares
  `MinValue = number | undefined`; `minLength` is still undeclared while `maxLength` is (`:50`).
- **P5 (`CODE_QUALITY.md` asserts a 5-flag bar)** — **in flight.** `CODE_QUALITY.md:7` is still unchanged on
  `main` (2 of the 5 flags are explicitly `false` in the project tsconfig), but open PR
  [wix/skills#1250](https://github.com/wix/skills/pull/1250) — *"make the compiler bar the project's own
  tsconfig"* — is exactly this fix. No new PR needed; review that one.
- **P9 (docs-side status banner)** — open, and it is the successor to P8 above. `dist/docs/index.json` has
  **0** entries carrying a `status` key and `PrimaryPageButton.md` has no banner, so an agent that follows the
  prescribed path — resolve the name in `docs/index.json`, read the `.md` — never learns the component is deprecated.
  The bundle knows; the doc does not.
- **S4 (the lookup rule dead-ends)** — open, and **this run is the evidence it needs**. Promoted to **P3** below.

---

## Action items, by priority

Ranked by consequence, not effort. Nothing here let a defect reach production this run — the code was correct.
P0 and P1 are ranked first because each retires a whole class of defect rather than one instance.

| P | Item | Repo | File | Status |
|---|---|---|---|---|
| P0 | `symbols` aliasing structurally cannot see a symbol documented only in prose | cairo | `scripts/generate-component-docs.ts:1106-1128` | **PR [cairo#5847](https://github.com/wix-private/cairo/pull/5847)** (draft) |
| P1 | The doc type-check gate excludes 44 fenced examples it calls "the copy surface" | cairo | `tsconfig.docs-consumer.json:28` | **PR [cairo#5848](https://github.com/wix-private/cairo/pull/5848)** (draft) |
| P2 | The CLI-app bootstrap example is fenced `jsx` and untyped, in 3 places | cairo | `docs/WixPatternsProvider/usage.md:48` +2 | **PR [cairo#5848](https://github.com/wix-private/cairo/pull/5848)** (draft) |
| P3 | The lookup rule forbids the only path left when a required symbol is unindexed | wix/skills | `references/WIX_PATTERNS_DOCS.md:46,138` | **PR [wix/skills#1261](https://github.com/wix/skills/pull/1261)** (draft) |
| — | Carried forward, unchanged | cairo / wix-design-systems / wix/skills / cli template | see *Prior art* | open |

---

### The causal chain

Four decisions, in two repos, line up to make one mandatory API unfindable. No single one of them is a bug.

1. **cairo publishes the recipe in prose.** `dist/docs/WixPatternsProvider.md:67-70` states that a routing page
   which omits `withDashboard` **throws at render time**, and that neither type checking nor bundling reports it.
   `dist/docs/PatternsReactRouter.md:22-35` says the same from the router's side. Both then give the Wix CLI
   variant: read `location` from the dashboard SDK yourself.
2. **The symbol never enters an index.** `withDashboard` is not a key in `dist/docs/index.json` (167 entries),
   is not in any entry's `symbols` list (only 4 of 167 carry one at all), is absent from
   `dist/dts-bundle/index.json` (96 entries), and **no file in `dist/dts-bundle` mentions it**. It exists as a
   public export only in `dist/types/index.d.ts:158`, re-exported from `@wix/bex-core/react`.
3. **The examples are untyped.** All three copies of the bootstrap are fenced ` ```jsx ` and write
   `const [location, setLocation] = useState();` — no type argument, no `PageLocation` import. An agent writing
   TypeScript cannot copy them as-is.
4. **The skill forbids the remaining path.** `WIX_PATTERNS_DOCS.md:46` — "Never inspect `node_modules` by hand —
   no `ls`, no `find`, no `cat` of an arbitrary path". `:138` — "stop and say so rather than falling back to
   `node_modules`."

The run had read both docs, at 17:07:53 and 17:08:04, in phase 01. It then broke rule 4 to satisfy rule 1:

| Window | Symbol | Probes | Outcome |
|---|---|---:|---|
| 17:08:25 → 17:10:13 | `withDashboard`, then `PageProps` | 7 | 2 returned nothing; found in `@wix/bex-core/dist/types/providers/withDashboard.d.ts` |
| 17:12:45 → 17:12:59 | `PageLocation` | 8 | 2 returned nothing (one `exit 2`); found in `@wix/dashboard/dist/types/types/observeState.d.ts` |

The run's **longest single reasoning turn — 48.6 s at 17:12:44** — sits immediately before the first
`PageLocation` probe. It is followed by the correct answer: `shifts.tsx` was edited at 17:13:50 to
`import { dashboard, type PageLocation } from '@wix/dashboard'`, subscribe with `dashboard.observeState`, and
render `{location ? <App location={location} /> : null}` — the documented recipe, typed, which the docs
themselves do not show.

**The defect is not that the agent got it wrong. It is that getting it right required disobeying the skill.**

---

### P0 — `symbols` aliasing structurally cannot see a symbol documented only in prose

**`cairo`** · `packages/cairo/scripts/generate-component-docs.ts:1106-1128`

`docs/index.json` already has the exact mechanism this needs. Four entries carry a `symbols` array that maps an
export to a doc whose title differs from it — `ExportTo.md` documents `ExportButton`, `AI Assistant.md`
documents `createAiAssistant`. `WIX_PATTERNS_DOCS.md:140` teaches agents to use it.

But the candidate list is built from exactly two sources:

```ts
// generate-component-docs.ts:1110-1113
const candidates = [
  parsed?.displayName,
  resolvedComp ? path.basename(resolvedComp, path.extname(resolvedComp)) : '',
]
```

— the docgen display name, and the component's own file basename. A symbol that appears only in the *body* of a
doc can never be a candidate, however many times the prose names it. `withDashboard` is named 7 times across
`WixPatternsProvider.md` and `PatternsReactRouter.md` and is reachable from neither.

**Fix:** add a third candidate source — the imports named in the doc's own fenced blocks
(`import { X } from '@wix/patterns'`) — or a small explicit alias map for the handful of prose-only exports.
Either turns `withDashboard` into a one-`Read` lookup.

**Verify:** `python3 -c "import json;d=json.load(open('dist/docs/index.json'));print('withDashboard' in {s for v in d.values() for s in v.get('symbols',[])})"` → must print `True`.

**Related:** `scripts/dts-bundle/entries.ts` seeds `ENTRIES` only from "names actually named in one of those
guides" (`:5-10`). `withDashboard` appears in the wix-app skill exactly once, inside a *negative* instruction
(`DASHBOARD_PAGE.md:69`), so the seeding rule read it as not-a-name. Adding
`{ name: 'withDashboard', kind: 'function', reExportedFrom: '@wix/bex-core' }` would close the bundle side too,
but the docs index is the cheaper and more general fix.

---

### P1 — The doc type-check gate excludes 44 fenced examples it calls "the copy surface"

**`cairo`** · `packages/cairo/tsconfig.docs-consumer.json:28` · `scripts/type-check-docs-consumer.ts`

`type-check-docs-consumer.ts` is a good piece of work and its header comment is exactly right about why it
exists: `wix generate`'s template ships `strictNullChecks: false`, `tsconfig.tests.json` checks with the flag on,
so CI "structurally cannot see a defect that exists only in the configuration every consumer actually has. That
is how untyped `fetchData: (query) =>` params survived review."

It then scopes itself:

```jsonc
// tsconfig.docs-consumer.json:28
"include": ["./docs/**/examples/**/*"]
```

with the comment *"Scoped to `examples` because that is the copy surface."* That premise is false by a
measurable margin:

```
$ grep -rln -e '```jsx' -e '```tsx' docs --include='*.md' | grep -v '/examples/' | wc -l
23
$ grep -rn -e '```jsx' -e '```tsx' docs --include='*.md' | grep -v '/examples/' | wc -l
44          # of which 33 are ```jsx — untyped by construction
```

23 Markdown files outside `examples/` carry 44 fenced React examples, and they are copied: they are what
`docs/index.json` resolves a name to, and reading the `.md` whole is precisely what `WIX_PATTERNS_DOCS.md:141`
instructs. The gate that exists to protect the copy surface does not cover most of it.

**Fix:** extract fenced `jsx`/`tsx` blocks from `docs/**/*.md` into a generated temp directory during
`docs:gen` and add it to the `include`, so the same gate that caught the `fetchData` class catches this one.
The `jsx` fences will need converting or annotating first — which is P2.

---

### P2 — The CLI-app bootstrap example is fenced `jsx` and untyped, in three places

**`cairo`** · `docs/WixPatternsProvider/usage.md:48` · `docs/Router/RoutingOverview.md:125` · `docs/Router/router-description.md:64`

All three carry the same line:

```jsx
const [location, setLocation] = useState();
```

with no type argument and no `PageLocation` import anywhere in the block. `useState()` with no argument
infers `undefined`, not `any`, so the setter's parameter type becomes `(prevState: undefined) => undefined` and
the example **does not compile for anyone who copies it** — measured, one `TS2345` per site:

```
docs/WixPatternsProvider/usage.md:52  TS2345: Argument of type 'PageLocation' is not
  assignable to parameter of type '(prevState: undefined) => undefined'.
docs/Router/RoutingOverview.md:129    TS2345: (same)
docs/Router/router-description.md:68  TS2345: (same)
```

That is a harder finding than the one drafted first (see *Corrections*): the documented bootstrap is not merely
loosely typed, it is broken as written, and every reader has to repair it — which is exactly what run b5dfb037
spent its probes doing.

This is the same defect class as the shipped **P3** from `DOCS-AUDIT-c646996e.md` (52 untyped `fetchData`
params). That fix landed inside `docs/**/examples/`; these three sites were out of its reach for exactly the
reason P1 describes.

**Fix**, matching what the run itself worked out and shipped:

```tsx
import { dashboard, type PageLocation } from '@wix/dashboard';
// ...
const [location, setLocation] = useState<PageLocation>();
```

and change the fence from `jsx` to `tsx` so P1's gate will hold it.

---

### Found while building the P1 fix — three more, all in cairo

Turning the gate on surfaced defects that no audit read of the docs would have found. They ship with **P1**
(#5848) rather than as separate items.

**P1a — a syntactically broken example silently suppresses the semantic pass for every other file.** Verified
against the *existing* `type-check:docs-consumer` by planting two files in `docs/CollectionPage/examples/`:

```
run A — a real type error alone:
  1 doc example error(s): __zz_typeerror.tsx(3,9): error TS2322: Type 'string' is
    not assignable to type 'number'.

run B — the same file, plus one malformed example beside it:
  1 doc example error(s): __zz_syntax.tsx(2,1): error TS1109: Expression expected.
```

The `TS2322` disappears and the count reports 1 when there are 2. CI still goes red, so this is a reporting
defect rather than a fail-open — but an author who fixes the reported syntax error believes they are finished.
The new gate reports syntactic diagnostics separately and says the semantic counts are untrustworthy until they
clear. The existing gate still has this behaviour; **filed as a follow-up, not fixed in #5848.**

**P1b — a shipping typo in a copyable example.** `docs/MultiLevelSorting/API.md:50` read
`import { Table } form '@wix/patterns';` — `form`, not `from`. Fixed in #5848. It had never been compiled by
anything.

**P1c — `tsconfig.scripts.json` sets no `target`.** It therefore defaults to ES5, where a `for…of` over a
`matchAll` iterator compiles to an index loop that finds `length === undefined` and **runs zero times, silently**.
The first version of the fence extractor reported "0 fenced examples" for exactly this reason, with no error.
Both new scripts use `exec` loops instead, and the P0 harvester was hardened the same way even though it runs
under a config that sets `target: es2019`. Adding a `target` to `tsconfig.scripts.json` would retire the class
for every script under it — **filed, not fixed**, because it touches all of them.

**Scale correction:** 44 fenced blocks, not 39 — the first count used a regex that missed indented fences inside
list items. Of the 44, 39 are compiled and 5 are genuinely not modules (a bare signature, an elided
`<MoreActions ... />`, three function-body fragments) and now opt out explicitly.

---

### P3 — The lookup rule forbids the only path left when a required symbol is unindexed

**`wix/skills`** · `skills/wix-app/references/WIX_PATTERNS_DOCS.md:46,138` · `references/DASHBOARD_PAGE.md:69`

Two rules, both good in the general case:

- `:46` — "**Never inspect `node_modules` by hand** — no `ls`, no `find`, no `cat` of an arbitrary path, and that
  includes the sanctioned directories."
- `:138` — "If a name you need genuinely isn't there, **stop and say so rather than falling back to
  `node_modules`.**"

Followed literally on this task, the agent would have stopped and reported that `withDashboard` is not covered —
and produced a page that throws at render time, with a clean `tsc` and a clean build to reassure everyone. It
disobeyed instead, made 15 probes, and shipped working code. A rule whose correct outcome is worse than its
violation needs an escape hatch.

Compounding it: the skill names `withDashboard` **once**, at `DASHBOARD_PAGE.md:69`, inside a negative
instruction warning against hand-rolling page location — and never teaches the bootstrap positively, though
cairo's docs are unambiguous that every routed CLI dashboard page needs it. The skill's only mention of the
right answer is a warning about the wrong one.

**Collision warning.** Open PR [wix/skills#1247](https://github.com/wix/skills/pull/1247) — *"dashboard-page
skill fixes + template-first draft template"* — already edits `references/DASHBOARD_PAGE.md` along with seven
other dashboard-page references. Part 1 below touches the same file. Either fold it into #1247 or rebase onto it
after it lands; opening a competing PR against that file wastes a reviewer's time.

**Fix, two parts:**

1. Teach the bootstrap in `DASHBOARD_PAGE.md` with the typed snippet above, so it is reachable from the skill
   without a `@wix/patterns` doc lookup at all.
2. Give `:138` an escape clause: if a name the docs themselves require is missing from both indexes, read its
   declaration and **report the gap as a finding**, rather than stopping. The report is what feeds this audit
   loop; silent compliance produces neither the code nor the signal.

---

## Corrections to this audit's own first read

Four claims did not survive contact with the source. They are recorded so the next run does not re-derive them.

0. **"The untyped `useState()` infers `any` and compiles silently."** False, and it made the finding weaker
   than it is. `useState()` with no argument infers `undefined`, so the setter is
   `(prevState: undefined) => undefined` and passing a `PageLocation` to it is a `TS2345` — measured, three of
   them, one per site. The documented bootstrap does not compile for anyone who copies it. This only came out by
   running the widened gate with and without the fix (51 → 48 actionable diagnostics); reading the docs would
   never have shown it.
1. **"cairo doesn't document `withDashboard`."** False, and backwards. `dist/docs/WixPatternsProvider.md:67-70`
   and `PatternsReactRouter.md:22-35` document it thoroughly, including the render-time throw and the CLI-app
   variant — better than most of the surrounding docs. The defect is indexing, not authorship.
2. **"The run shipped a broken page — `App.tsx` never receives a `location`."** False. `App.tsx` alone does not,
   but the run edited the scaffolded `shifts.tsx` at 17:13:50 to subscribe via `dashboard.observeState` and pass
   `location` down. The page is correct. Reading only the files the run *created* and not the one it *edited*
   produced the error.
3. **"The `PageLocation` chase was wasted work — the final code doesn't use it."** False, and the same mistake:
   the type is used in `shifts.tsx`, which was an `Edit`, not a `Write`, so it was absent from the recovered
   write set.
4. **"`withDashboard` is missing because cairo's `entries.ts` curates by hand."** True but not the operative
   cause. The docs index — not the dts-bundle — is the path `WIX_PATTERNS_DOCS.md` sends agents down first, and
   its `symbols` mechanism fails for a structural reason (P0) rather than a curation one. Fixing `entries.ts`
   alone would have left the primary lookup path broken.

---

## Verification for the next run

Close these against a fresh run of the same prompt:

| Check | Passes when |
|---|---|
| P0 shipped | `withDashboard` resolves in `dist/docs/index.json` via a `symbols` entry |
| P1 shipped | `tsconfig.docs-consumer.json` includes generated fences; `yarn docs:type-check` reports on them |
| P2 shipped | all three sites read `useState<PageLocation>()` and fence as `tsx` |
| P3 shipped | `DASHBOARD_PAGE.md` carries the typed bootstrap; the run writes it without opening a patterns doc |
| The measurement | 0 hand probes into `node_modules`; phases 04+05 below 240 s |
| Regression guard | `tsc` still clean on the first attempt; `useController` still used over `register` |
| P1a follow-up | the existing `type-check:docs-consumer` separates syntactic from semantic diagnostics |
| P1c follow-up | `tsconfig.scripts.json` declares a `target`, so no script silently no-ops on an iterator |

Carried forward and still needing an owner: **P1 `strictNullChecks`** (cli template vs cairo core),
**P4** WDS `min`/`max`, **P5** `CODE_QUALITY.md`'s 5-flag claim, **P9** the docs-side status banner.

---

## Appendix — where the time went

Full profile: [time profile artifact](https://claude.ai/code/artifact/e3f62c82-78bd-4c43-a7aa-f4680d587dc6).

| # | Phase | Wall | Model gen | Tool | Unattr. | Calls | Think tok |
|---:|---|---:|---:|---:|---:|---:|---:|
| 01 | Load skill + patterns docs recon | 92 s | 57.5 s | 5.4 s | 29.1 s | 41 | 3,166 |
| 02 | WDS component lookup | 10 s | 8.0 s | 0.4 s | 1.5 s | 3 | 151 |
| 03 | Scaffold via `wix generate` | 14 s | 5.1 s | 3.0 s | 5.8 s | 6 | 160 |
| 04 | **Author collection + chase `withDashboard`** | **139 s** | 128.8 s | 0.6 s | 9.7 s | 17 | **10,626** |
| 05 | **WDS + EntityPage docs + chase `PageLocation`** | **101 s** | 93.1 s | 0.8 s | 7.1 s | 16 | **8,443** |
| 06 | Write the 7 page files | 49 s | 22.7 s | 0.1 s | 26.1 s | 8 | 0 |
| 07 | `tsc --noEmit` · clean | 3 s | 0.9 s | 2.0 s | 0.0 s | 1 | 0 |
| 08 | `wix build` | 12 s | 2.7 s | 9.0 s | 0.3 s | 1 | 0 |
| 09 | `wix preview` · incl. `sleep 20` | 29 s | 6.9 s | 20.2 s | 1.9 s | 4 | 89 |
| 10 | `wix release --version-type major` | 15 s | 5.0 s | 9.1 s | 0.9 s | 1 | 0 |
| | **Total** | **464 s** | 330.7 s | 50.6 s | 82.7 s | 98 | 22,635 |

Honesty notes, all of which change a number a reader would otherwise trust:

- **The `sleep 20` is 40 % of the tool column.** Phase 09's 20.1 s is a fixed sleep the agent chose after
  backgrounding `wix preview`, not time the CLI took. Real toolchain work is 30.5 s — **6.6 %** of the run.
  Every actual Wix command is fast: `release` 9.1 s, `build` 9.0 s, `tsc` 2.0 s, both `generate` calls 3.0 s together.
- **"Model generation" bundles API latency** with reasoning and streaming. Treat 330.7 s as an upper bound on
  reasoning, not a measurement of it.
- **Unattributed time is kept separate** rather than folded into the model's column, which would overstate model
  time by ~17 %.
- **Token counts are deduped by message id** — a turn with N parallel tool calls writes N rows carrying one usage object.
- **Model named:** `claude-sonnet-5` across all 58 assistant messages. Not comparable to a run on another model.
- **Headless run**, so the unattributed bucket would shift under an interactive harness. Window
  17:07:08 → 17:14:52, idle excluded.
- **Release included.** Phase 10 cut a real major version (v8.0.0), required by the data-collection change.
  Runs stopping after preview are 15 s shorter and not comparable.

### One operational note

The tree left two **empty** directories behind — `src/extensions/dashboard/pages/shifts/` and
`src/extensions/backend/data-collections/` — invisible to both `git status` and `find -type f`. The next
`wix generate` for either route will fail with *"The page route must be unique"*. Clear them with
`find src/extensions -type d -empty -delete` before the next run.
