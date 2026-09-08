# Patterns Discovery Flow — technical plan

**Design doc:** [Patterns Discovery Flow](https://docs.google.com/document/d/1oStRU34x-ziiJffpiSGnrA_-KLr5xgKadv1E81rBsQI/edit)
**Scope:** the `@wix/patterns` discovery chain only — trigger → composition → guide → doc → example → API.
**Verified against** `cairo@1.465.0` (`origin/master` `629a6b4044`) and `wix/skills` `origin/main`
(`8e1cc200`), re-checked 2026-09-07 after both repos moved. Every line number below was read, not
recalled — and they drift fast: `generate-component-docs.ts` grew 1161 → 1436 lines in six days.

Two repos, three phases, strictly ordered: **cairo ships → cairo releases → skill follows.**

---

## Status — 2026-09-08 (re-synced)

Both PRs are open. Implemented as one PR per repo, split by commit.

| | PR | Commits |
| --- | --- | --- |
| cairo | **#5869** `feat/patterns-discovery-guides` | 8 — A1, A2, A3, A4, field binding, + 3 from review |
| skills | **#1279** (draft) `feat/patterns-discovery-chain` | 7 — C1…C5, this plan, + the floor bump |
| merged earlier | cairo **#5843** | A5, cut to one section |

Both branches rebased 2026-09-08: cairo onto `master` at **1.467.0**, skills onto `main` at
`2d9d319e`. **1.466.0 and 1.467.0 were both cut without the guides**, which is why the floor
text now says 1.468.0 at the earliest and why the key probe, not the number, is authoritative.

Three conflicts on the skills rebase, all expected and all resolved toward the move:
skills#1280 corrected `useOptimisticActions` in `COLLECTION_TOOLKIT.md` (carried into the cairo
guide, in words) and skills#1281 added read-batching guidance to `PATTERNS_BUNDLE_READING.md`
(kept in the skill — it is instruction about how to read, not what the format means, so the
moving test puts it on this side).

Review on cairo#5869 found two real defects, both fixed: the provider entry points were wrong,
and the validator's alias guard disabled the whole check. See §0.6 and §0.7.

**The skills PR must not merge before cairo #5869 is released.** Its floor check is a key
probe, so no version number is baked in and nothing needs editing at merge time — but until a
release carries the guides, every install fails that probe and the skill correctly refuses to
proceed.

Two items were dropped during implementation, both recorded in place: **A6** (FAQ wiring — a
Storybook migration, not an addition) and **C5's negative scenario** (needs an EvalForge
template pinned below the version floor). Two were discovered: `symbols` silently depends on
`dist/types/index.d.ts`, and the field-binding trap had no cairo home until A4 grew one.

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

**The validator must resolve against `keys ∪ symbols`.** All four cases above re-confirmed against
`1.465.0`'s freshly built index: `CollectionToolbarFilters` → `ToolbarFilters`, `ExportButton` →
`ExportTo`, and `More Actions` / `Sortable Columns` as bare keys. The index now holds 168 entries.

### 0.2 The two indices disagree, and the guides live in the one the skill reads *second*

`bulkActionModal` is in `dist/docs/index.json` and **not** in `dist/dts-bundle/index.json` — and it
is not a lone exception: at `1.465.0` the docs index holds **168** entries against the bundle index's
**101**, because the bundle index is curated and the docs index is everything documented. More
importantly: guides are entries in `dist/docs/index.json`, but the skill today opens
`dist/dts-bundle/index.json` first and calls it "the inventory" (`SKILL.md:123-131`,
`WIX_PATTERNS_DOCS.md:135`). An agent following the current order never sees a guide.

**Phase C must flip the entry point to `dist/docs/index.json`.** That is a real behavioural change to
the skill, not a wording change, and it is the reason Phase C cannot be reduced to "replace moved
content with pointers".

### 0.3 There is no guide "contract" to add a field to

Guides are CommonJS story modules — `module.exports = { category, storyName, hideImport,
hideHeaderLinks, story: { tabs, content } }` (see `docs/Guides/nextjs/nextjs.story.ts`). No TypeScript
interface describes them. `processStory()` (`scripts/generate-component-docs.ts:383-428`) reads that
object field by field and returns a **fixed five-field shape** — `name`, `category`, `importStr`,
`componentPath`, `tabs`.

