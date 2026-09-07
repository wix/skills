---
name: rp-source-csv
description: >-
  CSV file source adapter: parse core, vendor fingerprinting (Shopify, WooCommerce, Magento,
  BigCommerce), layout inference, file-set handling, and read contract for codegen. Use when
  the migration starts from one or more CSV/export files instead of a live source URL.
---

# rp-source-csv

CSV **source adapter**. Owns every CSV-specific detail the platform-agnostic skills must not
hardcode: how to parse a file, how to identify which vendor produced it, how its rows group
into entities, how a set of files resolves into entity streams, and what a generated reader
must get right.

## When this skill is used

This is not a stage in the migration flow — it is a reference consulted by two stages:

- **`rp-discovery`** consults the *Capture* section to sample the files and produce the
  canonical `source-profile.md` + `source-schema.json`.
- **`rp-import-codegen`** consults the *Read contract* section to generate a reader that
  extracts CSV data correctly (grouping, derived entities, empty-vs-absent) into durable
  project-local files for the later import step.

`rp-execute-import` never consults this skill — by the time execution runs, the CSV-specific
knowledge is already baked into the generated reader.

## Platform identity

- Source platform: `csv` — a **file-provided** flow, not a URL probe.
- Set `"platform": "csv"` in the emitted `source-schema.json`, and record the detected
  vendor per file in `sourceMeta.vendor` / `sourceMeta.sourceFiles[]`.
- Record `sourcePlatform=csv`, `sourceMode=files_only`, and **every** input file in
  `fileInputPaths` in `orchestration/decisions.json`. Preflight requires no source env keys
  for `csv`; the `files_only` branch enforces a non-empty `fileInputPaths` instead.

## Three layers

1. **A generic core** — `lib/csv-parse.js` (parse, dialect detection, type sniffing) and
   `lib/csv-layout.js` (layout inference, derived entities). Knows nothing about commerce and
   handles any CSV, including hand-rolled ones.
2. **Per-vendor overlays** — declarative JSON profiles under `vendors/` that specialize the
   core with a vendor's fingerprint anchors, known layout, column→Wix pre-map, and quirks.
   v1 ships **shopify, woocommerce, magento, bigcommerce**.
3. **A fingerprint detector** — `lib/csv-fingerprint.js` picks the overlay from the header
   set, or honors a user-stated vendor, and falls back to `custom` below the threshold.

**The overlay is advisory, never authoritative.** The authoritative record of which columns a
file contains is always the header row read at discovery time. The overlay only (a)
*identifies* the vendor and (b) *pre-fills* mappings the LLM would otherwise propose.

## Capture (discovery-time)

Sampling the files to learn their shape — **not** a bulk load.

Before capture, verify `migrations/<project>/config/source.csv.env`. Create it if missing,
using empty values for the user to fill:

```bash
CSV_INPUT_ROOT=            # optional; directory the input paths are recorded relative to
CSV_DELIMITER=             # optional; blank = auto-detect , ; \t |
CSV_ENCODING=              # optional; blank = auto-detect (UTF-8 / BOM)
CSV_VENDOR=                # optional; user-stated vendor overrides fingerprint detection
CSV_MEDIA_URL_REWRITE_FROM=
CSV_MEDIA_URL_REWRITE_TO=
```

Unlike `source.wordpress.env`, **`source.csv.env` is not secret-bearing** — it holds
delimiter/encoding/vendor/rewrite hints only, no credentials. Regular file handling applies.
There is **no acquisition-mode fork and no credentials request** for a CSV run.

