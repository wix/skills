# Patterns Discovery Flow — technical plan

**Design doc:** [Patterns Discovery Flow](https://docs.google.com/document/d/1oStRU34x-ziiJffpiSGnrA_-KLr5xgKadv1E81rBsQI/edit)
**Scope:** the `@wix/patterns` discovery chain only — trigger → composition → guide → doc → example → API.
**Verified against** `cairo@1.461.0` (`packages/cairo`, branch `docs-type-fetchdata-params`) and
`wix/skills` at `fix/collection-toolkit-stale-cli` (`f8cf34ee`). Every line number below was read, not recalled.

Two repos, three phases, strictly ordered: **cairo ships → cairo releases → skill follows.**

---

## 0. What this plan changes about the design

The design is sound. Five things it assumes turn out to be wrong or underspecified once you read the
generator, and each of them would bite during implementation.

### 0.1 `relatedComponents` cannot validate against index **keys**

`dist/docs/index.json` is keyed by **`storyName`**, not by export name. Two of the names the current
hand-written tables use resolve only through the entry's optional `symbols` alias:

| Name in `COLLECTION_TOOLKIT.md` | Resolves as |
| --- | --- |
| `CollectionToolbarFilters` | `symbols` alias on `ToolbarFilters` |
| `ExportButton` | `symbols` alias on `ExportTo` |

and two more are storyNames with spaces that are not exports at all — `More Actions`,
`Sortable Columns`. A key-only validator fails the build on four names that are correct today.

**The validator must resolve against `keys ∪ symbols`.** Measured: of the 58 patterns names named
across `COLLECTION_TOOLKIT.md`, `WIX_PATTERNS_DOCS.md` and `ENTITY_PAGE_TOOLKIT.md`, **57 resolve**
in `dist/docs/index.json` under that rule — which is the evidence that the field is buildable at all.

### 0.2 The two indices disagree, and the guides live in the one the skill reads *second*

`bulkActionModal` is in `dist/docs/index.json` and **not** in `dist/dts-bundle/index.json`. More
importantly: guides are entries in `dist/docs/index.json`, but the skill today opens
`dist/dts-bundle/index.json` first and calls it "the inventory" (`SKILL.md:123-131`,
`WIX_PATTERNS_DOCS.md:135`). An agent following the current order never sees a guide.

**Phase C must flip the entry point to `dist/docs/index.json`.** That is a real behavioural change to
the skill, not a wording change, and it is the reason Phase C cannot be reduced to "replace moved
content with pointers".

### 0.3 There is no guide "contract" to add a field to

Guides are CommonJS story modules — `module.exports = { category, storyName, hideImport,
hideHeaderLinks, story: { tabs, content } }` (see `docs/Guides/nextjs/nextjs.story.ts`). No TypeScript
interface describes them. `processStory()` (`scripts/generate-component-docs.ts:382-427`) reads that
object field by field and returns a **fixed five-field shape** — `name`, `category`, `importStr`,
`componentPath`, `tabs`.

So "add an optional field to the guide contract" is **two edits, not one**: the return shape at
`:421-427` and the index entry at `:1131-1140`. The design doc names only the second.

### 0.4 The version-floor check cannot reuse the existing pattern

Today's floor is a *file-existence* probe: `ls <pkgRoot>/dist/dts-bundle/index.json`
(`WIX_PATTERNS_DOCS.md:38-44`). It works because `dist/dts-bundle/` was a new directory. The guides
land as new **entries inside an index.json that already exists**, so existence proves nothing.

**Probe for the guide key instead** — an agent that reads `dist/docs/index.json` and finds no
`category` beginning `Guides/Discovery` (or no `Collection Toolkit` key) is on an old version. This
is strictly better than a version compare: no semver parsing, and it tests the thing actually needed.

### 0.5 The eval gate cannot see a file read out of `node_modules`

`wix-app` scenarios assert coverage with `skill_was_called` + `referenceFiles`, which only observes
files under `skills/wix-app/` (`docs/eval-scenarios.md:154-190`). Once the need→component table lives
in `@wix/patterns`, **no `referenceFiles` assertion can prove the agent read it.** Three scenarios
currently assert `references/WIX_PATTERNS_DOCS.md`
(`employee-shift-dashboard.yml`, `refunds-dashboard-sdk-not-cms.yml`,
`dashboard-page/admin-call-routed-and-elevated.yml`) — those survive, because that file remains and is
still read. But proving the *new* chain is `llm_judge`-only. Phase C plans for that explicitly.

---

## Phase A — cairo (`packages/cairo`)

Six changes. A1–A3 are the mechanism; A4–A5 are the content; A6 is optional cleanup.

### A1 — thread `relatedComponents` through the generator

`scripts/generate-component-docs.ts`, two sites:

```ts
// :382-427 — processStory() return type and value
function processStory(filePath: string): {
  name: string;
  category: string;
  importStr: string;
  componentPath: string;
  tabs: TabData[];
  relatedComponents?: string[];          // new
} | null {
  …
  return {
    name: config.storyName,
    …
    relatedComponents: Array.isArray(config.relatedComponents)
      ? config.relatedComponents
      : undefined,                        // new
  };
}
```

```ts
// :1131-1140 — the index entry, same spread convention as bundle/symbols
index[data.name] = {
  file: outName,
  category: data.category,
  ...(bundleFile ? { bundle: bundleFile } : {}),
  ...(symbols.length ? { symbols } : {}),
  ...(data.relatedComponents?.length
    ? { relatedComponents: data.relatedComponents }
    : {}),
};
```

Also widen the `index` declaration at `:1006`
(`Record<string, { file; category; bundle?; symbols? }>`).

**The collision this plan warned about is gone, and a harder question replaces it.** The
`config.status` work (P1 in `CODEGEN-INVESTIGATION-376f82f2.md`) was PR **#5804** on branch
`fix/docs-gen-carry-component-status`, editing `processStory()` at `:382` and `:416-418` — cairo 2's
exact sites. It was **closed unmerged by Kobi on 2026-09-06**, CI green, bot reviews only, no closing
comment. So nothing is in flight on those lines and there is no rebase to coordinate.

But #5804 and cairo 2 are the *same shape of change*: add an optional field to
`dist/docs/index.json` so a machine consumer stops making a choice it currently gets wrong. If #5804
was closed because that shape is unwanted in cairo, cairo 2 does not survive review either and the
design needs a different mechanism. **Resolve this before writing cairo 2** — it is the load-bearing
PR of the whole plan.

### A2 — emit the list into the generated markdown, not only the index

`generateMarkdown()` (`:891`) should append a `## Related components` section listing each name with
the doc file it resolves to. Rationale: an agent that has opened the guide should not have to go back
to `index.json` to follow it, and the emitted text becomes checkable by the same in-doc regex
convention `validateDocReferences()` already uses (`validate-bundles.ts:305-330`).

Use the existing sentinel wording so no new regex is needed per reference:
`Example code: read \`dist/docs/<file>\`` already has a checker; emit related components as
`Read \`dist/docs/<file>\`` lines under the section heading and extend that regex to cover
`dist/docs/*.md`.

### A3 — the build-time validator

New function in `scripts/dts-bundle/validate-bundles.ts`, alongside `validateDocReferences()`
(`:275-336`), wired into `main()` next to the existing `docProblems` block (`:410-421`) — same
`problems: string[]` → `console.error` → `process.exit(1)` convention.

```ts
function validateRelatedComponents(): string[] {
  const problems: string[] = [];
  const indexFile = path.join(DOCS_DIR, 'index.json');
  if (!fs.existsSync(indexFile)) {
    // dts:bundle runs standalone in dev, without docs:gen having produced anything.
    console.log('No dist/docs/index.json — skipping related-component checks.');
    return problems;
  }
  const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8'));

  // A guide names components the way a reader does — sometimes the export
  // (ExportButton), sometimes the Storybook title (More Actions). Both are
  // reachable from the index, so both resolve. See §0.1.
  const resolvable = new Set(Object.keys(raw));
  for (const entry of Object.values<any>(raw)) {
    for (const s of entry.symbols ?? []) resolvable.add(s);
  }

  let checked = 0;
  for (const [name, entry] of Object.entries<any>(raw)) {
    for (const ref of entry.relatedComponents ?? []) {
      checked++;
      if (!resolvable.has(ref)) {
        problems.push(
          `dist/docs/index.json: guide "${name}" lists relatedComponent "${ref}", ` +
            `which is neither a documented name nor a symbols alias — it was renamed or removed`,
        );
      }
    }
  }
  console.log(`Related components: ${checked} guide references, all resolvable.`);
  return problems;
}
```

Placement in the chain is already correct by construction: `build` runs
`docs:gen` before `dts:bundle` (`package.json`), and `validate-bundles.ts` is step **6 of 7** inside
`dts:bundle`, ahead of `generate-index.ts`.

### A4 — author the guides

Each guide is `docs/Guides/<slug>/<slug>.story.ts` (a thin module) plus its markdown. Follow
`docs/Guides/cache/` — the simplest existing example.

| Guide dir | `storyName` | Source content | `relatedComponents` |
| --- | --- | --- | --- |
| `Guides/composition-and-providers/` | `Composition and Providers` | `WIX_PATTERNS_DOCS.md:48-127` | the 5 providers, `CollectionPage`, `EntityPage`, `SettingsPage`, the 5 collection triads, `PatternsReactRouter`, `PatternsReactRoute`, `usePatternsNavigate` |
| `Guides/collection-toolkit/` | `Collection Toolkit` | `dashboard-page/COLLECTION_TOOLKIT.md` (all of it) — **source it from `fix/collection-toolkit-stale-cli`**, not from whatever branch is checked out; other branches still carry the removed-CLI text at `:37` and `:39` | the ~40 names in its tables |
| `Guides/collection-entity-flow/` | `Collection to Entity Flow` | `WIX_PATTERNS_DOCS.md:151-170` | `EntityPage`, `useEntityPage`, `usePatternsNavigate`, `PatternsReactRoute`, `PatternsReactRouter` |
| `Guides/reading-the-doc-indices/` | `Reading the Doc Indices` | `dashboard-page/PATTERNS_BUNDLE_READING.md` | — (format conventions, no names) |

Two authoring notes from reading the existing output:

- Give the tab a **real title**. `nextjs.story.ts` uses `title: ' '`, which generates a literal empty
  `##  ` heading in `dist/docs/Next.js.md`. Use `title: 'Overview'`.
- The output file is `<storyName>.md`, so `Collection Toolkit` → `dist/docs/Collection Toolkit.md`.
  Spaces in filenames are already normal here (`Working with Cache.md`); keep the storyName stable,
  because the skill's version-floor probe (§0.4, C4) will key on it.

Use `category: 'Guides/Discovery'` for all four, so the skill can select them with one prefix test
rather than a hardcoded name list. Today's guides sit at bare `Guides` and `Guides/<X>`; the prefix
convention already holds.

### A5 — the gotchas move onto `useEntityPage`'s doc — **shipped, see PR 1**

> Corrected during implementation. The design doc says "EntityPage's own doc"; the right target is
> **`useEntityPage`**, which has its own `docs/useEntityPage/` directory and its own index entry
> (`bundle: hooks/useEntityPage.d.ts`). Three of the four gotchas are about the *hook* — its generics,
> its params type — and a developer who looks up `useEntityPage` would never see them on the
> component's page.

`docs/useEntityPage/typing-the-call.md` + a `description()` section appended to the API tab in
`docs/useEntityPage/useEntityPage.tabs.ts`. **One item, not four.**

- **Name both generics.** `useEntityPage<T, V extends FieldValues = FieldValues>` — `V` does not infer
  from `form`, and the `<any, V>` escape hatch silently un-types `state.entity`.

### The test that cut this from four items to one

Not everything in the skill's patterns files is library knowledge. Much of it is **remediation for an
agent that guessed instead of reading**, and that does not become library documentation by being moved
into the library. Before moving any item, ask: *would a developer reading this doc, with autocomplete
and the type in front of them, need this sentence?*

Three items failed that test:

| Item | Why it did not move |
| --- | --- |
| `onSave` gives you `widgetsFormData`, not form values | Already in the shipped doc — the example carries it as an inline comment |
| Root export, not `@wix/patterns/page` | The doc's own import line answers it. Does not generalize: 31 entry points × 167 names |
| `UseEntityPageParams` is a `Pick`; `container` is not a key | Restates a type the bundle spells out in full; `container` was an agent's guess, not a reader's |

**Apply the same test to Steps 1 and 5 before authoring those guides.** The need→component tables (A4)
pass it easily — they are library knowledge and they get build-time validation. Parts of
`PATTERNS_BUNDLE_READING.md` may not: content about *how an agent should read a file* stays in the
skill; content about *what the format means* moves.

**Two skill-side corrections fall out of this, both independent of the migration:**

1. `ENTITY_PAGE_TOOLKIT.md:59` claims "the hook's doc has an empty API section". No longer true —
   `useEntityPage.md` has Overview, a full Example that already names both generics, Returns, and a
   Props bundle pointer.
2. **`dist/dts-bundle/exports/<subpath>.d.ts` is a curated subset, not a mirror of the entry point.**
   `exports/page.d.ts` lists two exports; `src/exports/page.ts` also exports
   `CollectionPageHeaderBadge`, `CollectionPageHeaderProps` and all of `CollectionPageNew`. Both
   `ENTITY_PAGE_TOOLKIT.md:33` and `COLLECTION_TOOLKIT.md:54` tell an agent to read those files "to see
   what that subpath actually gives you" — which is not what they show. Found the hard way: PR 1's
   first draft asserted the subset as an inventory and both review bots caught it. This belongs in the
   `reading-the-doc-indices` guide (A4) as a stated limit of the format, and the two skill lines need
   rewording either way.

Authoring note: `description({ title })` already emits `### <title>`, so headings *inside* the
markdown must start at `####` or they render as siblings of their own section.

### A6 — optional: ship the four orphaned FAQ files

`docs/FAQ/{detect-cairo-component,inline-refetch,read-state,state-change-re-render}.md` are wired only
into the internal Storybook. The generator's glob is
`['docs/**/*.story.tsx', 'docs/**/*.story.ts']` (`:993-994`), so a single
`docs/FAQ/faq.story.ts` with `category: 'Guides'` ships all four. ~15 lines. Independent of everything
else here — take it or drop it without affecting the rest.

---

## Phase B — release

Version bump and publish through cairo's normal process. Note the exact published version at the
time: Phase C's floor text needs it.

**`1.463.0` is not that release.** It was cut on 2026-09-07 from `4a9c0c6ed0` — docs fixes only, and
Phase A's mechanism (cairo 2) was never written. Verified against the published tarball: no
`category` under `Guides/Discovery` in `dist/docs/index.json` (its `Guides*` entries are
`InMemoryBackend`, `Working with Cache`, `Next.js`, `Component Tests`, `Sled Tests`), and no entry
anywhere carries `relatedComponents`. So C4's key probe would correctly reject it, and Phase C stays
blocked.

---

## Phase C — skill (`skills/wix-app`)

### C1 — state the trigger once

Keep it in `SKILL.md:31` (the 🛑 Patterns Docs Gate — the earliest point an agent hits it). The other
two become pointers:

- `SKILL.md:104-113` (Component Selection Order → §1) — keep the ordering rule, drop the restated gate.
- `DASHBOARD_PAGE.md:11-19` (UI Libraries) — already ends in a pointer to
  `SKILL.md#component-selection-order`; delete the duplicated 1/2/3 list above it.

### C2 — flip the entry point and rewrite the procedure

`WIX_PATTERNS_DOCS.md` becomes the one procedure file. New `## How to Look Things Up`:

1. Resolve `<pkgRoot>` (`Prerequisites`, unchanged — the PnP snippet at `:5-36` stays).
2. `Read <pkgRoot>/dist/docs/index.json` **first**. It is the superset (§0.2) and the only index that
   carries guides.
3. Read every `category: "Guides/Discovery"` entry whose subject matches the task — once per session.
4. Follow the guide's `relatedComponents` to each component's doc.
5. Read the doc's chosen example file.
6. `dist/dts-bundle/index.json` → the `.d.ts` for props and any type you name.

Steps 5 and 6 are the design doc's "one explicit instruction added" and the existing bundle step.

Content to **delete** from the skill (now in the package):

| File | Lines | Becomes |
| --- | --- | --- |
| `WIX_PATTERNS_DOCS.md` | 48-127 (Library Architecture) | pointer to the composition guide |
| `WIX_PATTERNS_DOCS.md` | 151-170 (Collection→Entity Flow) | pointer to the entity-flow guide |
| `dashboard-page/COLLECTION_TOOLKIT.md` | whole file | deleted; pointers retarget to the guide |
| `dashboard-page/ENTITY_PAGE_TOOLKIT.md` | whole file | deleted; pointers retarget to `EntityPage.md` |
| `dashboard-page/PATTERNS_BUNDLE_READING.md` | whole file | deleted; pointer to the indices guide |

Content that **stays in the skill** — it is not about `@wix/patterns` internals and has no home in the
library: the patterns-before-WDS ordering rule, the "never browse `node_modules` by hand" rule
(`WIX_PATTERNS_DOCS.md:46`), the "when patterns has no equivalent" fallback (`:172-180`), the
`SidePanel`-is-WDS fact, and `UX_SUCCESS_MODEL.md` in full.

### C3 — retarget the eight cross-links

Verified inbound references to the four files being emptied or deleted:

```
SKILL.md:25, :31, :62, :123, :133, :135, :168, :217, :219, :220
references/DASHBOARD_PAGE.md:9, :15, :36, :73
references/DASHBOARD_MODAL.md:14
references/dashboard-page/WDS_LAYOUT.md:5
references/dashboard-page/UX_SUCCESS_MODEL.md:133
```

`SKILL.md:217-220` is the reference index table — two rows are deleted, one is rewritten.

### C4 — the version floor

Replace the `ls dist/dts-bundle/index.json` probe at `WIX_PATTERNS_DOCS.md:38-44` with a key probe
against the docs index, per §0.4:

> After reading `dist/docs/index.json`, check for a `Collection Toolkit` entry. If it is absent, the
> installed `@wix/patterns` predates the discovery guides — upgrade to **≥ \<published version\>** and
> re-read. Do not fall back to the removed skill files, and do not browse `node_modules`.

Keep the existing `dist/dts-bundle/index.json` existence check as the *lower* floor (1.458.0); the two
answer different questions and both are cheap.

### C5 — evals

Per `AGENTS.md`, every `wix-app` reference change needs covering scenarios. Three exist and are
correctly tagged (`wix-patterns-docs`, `dashboard-page`). Required work:

- **Keep** the `referenceFiles: [references/WIX_PATTERNS_DOCS.md]` assertions in all three — that file
  survives as the procedure file and is still read, so the assertions stay meaningful.
- **Add** to `employee-shift-dashboard.yml`'s patterns `llm_judge` prompt an explicit check that the
  agent read the guide out of `dist/docs/` and followed its `relatedComponents`, since
  `skill_was_called` cannot observe a package file (§0.5).
- **Add one negative scenario**: an old-`@wix/patterns` project, asserting the agent reports the
  upgrade rather than proceeding — this is the only thing that tests C4, and C4 is the single point of
  failure for every agent on a stale install.
- Tag hygiene: no scenario currently carries a `collection-toolkit`, `entity-page-toolkit` or
  `patterns-bundle-reading` tag, so deleting those files orphans no coverage.

---

## Verification

**cairo**

```bash
cd packages/cairo
yarn docs:gen && yarn dts:bundle
```

- `dist/docs/index.json` has four `Guides/Discovery` entries, each with a `relatedComponents` array.
- Each generated guide `.md` carries its `## Related components` section (A2).
- `dist/docs/EntityPage.md` carries the Gotchas section.

**The validator must be proven to fire, not just to pass.** Deliberate-break test:

```bash
# add a bogus name to one guide's relatedComponents, then:
yarn docs:gen && ts-node -T --project tsconfig.scripts.json scripts/dts-bundle/validate-bundles.ts
# expect: exit 1, naming the guide and the unresolvable name
```

Run the validator directly rather than the whole `dts:bundle` chain while iterating — it is one of
seven chained steps and only needs `dist/` to exist. Second break test: rename a real component's
story and confirm the guide referencing it fails. That is the drift case this whole design exists for;
if it does not fail, the design did not ship.

**skill** — run `wix-app` against a project on the new version with the employee-shifts prompt
(`yaml/wix-app-evals/employee-shift-dashboard.yml`) and confirm the read order is
`docs/index.json` → discovery guide → `relatedComponents` → component doc → example → bundle. Then run
the same prompt against a project pinned to `1.461.0` and confirm the agent reports the upgrade
instead of guessing.

---

## Sequencing and risk

| # | Step | Blocks | Risk |
| --- | --- | --- | --- |
| 1 | A1 + A3 (mechanism) | everything | conflicts with the uncommitted `config.status` work on the same two sites — §A1 |
| 2 | A4 + A5 (content) | B | none; pure additions |
| 3 | A2 (markdown emission) | — | independent; can slip a release |
| 4 | A6 (FAQ) | — | independent; droppable |
| 5 | B (release) | C4 | normal cairo release gating |
| 6 | C1–C3 (restructure) | C5 | **the window** — see below |
| 7 | C4 (floor) | — | needs B's published version number |
| 8 | C5 (evals) | merge | `llm_judge` is the only instrument for the new chain |

**The one real hazard is the window between C1–C3 and C4.** The moment the skill deletes
`COLLECTION_TOOLKIT.md`, any agent on a pre-guide `@wix/patterns` has *neither* source: the skill file
is gone and the guide is not installed. It degrades to exactly the failure this whole chain exists to
prevent — a dashboard built entirely from WDS.

Mitigation: **land C4 in the same commit as C1–C3, not after.** The floor check is what makes the
deletion safe, so it is not a follow-up item — it is part of the deletion.

---

## PR decomposition

The A/C numbering above is work items, not pull requests. Three constraints set the real boundaries:

- **A1 without A3 ships the untrusted state this design removes** — a field nothing validates. And A3
  without a guide passes vacuously (`0 guide references, all resolvable`), so a reviewer cannot tell it
  works. The mechanism PR carries one real guide and the deliberate-break test.
- **C2 deletes the files C3's links point at**, and `AGENTS.md` makes the eval scenario part of the
  same change rather than a follow-up. With C4 already required in the deletion commit (see
  *Sequencing and risk*), Phase C is necessarily one PR.
- **C1 depends on nothing.** Stating the trigger once is true regardless of where the content lives.

| PR | Items | Depends on |
| --- | --- | --- |
| cairo 1 | **A5** — `useEntityPage` typing rule — **merged**, #5843 (`2942fb8b98`) | — |
| cairo 2 | **A1 + A3 + the `collection-toolkit` guide** | — |
| cairo 3 | **A4** — remaining three guides | cairo 2 |
| cairo 4 | **A2** — markdown emission | cairo 2; foldable into it |
| cairo 5 | **A6** — FAQ wiring | nothing; droppable |
| skill 0 | **C1** — trigger stated once | nothing; ship ahead of Phase A |
| skill 1 | **C2 + C3 + C4 + C5** | Phase B |

Critical path is three PRs — cairo 2 → cairo 3 → release → skill 1. The rest are parallel or optional.

Whether to merge cairo 2 and 3 is a judgement call. Split, the maintainers get a small mechanism diff
reviewed on its own merits and then a large prose diff with no mechanism risk — usually the better
trade with library owners who care about the generator but not about dashboard guidance. Merge if one
review conversation is preferable to two.

---

## Open questions — recommended answers

**`relatedComponents` shape → flat `string[]`.** The "why" already exists as prose in the guide's own
`Need | Component` tables, which is where a reader looks anyway; a paired
`{ component, for }` duplicates it in a place the validator still cannot check, since nothing
cross-checks the `for` string against the prose. The flat list is also forward-compatible: a richer
shape can be accepted later as a union without breaking any published guide. Take the simple one.

**Guide granularity → one `collection-toolkit` guide.** It matches today's file, it is ~6 KB (well
under any read limit — the largest shipped guide is 4.3 KB), and the agent's actual access pattern is
one read per session, not one read per need. Splitting filters out would double the reads to answer a
single question.

**`reading-the-doc-indices` priority → ship it with the rest, despite being lowest-risk.** The design
doc suggests deferring it. Recommend against: it is the file that explains the `bundle`-vs-table split
and the `symbols` alias — the exact mechanics A2 and A3 now depend on. Deferring it leaves the skill
explaining the format its own validated links rely on, which is the split the design set out to close.
It is also the cheapest of the four to author, being a straight copy.