So "add an optional field to the guide contract" is **two edits, not one**: the return shape at
`:422-428` and the index entry at `:1389-1409`. The design doc names only the second.

### 0.4 The version-floor check cannot reuse the existing pattern

Today's floor is a *file-existence* probe: `ls <pkgRoot>/dist/dts-bundle/index.json`
(`WIX_PATTERNS_DOCS.md:38-44`). It works because `dist/dts-bundle/` was a new directory. The guides
land as new **entries inside an index.json that already exists**, so existence proves nothing.

**Probe for the guide key instead** — an agent that reads `dist/docs/index.json` and finds no
`Collection Toolkit` key is on an old version. Strictly better than a version compare: no semver
parsing, and it tests the thing actually needed. **Shipped this way** (skills `b24a20f2`).

### 0.5 The eval gate cannot see a file read out of `node_modules`

`wix-app` scenarios assert coverage with `skill_was_called` + `referenceFiles`, which only observes
files under `skills/wix-app/` (`docs/eval-scenarios.md:154-190`). Once the need→component table lives
in `@wix/patterns`, **no `referenceFiles` assertion can prove the agent read it.** Proving the *new*
chain is `llm_judge`-only. Phase C plans for that explicitly.

**Re-checked 2026-09-07, and one assertion has become a blocker.** Two scenarios assert
`references/WIX_PATTERNS_DOCS.md` — `employee-shift-dashboard.yml` and
`dashboard-page/admin-call-routed-and-elevated.yml`; `refunds-dashboard-sdk-not-cms.yml` no longer
does. Those survive, because that file remains and is still read. But `employee-shift-dashboard.yml`
now *also* asserts **`references/dashboard-page/ENTITY_PAGE_TOOLKIT.md`**, which Phase C deletes. So
C2's deletion breaks a merged eval on `main`: the scenario edit is not optional cleanup, it belongs in
the deletion commit alongside C4. Re-check this list before writing Phase C — it changed twice in six
days.

### 0.6 cairo doc prose does not carry code — the guides had to be rewritten for it

`cairo/packages/cairo/docs/**` prose describes what to pass and why in words; the runnable
examples carry the code. These guides were drafted from skill references, where the opposite
holds — an agent reads those, so exact signatures are the point — so they arrived full of
inline calls and one entire type signature.

Out of the prose on the second pass: the filter factory's generic signature, the navigate call
with its argument object, the `useEntityPage` call with its parameter object, the two `register`
misuses spelled as JSX, and the form methods written as calls. Component **names** stay — a
guide about which component serves which need cannot avoid naming components — and code blocks
stay, since that is where code belongs.

**Applies to anything else moved into cairo.** The direction of travel is not neutral: content
that was correct as skill prose needs rewriting, not relocating.

### 0.7 Moving prose is where inherited errors surface

Both review bots on cairo#5869 caught the composition guide pointing `WixPatternsBMProvider`
and `WixPatternsGizaProvider` at `@wix/patterns/provider`, which exports only
`WixPatternsProvider`; BM is `/bm` and Giza is `/giza`. The guide also described the default as
detecting its environment, which it does not — it lives in `src/dashboard/` and requires the
`@wix/dashboard` peer.

The auto-detection claim came straight from the skill file, which had said the default
"auto-detects the environment (BM, Essentials, Giza)" for as long as the file has existed. The
wrong import mapping was then generalised on top of it while moving.

**So verify every claim against source as it moves, not just the ones that look uncertain** —
the four guides carried roughly a hundred assertions across, and the two that were wrong were
both inherited rather than invented. This is also, precisely, the argument for the whole
design: the claim was wrong in a place nothing could check it.

---

## Phase A — cairo (`packages/cairo`)

Six changes. A1–A3 are the mechanism; A4–A5 are the content; A6 is optional cleanup.

### A1 — thread `relatedComponents` through the generator

`scripts/generate-component-docs.ts`, two sites:

```ts
// :383-428 — processStory() return type and value
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
// :1389-1409 — the index entry, same spread convention as bundle/symbols/examples
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

Also widen the `index` declaration at `:1226`, which now reads
`{ file; category; bundle?; status?; statusMessage?; symbols?; examples? }`.

**Both worries about this change are now settled, in its favour.**

*No collision.* The `config.status` work (P1 in `CODEGEN-INVESTIGATION-376f82f2.md`) was PR **#5804**,
editing these exact sites. It was closed unmerged — **superseded, not rejected**: #5836 solved the
same problem from the other direction, populating the already-declared `status`/`statusMessage` on
`dist/dts-bundle/index.json` from the `@deprecated` JSDoc in the built bundle.

*No novelty either.* When this plan was drafted the index entry had two optional fields. At `1.465.0`
it has five — `bundle` (79 entries), `symbols` (4), `status`/`statusMessage` (1, `PrimaryPageButton`)
and **`examples: string[]` (39)**, added by #5855. `examples` is `relatedComponents`' exact shape and
exact rationale: a list whose paths are not reconstructible from the name, put in the index because
"without this the index gives no sign a doc has asides at all". `relatedComponents` is the sixth field
of an established kind, not a precedent to argue for.

*And the drift is being paid for by hand meanwhile.* `PrimaryPageButton` now carries
`status: "deprecated"` in cairo, and skills PR #1273 separately removed it from
`COLLECTION_TOOLKIT.md`. Two repos, two commits, one fact — the cost this design removes.

### A2 — emit the list into the generated markdown, not only the index

`generateMarkdown()` (`:1095`) should append a `## Related components` section listing each name with
the doc file it resolves to. Rationale: an agent that has opened the guide should not have to go back
to `index.json` to follow it, and the emitted text becomes checkable by the same in-doc regex
convention `validateDocReferences()` already uses (`validate-bundles.ts:306-331`).

Use the existing sentinel wording so no new regex is needed per reference:
`Example code: read \`dist/docs/<file>\`` already has a checker; emit related components as
`Read \`dist/docs/<file>\`` lines under the section heading and extend that regex to cover
`dist/docs/*.md`.

### A3 — the build-time validator

New function in `scripts/dts-bundle/validate-bundles.ts`, alongside `validateDocReferences()`
(`:276-337`), wired into `main()` (`:522`) next to the existing `docProblems` block (`:561-576`) —
same `problems: string[]` → `console.error` → `process.exit(1)` convention.