1. Run the deterministic capture script **from this skill's directory** (the folder
   containing this `SKILL.md`; see `CONVENTIONS.md`):

   ```
   node scripts/csv-discovery.js --file <path> [--file <path> ...] \
     --out-dir <migrations-root>/<project>/data/csv-discovery
   ```

   `--file` is repeatable; pass the **whole file set in one run** so roles and split files
   are resolved together. For long runs, pass `--progress-log <path>` and poll it per
   `CONVENTIONS.md#progress-log-polling`.

   Useful options: `--vendor` (override detection), `--delimiter` / `--encoding` (override
   detection), `--role <path>:<role>` (name a file's entity when the script cannot),
   `--allow-header-superset` (union split files whose headers differ), `--scan-rows`.

2. Per run the script: reads each header → detects the dialect → fingerprints the vendor per
   file → assigns a role per file and concatenates split files → resolves the layout (overlay
   or generic classifier) → derives `column-values` entities → diffs the real header against
   the matched profile → samples head and tail rows → infers per-column
   type/cardinality/requiredness/examples → writes the raw dump. Because headers are read
   fresh every run, discovered fields are never limited to what the profiles know.

3. It writes into `--out-dir`:
   - `README.md` — the index: files, vendor detection with evidence, layout, entities,
     profile drift, warnings.
   - `fileset.json` — machine-readable `sourceFiles[]`, streams, vendor, dialect, layout,
     drift, mapping hints, entities and relations. **This is what `rp-discovery` synthesizes
     `source-schema.json` from.**
   - `raw-capture.json` — per-column detail plus head/tail samples.
   - `<role>--<entity>.md` — one per entity.

4. **Honor the halt.** When the capture reports `halt: true` (ambiguous layout, unknown file
   role, conflicting split-file headers, mixed vendors for one role), stop and ask the user
   the question named in the warning rather than synthesizing a schema from a guess.

5. **Record counts are scan-based.** The script streams each file in full for its row count
   and retains the first `--scan-rows` rows (default 5000) for inference. When
   `raw-capture.json` reports `scan.truncated`, say so in `source-profile.md` instead of
   presenting a sampled count as exact.

The raw capture is evidence, not a hand-off artifact. `rp-discovery` synthesizes it into the
canonical artifacts and records traceability pointers (`rawDiscovery`, per-entity `rawFile`).

## Layer 1 — the generic core

`lib/csv-parse.js` is the CSV analogue of `rp-source-wordpress`'s `wp-http.js`: dependency-free
and reused by **both** the capture script and the generated reader so the sampler and the
importer parse identically. It handles what breaks a naive `split(',')`:

- **delimiter detection** (`,` `;` `\t` `|`), scored by field-count consistency **and** field
  count, since a semicolon file whose text fields each contain a comma splits perfectly
  consistently on `,` too. `CSV_DELIMITER` always wins.
- **RFC-4180 quoting**: embedded delimiters, embedded newlines, `""` escapes. A quote opens a
  field only at field position 0; `a"b` is three literal characters.
- **encoding / BOM**: the mark is stripped before the header is read. A UTF-16 BOM fails fast
  naming `CSV_ENCODING` rather than producing mojibake — full transcoding is out of scope.
- **line endings**: `\n`, `\r\n`, and lone `\r`, including a `\r\n` split across a chunk
  boundary. A newline inside quotes is data and is preserved verbatim.
- **empty vs absent** (below).
- **streaming**: rows are yielded without loading the file.

### Empty vs absent is detected, not assumed

Whether an empty cell means "absent" is a property of the **writer's quoting policy**, not of
the datum: exporters that quote every field (Excel, Magento) can only ever produce a quoted
empty, and exporters that quote nothing unnecessary can only ever produce an unquoted one.

So the parser returns **strings only, never `null`**, with an optional parallel `quoted[]`
array, and `detectEmptyPolicy` decides once per file:

- `present-if-quoted` — the file contains **both** forms, so it genuinely distinguishes them.
- `always-empty` — it contains only one form, so the distinction carries no information.

The policy is recorded in `sourceMeta.dialect.emptyPolicy` and applied through
`coerceEmpty(value, isQuoted, policy)`. Generated readers must use it, so a required Wix field
is never fed an empty string the source did not actually have. This also keeps split files
(shape C) consistent when two parts were written by different tools.

## Layer 2 — vendor overlays

Each supported vendor is a declarative JSON profile under `vendors/`. Overlays are **data, not
code**, because they are numerous, additive, and pure lookup: adding or updating a vendor is a
data-file edit plus a header fixture, with no change to any skill logic.

```jsonc
{
  "vendor": "shopify",
  "profileVersion": "2026-07",              // provenance; bump when the format changes
  "sourceOfTruth": "https://help.shopify.com/.../csv",
  "anchors": {
    "required": ["Handle", "Title"],        // a FEW STABLE columns — never the full schema
    "strong":   ["Body (HTML)", "Variant SKU", "Variant Price", "Option1 Name", "Vendor"],
    "negative": ["Attribute 1 value(s)"]    // presence disproves this vendor
  },
  "layout": {
    "pattern": "grouped-by-key",
    "groupKey": "Handle",
    "continuation": "blank-key",
    "parentEntity": "product",
    "childEntity": "variant",
    "columnGroups": [                       // which columns belong to which entity
      { "entity": "variant", "prefixes": ["Variant ", "Option1 "], "columns": ["Cost per item"] },
      { "entity": "image",   "prefixes": ["Image "] }
    ]
  },
  "derived": [                              // entities synthesized from a column's values
    { "entity": "category", "fromColumn": "Product Category",
      "hierarchySeparator": ">", "hierarchical": true, "linkPolicy": "leaf" }
  ],
  "fileRoles": [{ "role": "product", "filenameHints": ["products_export", "products"] }],
  "columnMap": [{ "wixTarget": "variant.sku", "aliases": ["Variant SKU", "SKU", "variant_sku"] }],
  "quirks": ["Blank-Handle rows continue the previous product", "..."]
}
```

Column matching is **normalized + alias-based**: lowercase, NFKC, strip punctuation and
whitespace. `Body (HTML)` → `bodyhtml`, and `Option1 Name` ≡ `Option 1 Name`. This absorbs
casing changes and renames without a code change.

**`columnGroups` is the one thing the data cannot supply.** Shopify's `Image Src` and
`Variant SKU` both vary within a product group, so only a declaration can say that one is a
third collection and the other is the variant. Generic derivation still covers every column
the overlay does not name — including new columns a vendor adds later.

An overlay feeds two stages:

- **Discovery** — `layout` + `quirks` resolve grouping deterministically, avoiding the generic
  ambiguity halt. Layout traps are stable and hard to infer, which is what makes them worth
  encoding.
- **Mapping** — `columnMap` pre-fills `sourceMeta.mappingHints[]` so `rp-mapper` reviews and
  corrects instead of authoring from scratch.

A `custom` file has no overlay: it runs core-only, and the mapper leans more on the LLM and the
user at the same review checkpoint. A fully stale overlay degrades to exactly that experience —
the floor, not a failure.

## Layer 3 — fingerprint detection

`lib/csv-fingerprint.js` identifies the vendor from the header row:

```
requiredRatio = |required ∩ header| / |required|      (normalized EXACT match)
strongRatio   = |strong   ∩ header| / |strong|
score = requiredRatio === 1 ? 0.50 + 0.50·strongRatio
                            : 0.60 · requiredRatio · (0.50 + 0.50·strongRatio)
negative anchors present -> score *= 0.35
match iff score >= 0.70 AND matchedStrong >= 2 AND (winner − runnerUp) >= 0.15
```

- **Anchors never alias-match.** Aliases are permissive for *mapping*; permissiveness is poison
  for *identification* — Shopify's `variant.sku` aliases include a bare `SKU`, which every
  WooCommerce and Magento export also has.
- **Ratios, not counts.** Anchor ratios are bounded 0..1, so a wide CSV cannot inflate a match.
  Do **not** reintroduce a header-count normalization: dividing by header count penalizes wide
  files and inflates narrow ones, which is what lets a 6-column near-miss flip to a false match.
- Ties, sub-threshold scores, and files with fewer than two strong anchors → `custom`.
- A **near miss** (a drifted vendor export that lost a required anchor) is reported as
  `nearMiss` so it becomes a user question, never silence.
- `CSV_VENDOR` / `--vendor` **overrides** detection, but detection still runs: a disagreement
  is recorded as `conflict: { stated, detected }` and surfaced.

## Layout — how rows group

`lib/csv-layout.js` resolves the layout: `flat`, `grouped-by-key` (blank-key or repeat-key
continuation), or `sectioned`. It runs for **custom** files and as a **fallback** when a matched
overlay does not pin the layout — including when the overlay's declared `groupKey` is missing
from the header, which is recorded as `overlay-groupkey-missing` rather than crashing.

### A pinned layout is verified, not believed

An overlay's `continuation` is a **claim about the rows**, not a fact about the vendor, and it is
checked against the sample before it is used. Shopify is the reason: most exports blank the
`Handle` on continuation rows, but some repeat it on every row. Pinning `blank-key` against a
repeating file fails *silently* — no key is ever blank, so no row ever continues a group, and a
50-product file is captured as 82 single-row products with 32 blank titles.

The check fires only when the two modes would group **differently**: with one row per group both
readings produce the same boundaries, and reporting drift there would be noise.

| Pinned | Rejected when | Then |
| --- | --- | --- |
| `blank-key` | the key column is never blank | continuation corrected to `repeat-key` |
| `repeat-key` | the key column is blank on some row | continuation corrected to `blank-key` |

On rejection the generic classifier is consulted about the **disputed field only**. Which column
groups the rows is the part vendors do not change, and the overlay's `groupKey` has just been
confirmed present in the header — so a generic candidate naming that same column corroborates the
observed mode *even when the classifier as a whole halted*, because its halt is about **picking**
a key, not about this one. When corroborated, the continuation is corrected and the rest of the
overlay (entity names, `columnGroups`) is kept, with `source: overlay-continuation-corrected` and
the classifier's confidence instead of the pin's `1`. When no candidate groups on the declared key
either, nothing is trustworthy enough to pin and the whole inferred layout is used
(`inferred-after-overlay-mismatch`).

Both outcomes append to `layoutConflicts[]` and raise a warning — never a silent correction. Do
**not** "fix" this by re-pinning `repeat-key` in the overlay: exports vary, so that only moves the
same silent failure to the other half of them.

Deterministic-first: when signals are clear it sets the pattern; when they are ambiguous it
returns `pattern: 'unknown'` with `halt: true` and the ranked candidates, and discovery stops to
ask the user.

Signals worth knowing:

- **blank-key** requires the key column's non-blank values to be unique — a key never reappears
  after an intervening key. Two candidate columns that produce the **same** group boundaries
  (Shopify's `Handle` and `Title` both go blank on continuation rows) are *equivalent labels*,
  not an ambiguity; different boundaries are a genuine ambiguity and halt.
- **repeat-key** additionally requires a supporting parent column — some other column constant
  inside each run and different between runs. Without it, a flat product list merely *sorted* by
  category is indistinguishable from a grouped one, and would be split into bogus parents and
  children.
- **sectioned** requires a column-population skew: partitioned by the discriminator, some other
  column's blank rate must differ by ≥ 0.7 between partitions. Without that test every
  `Published` or `Tax class` column is a false discriminator.
- When a blank column's blankness is a pure function of the discriminator value, the blank-key
  reading is already **explained by the sectioning** and does not compete with it — this is what
  keeps a WooCommerce export from looking ambiguous.

### Parent vs child columns

A column belongs to the parent, to the child, or to a declared collection. The rule is
**within-group variance**, not blankness:

- A column that varies inside a group in ≥80% of multi-row groups is a **child** column.
- A column blank on every continuation row and populated on the head row is a **parent** column.
- Anything else is reported as `ambiguousColumns` rather than guessed.

The naive rule — "child columns are the ones populated on continuation rows" — is **wrong** for
the most important case: a Shopify product's first variant lives on its group head row, and a
single-variant product has no continuation rows at all.

Precedence: overlay `columnGroups` assigns the entity, generic derivation covers everything the
overlay does not name, and a disagreement is recorded in `layoutConflicts[]` with the overlay
kept. An overlay can never *lose* a column — that is what "advisory, never authoritative" means
in practice.

`layoutConflicts[]` carries both kinds of disagreement, because a reviewer asks the same question
of both — *where did this capture stop believing the overlay?* Column-level entries name a
`column`; layout-level entries (`overlay-continuation-mismatch`, `overlay-groupkey-missing`,
`overlay-discriminator-missing`) carry a `kind` and a `resolution`.

A child's `recordCount` is the number of rows that populate **at least one** child column, not the
group's row count: a continuation row carrying only an extra image is an image, not a variant.

## Entity origins — rows, row groups, and column values

An entity in a CSV migration comes from one of three origins, recorded per entity so the reader
knows how to materialize it:

- **`file-rows`** — one row = one entity (a flat `categories.csv`; also a sectioned file's
  parent or child rows, with `filter: { column, includeValues | excludeValues }`).
- **`row-group`** — a group of rows = one entity (a Shopify product, its variants, its images),
  with `groupKey`, `continuation`, and `columnGroup` where relevant.
- **`column-values`** — the **distinct values of a column** = an entity set. This is how
  categories and tags arrive in every named vendor's export.

For `column-values`, capture records the source column, both separators, and the distinct-value
count; the reader emits a synthetic entity file (one record per distinct path, ancestors
included) plus the linking relation. Because the result is an ordinary entity from `rp-mapper`'s
point of view, the mapper maps it with no special handling and the existing dependency ordering
creates categories before products.

Non-obvious rules the implementation depends on:

- **Split the multi-value separator first, then the hierarchy separator.** WooCommerce's
  `Clothing > Shirts, Sale` is two categories, one nested. The other order produces a category
  literally named `Shirts, Sale`.
- A separator inside a value is escaped by quoting **inside the cell**
  (`"Home, Garden > Tools", Sale`), so the inner split is RFC-4180 aware too.
- Records are emitted **depth-ascending**, so a parent is always created before its child.
- Only the **leaf** is linked to the product (`linkPolicy: "leaf"`); whether ancestors are also
  attached is a mapping decision.
- Only **group-head rows** are read, so a Woo variation row does not double-count its product's
  categories.
- Generic detection for custom files is deliberately narrow: `>` is auto-detected but `/` is
  not (it matches every URL column), markup-bearing columns are skipped, a multi-value split
  must collapse the distinct count, and a column is only auto-derived when its **name** says it
  is a taxonomy. Everything else is proposed to the user.

Set **`hierarchical: true`** on a nested derived entity. A hierarchical source taxonomy mapped
to a flat Wix target triggers the mapper's mandatory faithfulness-ledger entry; without the flag
the flatten happens silently.

## File sets — roles and concatenation

`lib/csv-fileset.js` resolves a list of input paths into logical entity streams. Four shapes
occur in practice; **A, B and C are v1**, D is v1.1:

| Shape | Example | Handling |
|---|---|---|
| A. one file, grouped | Shopify `products_export.csv` | one stream, several entities |
| B. many files, independent entities | `products.csv` + `customers.csv` | one stream per role |
| C. many files, same entity split | `products-part1.csv` + `-part2.csv` | one stream, `partOf` recorded |
| D. many files, related entities | FK columns across files | **v1.1** — schema designed, detection deferred |

**Role assignment** walks a ladder, recording `roleSource` at each step: explicit `--role` →
vendor `fileRoles.filenameHints` → generic filename tokens (whole tokens only, last token wins,
so `product-images.csv` is media) → header anchors → `unknown` **with a halt**. A role is never
invented from the filename stem; an entity map full of `weird-export` entities is worse than one
honest question.

**Same-entity concatenation (shape C)** requires the same *normalized column-name set*:

- reordering, case, whitespace and BOM differences are tolerated — names are the identity, and
  each part keeps its own `columnOrderMap`;
- a subset/superset header does **not** silently concatenate. It is legitimate (a re-export
  after the vendor added a column) but it changes what a blank cell means for half the rows, so
  it halts with the exact diff; `--allow-header-superset` unions the parts and records
  `driftAcrossParts`;
- files sharing a role but only a small column overlap (Jaccard < 0.9) are a `role-collision`,
  not two parts of one export;
- part order is a numeric-suffix-aware natural sort, so `part10` follows `part2`;
- `partOf` and `rowOffset` are recorded so any extract row traces back to its file.

**Mixed vendors** are allowed *across* roles (Shopify products plus a hand-rolled
`categories.csv` is a real bundle) but two files of the **same** role from different vendors
halt.

## Read contract (codegen-time)

What a generated CSV reader must get right. Codegen selects it when
`source-schema.json.platform === "csv"`.

The reader is an **extractor**, not an in-memory loader: it parses with the shared parse core,
applies the resolved layout to group rows into per-entity records, and writes **durable
per-entity NDJSON record streams (`<entity>.ndjson`, one record per line) plus a
`manifest.json`** into `data/source-extract/` that `rp-execute-import` reads.

Emit records **as they are grouped**, streaming through `ndjson.js`'s writer — do not
accumulate an entity's records in an array and serialise at the end. A 100k-row export must
never require the whole entity in memory, and an interrupted extract should leave a valid
readable prefix. See `rp-import-codegen` -> "Record streams are NDJSON".

- **Emit canonical records, or convert with `lib/canonical-record.js` — never hand-write the
  rename.** `rp-target-wix/lib/wix-build.js` consumes the vendor-neutral vocabulary declared in
  `wix-target-spec.js` (`description`, `brand`, `weight`), while a reader naturally names fields the
  way its vendor thinks (`bodyHtml`, `vendor`, `weightKg`). `lib/canonical-record.js` holds that
  rename as **per-vendor data** (`READER_FIELD_MAPS`) and self-validates at require time, so a typo
  is a load error instead of a field that silently never reaches Wix. Vendor it alongside
  `csv-parse.js` and call it; do not re-derive the mapping in a project-local transform. It is
  regression-locked with the builder against 220 payloads from two live-verified imports
  (`tests/mapping/wix-build-oracle-test.js`).
- **Reuse `lib/csv-parse.js` — do not regenerate it.** Vendor a copy into the project (e.g.
  `src/lib/`) and import from it, exactly as the WordPress reader vendors `wp-http.js`. The
  reader then carries only per-project orchestration: which entities to emit, the grouping loop,
  type coercion, and transform glue. One tested parse core is what makes the sampler and the
  reader agree.
- **Grouping is the reader's core job.** Replay the resolved layout: a blank key extends the
  current group; a discriminator column routes parent vs child rows, resolving
  `parentRefColumn` (Woo's `Parent` carries `id:123` or a SKU, and does **not** guarantee that a
  variation follows its parent).
- **Iterate the file set** by role, treating `partOf` entries as continuations of the same
  logical stream and honoring each part's own column order.
- **Materialize derived entities**: collect the distinct values of a `column-values` column (and
  their ancestors when hierarchical) into their own entity file, depth-ascending, and emit the
  linking relation. Do not invent Wix ids at extract time — the import stage resolves them
  through the `ImportCrosswalk`.
- **Coerce per inferred type**, and apply `coerceEmpty` with the recorded `emptyPolicy` so
  required Wix fields are not fed empty strings.
- CSV values are plain text and are written as-is — no entity-decoding step unless a specific
  vendor is known to double-encode.
- No auth, no pagination, no rate limits: the entire WordPress transport section collapses to
  "open the file once".

## Media

Image columns hold either public URLs (Wix-reachable) or local paths / private URLs (not
reachable — Wix Media import fetches from Wix servers, the same concern as a WordPress
`localhost` source). Capture flags these as `media-reachability` warnings. Record the note in
`source-profile.md` and offer the two choices:

- rewrite via `CSV_MEDIA_URL_REWRITE_FROM` / `CSV_MEDIA_URL_REWRITE_TO`, or expose the files at
  a public HTTPS URL, or
- skip/defer media import and continue with non-media entities.

## Schema shape

`source-schema.example.json` (in this skill folder) is the template `rp-discovery` follows when
emitting `migrations/<project>/source-schema.json`. It is a shape to follow, not a strict schema
to validate against. Keep the platform-agnostic core stable; push CSV specifics
(`sourceFiles`, `vendor`, `dialect`, `drift`, `mappingHints`, `joins`) into `sourceMeta`, and
give every entity an `origin`.

## Contract tests

Contract tests live in the repo's `tests/` tree, not in this bundle — a fixture shipped to a
partner is dead weight. Run them from the repo root:

```
bash tests/run-all.sh source-csv
```

Or individually: `node tests/source-csv/csv-parse-contract-test.js` (also
`csv-fingerprint-`, `csv-layout-`, `csv-fileset-`). Fixtures are in `tests/fixtures/csv/`.

They cover the dialect/quoting/BOM/line-ending/empty-policy matrix and chunk-boundary feeding;
per-vendor header fixtures, the `custom` fallback, near misses and drifted headers; the layout
patterns plus their false-positive guards, the ambiguity halt and the verification of a pinned
continuation mode in both directions; derived-entity split order,
ancestors and the URL guard; and role assignment, split-file concatenation, header-superset
halts and part ordering.

When a vendor's format drifts, fix `vendors/<vendor>.json` and add a header fixture to
`tests/fixtures/csv/headers/` — no skill logic changes.