**Pick the hard-fail convention deliberately.** cairo now has two: `validate-bundles.ts` exits 1,
while the newer reporting added to `scripts/dts-bundle/generate-index.ts` (#5854, #5862) only
`console.warn`s. A warning does not close a trust gap — an agent never sees cairo's build log. Exit 1.

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
| `Guides/collection-toolkit/` | `Collection Toolkit` | `dashboard-page/COLLECTION_TOOLKIT.md` (all of it) — source it from `origin/main`, which now carries the fixed text; feature branches may still hold the removed-CLI wording | the ~40 names in its tables |
| `Guides/collection-entity-flow/` | `Collection to Entity Flow` | `WIX_PATTERNS_DOCS.md:150-166` | `EntityPage`, `useEntityPage`, `usePatternsNavigate`, `PatternsReactRoute`, `PatternsReactRouter` |
| `Guides/reading-the-doc-indices/` | `Reading the Doc Indices` | `dashboard-page/PATTERNS_BUNDLE_READING.md` | — (format conventions, no names) |

Two authoring notes from reading the existing output:

- Give the tab a **real title**. `nextjs.story.ts` uses `title: ' '`, which generates a literal empty
  `##  ` heading in `dist/docs/Next.js.md`. Use `title: 'Overview'`.
- The output file is `<storyName>.md`, so `Collection Toolkit` → `dist/docs/Collection Toolkit.md`.
  Spaces in filenames are already normal here (`Working with Cache.md`); keep the storyName stable,
  because the skill's version-floor probe (§0.4, C4) will key on it.

**Decided against a `Guides/Discovery` category during implementation.** All four ship at
`category: 'Guides'`, matching the five existing guides, and the skill names them explicitly instead
of selecting by prefix. Two reasons: `Discovery` is a label about machine consumption, not about
content, and it reads oddly in the Storybook nav a human browses; and an explicit list decouples the
two repos — cairo can add a guide without silently changing what the skill reads. The skill needs
specific guides at specific points in its procedure anyway (composition once per session, the toolkit
when building a collection), so a blanket "read every discovery guide" was never the right
instruction.

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

**Two skill-side corrections fell out of this. One is already fixed; the other is still open:**

1. ~~`ENTITY_PAGE_TOOLKIT.md:59` claims "the hook's doc has an empty API section".~~ **Fixed on
   `main`** — the line now reads "the hook's doc ends by pointing at the bundle rather than tabulating
   props" (`:78`). Nothing to do.
2. **Still open: `dist/dts-bundle/exports/<subpath>.d.ts` is a curated subset, not a mirror of the
   entry point.** `exports/page.d.ts` lists two exports; `src/exports/page.ts` also exports
   `CollectionPageHeaderBadge`, `CollectionPageHeaderProps` and all of `CollectionPageNew`. Both
   `ENTITY_PAGE_TOOLKIT.md:52` and `COLLECTION_TOOLKIT.md:54` tell an agent to read those files "to see
   what that subpath actually gives you" — which is not what they show. Found the hard way: PR 1's
   first draft asserted the subset as an inventory and both review bots caught it. This belongs in the
   `reading-the-doc-indices` guide (A4) as a stated limit of the format, and the two skill lines need
   rewording either way.

**Phase C is also happening organically, one commit at a time.** `ENTITY_PAGE_TOOLKIT.md:47` and
`:89` now send the reader to `dist/docs/useEntityPage.md`'s **Create route** section — a section cairo
grew in the same week. That is precisely the plan's direction, arrived at by hand. It is evidence the
design is right and an argument for landing the mechanism before the hand-migration diverges from it.

Authoring note: `description({ title })` already emits `### <title>`, so headings *inside* the
markdown must start at `####` or they render as siblings of their own section.

### A6 — dropped: shipping the four orphaned FAQ files

**Not the ~15-line addition this plan assumed. Dropped from the cairo PR, deliberately.**

The four write-ups at `docs/FAQ/*.md` are already registered in Storybook — `docs/docs.tsx`
does `storiesOf('Getting Started', module).add('FAQ', …)` over the `sections` export of
`docs/faq.sections.tsx`. And Storybook's own glob (`.storybook/main.js`) is
`../docs/**/*.story.ts*`, the same shape `docs:gen` reads. So adding a story module does not
*add* the FAQ anywhere — it **duplicates** it, giving Storybook two FAQ entries over the same
content.

Doing it properly is a migration, not an addition: move the `storiesOf` block into a story
module so one registration feeds both Storybook and `dist/docs`. Two things make that
unverifiable from here — the existing story renders through `View` with its own
`header({ title })` and `hideHeaderLinks`, so visual parity in Storybook needs Storybook run;
and `faq.sections.tsx` opens with `mdx(<List …/>)`, an interactive table of contents whose
markdown rendering is unknown.

Worth doing, worth its own PR with a Storybook screenshot. It is the smallest prize in this
plan and the only item that touches how the internal Storybook is assembled.

---

## Phase B — release

Version bump and publish through cairo's normal process. Note the exact published version at the
time: Phase C's floor text needs it.

**Nothing published so far is that release** — Phase A's mechanism (cairo 2) has not been written, so
no release can carry the guides. Checked against the published tarballs of both versions cut on
2026-09-07: `1.463.0` (docs fixes, from `4a9c0c6ed0`) and `1.464.0` (cairo#5852 alone — the
`navigateToEntityPage` create-route fix, unrelated to this plan). In each, `dist/docs/index.json` has
no `Collection Toolkit` key — its `Guides*` entries are `InMemoryBackend`,
`Working with Cache`, `Next.js`, `Component Tests`, `Sled Tests` — and not one of its 167 entries
carries `relatedComponents`. C4's key probe would correctly reject both, and Phase C stays blocked.
`1.465.0` (current `master`, `629a6b4044`) is the same story at 168 entries — `withDashboard` gained a
doc in #5862, nothing else relevant moved.

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
3. Read the guides by name — `Composition and Providers.md` once per session, then
   `Collection Toolkit.md` or `Collection to Entity Flow.md` for the task at hand.
4. Follow the guide's `relatedComponents` to each component's doc.
5. Read the doc's chosen example file.
6. `dist/dts-bundle/index.json` → the `.d.ts` for props and any type you name.

Steps 5 and 6 are the design doc's "one explicit instruction added" and the existing bundle step.

Content to **delete** from the skill (now in the package):

| File | Lines | Becomes |
| --- | --- | --- |
| `WIX_PATTERNS_DOCS.md` | 48-127 (Library Architecture) | pointer to the composition guide |
| `WIX_PATTERNS_DOCS.md` | 150-166 (Collection→Entity Flow) | pointer to the entity-flow guide |
| `dashboard-page/COLLECTION_TOOLKIT.md` | whole file | deleted; pointers retarget to the guide |
| `dashboard-page/ENTITY_PAGE_TOOLKIT.md` | whole file | deleted; pointers retarget to `EntityPage.md` |
| `dashboard-page/PATTERNS_BUNDLE_READING.md` | whole file | deleted; pointer to the indices guide |

Content that **stays in the skill** — it is not about `@wix/patterns` internals and has no home in the
library: the patterns-before-WDS ordering rule, the "never browse `node_modules` by hand" rule
(`WIX_PATTERNS_DOCS.md:46`), the "when patterns has no equivalent" fallback (`:167-175`), the
`SidePanel`-is-WDS fact, and `UX_SUCCESS_MODEL.md` in full.

### C3 — retarget the eight cross-links

Verified inbound references to the four files being emptied or deleted:

```
SKILL.md:25, :31, :62, :123, :133, :135, :166, :168, :217, :219, :220
references/DASHBOARD_PAGE.md:9, :15, :36, :38, :77
references/DASHBOARD_MODAL.md:14
references/dashboard-page/COLLECTION_TOOLKIT.md:48, :52
references/dashboard-page/ENTITY_PAGE_TOOLKIT.md:3
references/dashboard-page/PATTERNS_BUNDLE_READING.md:7
references/dashboard-page/WDS_LAYOUT.md:5
references/dashboard-page/UX_SUCCESS_MODEL.md:133
```

Re-derived from `origin/main` on 2026-09-07; it gained three sites in six days (`SKILL.md:166`,
`DASHBOARD_PAGE.md:38`, `:77`). Re-run the grep rather than trusting this block.

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

- `dist/docs/index.json` has four new `Guides` entries; three carry a `relatedComponents` array
  (`Reading the Doc Indices` deliberately does not — it is about the format, not any component).
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

**Declare the list; do not derive it from the prose.** The tempting alternative — no new field at
all, with the validator scanning each guide's markdown for backticked names — was measured on the
three current skill files and does not work. Of **128** identifier-shaped backticked tokens, only
**65** resolve in the docs index. The other 63 are almost all legitimate: prop names (`fetch`,
`onSave`, `filters`, `fetchData`), WDS components patterns does not own (`Input`, `FormField`, `Box`,
`Card`, `Text`, `SidePanel`), types (`FieldValues`, `Pick`, `any`), index field names (`bundle`,
`category`, `symbols`), and shell commands (`ls`, `cat`, `find`). A 49% false-positive rate needs an
ignore list about as long as the thing being validated, and every new prop name in a guide would break
the build. An explicit list is the one that can actually fail correctly.

**`relatedComponents` shape → flat `string[]`.** The "why" already exists as prose in the guide's own
`Need | Component` tables, which is where a reader looks anyway; a paired `{ component, for }`
duplicates it where the validator still cannot check it. The flat list also matches `examples` and
`symbols`, the two fields it sits beside, and a richer shape can be accepted later as a union without
breaking any published guide.

**Guide granularity → one `collection-toolkit` guide.** It matches today's file, it is ~6 KB (well
under any read limit — the largest shipped guide is 4.3 KB), and the agent's actual access pattern is
one read per session, not one read per need. Splitting filters out would double the reads to answer a
single question.

**`reading-the-doc-indices` priority → ship it with the rest, despite being lowest-risk.** The design
doc suggests deferring it. Recommend against: it is the file that explains the `bundle`-vs-table split
and the `symbols` alias — the exact mechanics A2 and A3 now depend on. Deferring it leaves the skill
explaining the format its own validated links rely on, which is the split the design set out to close.
It is also the cheapest of the four to author, being a straight copy.
