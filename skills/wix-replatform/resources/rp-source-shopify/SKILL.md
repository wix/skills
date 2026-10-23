---
name: rp-source-shopify
description: >-
  Shopify private-data source adapter, read entirely through the Shopify CLI (`shopify store
  execute`) on the import operator's machine: discovery capture, its resumable step sequence,
  source-coverage rows, the bulk extract of the full store, and the read contract for codegen. Use when the source platform is
  Shopify and the Admin API (private data) was chosen. The public storefront route is
  `rp-quick-shopify` / public content, not this skill.
---

# rp-source-shopify

Shopify **source adapter** for private data: orders, customers, gift cards, discounts, draft and
archived products, content, navigation, locations, shipping, metaobjects, files and redirects.
It follows the same contract as `rp-source-wordpress` and `rp-source-csv`: it discovers what the
store holds, writes the standard discovery files, records everything it could not capture as a
source-coverage row, and hands over to the general mapping, approval, import and reporting
steps. Nothing it reads is written back; the store is never changed.

## When this skill is used

- **`rp-discovery`** runs the *Discovery* section when the Shopify acquisition-mode answer was
  `Admin API` (`sourceMode=private_data`).
- **`rp-import-codegen`** reads the *Read contract* section.

## Access path: the Shopify CLI, read-only

Every call is `store execute --store <shop>.myshopify.com --query <query> --json --version
2026-10`, run through `lib/shopify-cli.js` by the adapter's own Shopify CLI install, using the
session the operator approved in the browser on their machine. No token is stored by this
adapter.

- **Read-only by construction.** A mutation document is refused before any process starts. The
  one exception is the bulk extract's start: Shopify classes `bulkOperationRunQuery` (a read job)
  as a mutation, so `startBulkOperation` sends that one fixed document with `--allow-mutations`.
  No other call can carry the flag, and operations are never cancelled.
- **A GraphQL error is data about the store**, returned to the caller: discovery turns it into a
  `capture-failed` coverage row. A read Shopify throttles on all 6 calls (1, 2, 4, 8, 16 s
  between them) is `shopify_throttled`, also a `capture-failed` row at discovery. **Any other CLI
  failure stops the step** (exit 2); it is never retried in a loop and never read as "no records".
- Shopify's terms forbid automating the store admin in a browser. Never do it.

### The connection: one dedicated staff account, checked before every read

Inputs: `SHOPIFY_SHOP_DOMAIN=<shop>.myshopify.com` in `config/source.shopify.env` (not a
secret). The operator's Node.js must be **22.12 or later**.

1. The store owner creates a staff account for the migration (Administrator role, or a custom
   role with app and channel management) and gives it to the import operator. The owner's own
   account is not an allowed fallback.
2. Run the session check from this skill directory:

   ```bash
   node scripts/shopify-session-check.js --project <migrations-root>/<project>
   ```

   It checks, in order and stopping at the first failure: Node.js ≥ 22.12; the adapter's own
   Shopify CLI at exactly 4.8.3 in `~/.replatform/tools/shopify-cli-4.8.3`; the connection and
   Shopify's scope readback (every scope the reads declare); and that Shopify lists the pinned
   Admin API version `2026-10` as supported. Then it writes
   `data/shopify-discovery/session-receipt.json` (no secret, no personal data).
3. The first time, it asks the **first-connection question** (a discovery `question` action):
   was the connection approved from the dedicated migration staff account? Answer
   `dedicated-account` only when it was. `other-account` stops: discovery does not start and the
   question is asked again after the owner provides a dedicated account.
4. Follow its stop codes:

| Code | What the operator does |
| --- | --- |
| `shopify_cli_node_unsupported` | **Requires Import Operator.** Switch this terminal to Node.js 22.12 or later (for example the current LTS) with the usual installer or version manager, check `node --version`, run the check again. Nothing was installed or read |
| `shopify_cli_not_installed` / `shopify_cli_version_changed` | Ask the operator; with their consent run the check again with `--install` (installs or reinstalls exactly 4.8.3 into the adapter folder, about 52 MB, nothing global) |
| `shopify_session_missing` / `shopify_scopes_missing` | Run the check with `--connect` and approve in the browser while signed in to the store as the dedicated staff account. `--connect` requests the full derived scope list |
| `shopify_cli_incompatible` | The adapter install is damaged or moved; reinstall with `--install` |
| `shopify_api_version_unsupported` | Stop and report: moving the pin is a tested code change, never a workaround |

**Never type `shopify store auth` or any other bare `shopify` command.** `--connect` starts the
browser approval itself through the adapter's CLI with Shopify's self-update switched off; a
bare command would run another Shopify CLI and could upgrade a machine-wide installation.
Never run `npm -g`, `shopify config autoupgrade`, or change any Shopify CLI setting.

Exit codes: **0** passed and confirmed; **3** the first-connection question is pending;
**2** stopped (the printed code says why); **1** usage error.

Run the check **before discovery and before each extract**. Discovery refuses to start
(`shopify_session_not_checked`, `shopify_first_connection_unconfirmed`) until the latest check
passed for this store and the first-connection answer is `dedicated-account`.

### When the connection expires

A read whose CLI session expired stops the step with `source_auth_expired` and creates a
`manual_action` user action for the stage (`discovery` or `execution`); the run holds at
`awaiting_user_action`. **Requires Import Operator:** run the session check (with `--connect`
if asked), then answer the request and run the same step again. Only the receipt changes, so the
step resumes where it stopped and no finished read is repeated.

### The staff account after cutover

The first passing check after a `dedicated-account` answer records the account in
`data/shopify-discovery/staff-access.json`. From then on every completion report lists
`shopify-staff-account-removal` (high) until the owner's removal is recorded:

```bash
node scripts/shopify-session-check.js --project <dir> --confirm-staff-removal owner-removed-account
```

Remove the account only after cutover and after the last read from Shopify (including any
catch-up). If the confirmation reports the record unreadable or missing, run
`--repair-staff-access` first: it keeps the damaged file aside, rebuilds a `pending` entry and
never writes `confirmed`. Nothing else closes the action; never edit the file by hand.

## Discovery

Run from this skill directory:

```bash
node scripts/shopify-discovery.js --project <migrations-root>/<project> --store <shop>.myshopify.com
```

The steps run in this order. Each records its result in
`data/shopify-discovery/discovery-steps.json` before the next starts, so a restart runs only
the steps not yet recorded and reads no entity it already captured:

| Step | What it does | Writes |
| --- | --- | --- |
| `capture` | One count (where the API has one) and up to 3 sample records per entity, plus the shop and its policies | `entities/<entity>.json` |
| `withheld-details` | Eight ordinary 3-record probes classify withheld name, email, phone and address kinds for customers and orders | `kind-probes.json` |
| `gift-card-census` | Exact-count-gated gift-card census; every positive balance is owed | `bulk-manifest.json`, `gift-card-census.json` |
| `order-window` | Orders older than the CLI's ~60-day order-history window (below) | `order-window.json` |
| `questions` | Asks the merchant what earlier steps could not read, as discovery `question` user actions | answered `orchestration/user-actions/*.json` |
| `coverage` | Builds the coverage rows and writes the raw-capture index | `source-coverage.json`, `README.md` |

⚠️ When this bundle does not ship a step's implementation, discovery **stops at that step** with
`shopify_discovery_step_unavailable` (exit 2) after recording the steps before it. Do not work
around it: a discovery that skipped the check would look complete while missing data. Report it
to the user.

Exit codes: **0** complete; **3** a merchant question is pending — the run holds at
`awaiting_user_action`; answer it, then run the same command again (nothing is read again);
**2** stopped, with the reason code in the printed JSON; **1** usage error.

To re-read entities after their access is fixed, add `--reread <entity>` (repeatable). Only those
entities are read again; the coverage file is rebuilt.

**One store per capture.** The store is recorded in `discovery-steps.json` and in every
`entities/<entity>.json` before anything is read. A run for any other `--store` stops with
`shopify_discovery_store_mismatch` (exit 2) before reading or changing anything, so no artifact
ever combines two stores. `--restart` discards the whole `data/shopify-discovery/` capture
(steps, entities, every technical step's files, coverage file, index) and reads from scratch; it
keeps the connection records (`session-receipt.json`, `staff-access.json`). It
is refused with `shopify_restart_blocked_handoff` when this project already hands a different
store to mapping — `source-profile.md`, `source-schema.json` or the promoted
`discovery/source-coverage.json` exists — because those would keep presenting the first store:
start a new migration project for the other store instead. It also refuses with
`shopify_restart_blocked` while a merchant question from the previous capture is
still unanswered. Never delete files by hand to get past a mismatch.

### Order-history window

Through the CLI Shopify shows only the last ~60 days of orders, on every read path. The
`order-window` step reads `shop.createdAt`:

- shop older than the window, or `createdAt` unreadable → row `shopify:orders-before-window`;
- shop younger than the window → it reads the visible order with the earliest `processedAt`; one
  processed before the shop existed (imported history) → the row, no question; otherwise it asks
  the merchant "Were orders imported into this Shopify store from another system?" (`no` → no
  row; `yes` or `unknown` → the row).

Never use the visible orders' dates as proof of completeness. The row is `auth-gated` /
`requires-development`, holds the run at mapping until it has a disposition, and loss is
accepted only through a `loss-accepted` gate.

### Withheld customer and order details

The `withheld-details` step sends one ordinary query per entity and protected kind. A kind is
withheld only when Shopify returns an error path naming one of that kind's fields. A blank with no
error is the merchant's blank; the accepted policy deliberately adds no full-store census. A
pathless `ACCESS_DENIED`, an unrelated path or another failure produces `shopify:<entity>`
`capture-failed`, never a guessed kind. A pathless denial first rechecks the session and permits at
most one reapproval.

`kind-probes.json` records only outcomes, paths and error codes, plus the per-entity projection;
it never records customer values. Each completed probe is atomic, so restart sends only missing
probes. `--reread customers` or `--reread orders` also clears that entity's probes.

The extract removes exactly the withheld kind's fields from customer and order queries. Name is
first/last name; address is address lines, zip and geolocation. Company, city, province, country
and every other explicitly unprotected field remain. A customer is written to
`customers-withheld-identity.ndjson`, not `customers.ndjson`, only when an identity kind is
withheld and no readable name, email or phone remains. The manifest records
`withheldIdentityCount`, and the count check includes the sidecar.

### Gift cards: codes never move, balances remain owed

Shopify exposes only `lastCharacters` and `maskedCode`, never a reusable full code. Never create
a spendable Wix gift card from this read. The census and every extract run the same bulk query,
then gate it before `done` with `giftCardsCount(limit: null)` bound to the read's `createdAt`.
Only `precision: EXACT` with at least that many read cards passes. A short or inexact count, a
rejected filter, or an invalid plain-decimal amount fails the entry and records
`shopify:gift-cards`; the extract remains stopped until `--retry-failed` starts a new read.

Every positive balance is owed, including disabled cards and cards carrying an expiry date.
Money is summed exactly per currency without floating point or conversion. The census keeps only
counts, per-currency totals, disabled/expired counts and read evidence; it stores no card id,
masked code or customer value. A nonempty census emits `shopify:gift-card-codes`. If cards first
appear during extract, that row is added and the extract stops so mapping can decide it.

### Entities read

`products` (all statuses, with variants), `collections`, `orders` (with refunds and
fulfillments), `customers`, `gift-cards`, `discounts`, `pages`, `blogs`, `articles`, `menus`,
`locations`, `inventory-items`, `delivery-profiles`, `metaobjects` (listed through their
definitions, each with its count), `files`, `url-redirects`, and the singletons `shop` and
`shop-policies`. `lib/discovery-reads.js` holds each named query.

### Synthesize, then promote

After the script exits 0, synthesize `source-profile.md` and the project-root
`source-schema.json` from `data/shopify-discovery/entities/*.json`, following
`source-schema.example.json` in this directory. Per entity:

- `rawFile` is `entities/<entity>.json`; `recordCount` is its `count` **only when its
  `countExact` is true** (Shopify answered `precision: EXACT`). Otherwise `recordCount` is null:
  where the API has no count, say so; where the count is a lower bound (`countPrecision:
  "AT_LEAST"`), put it in `recordCountAtLeast` and never write it as `recordCount`. Never invent
  a count. `inUse` is true when samples were returned.
- An entity whose file carries `errors[]` is **not** synthesized as an empty entity: it is a
  coverage row already.
- Record in `source-profile.md`: access is the operator's Shopify CLI session, read-only; the CLI
  only shows recent orders; the store's currency and timezone from the `shop` singleton.

Then promote, from `rp-discovery`:

```bash
node scripts/promote-source-coverage.js <migrations-root>/<project> --adapter shopify
```

## Extract

The full store is read through Shopify's server-side **bulk export**, one dataset at a time,
never page by page. Run from this skill directory, after the session check:

```bash
node scripts/shopify-extract.js --project <migrations-root>/<project> [--retry-failed] [--catch-up]
```

The store comes from `config/source.shopify.env` (or `--store`). It writes
`data/source-extract/<entity>.ndjson` — `products`, `collections`, `customers`, `orders` (the
three order queries joined by order id: core, refunds, fulfillments), `gift-cards-codeless`, `discounts`,
`delivery-profiles`, `inventory-items`, `pages`, `blogs`, `articles`, `menus`, `url-redirects`,
`locations`, `metaobjects`, `files` — plus the optional
`customers-withheld-identity.ndjson` — and `data/source-extract/extract-manifest.json`. The 18
bulk queries and eight `probe-*.graphql` ordinary queries each start with a `# scopes:` line the
session check derives the required scopes from. Orders and customers are filtered to the
manifest's snapshot time `T`.

- **One operation at a time**, in the table order. Each state change is one atomic manifest
  write (`pending → starting → running → downloaded → done`, or `settling → failed | denied`), so
  a restart resumes at the exact state and a finished dataset is never read again. A dataset
  whose start was interrupted is simply started again; the first job's result is never read.
- **Only a complete download counts.** A file is `downloaded` only for HTTP 200, exactly
  `fileSize` bytes, ending in a newline, every line one JSON object. An expired link (HTTP 400 or
  403) re-runs the dataset (at most 2 times); other failures download again (3 tries), then one
  re-run, then `failed`.
- **A failed, expired, cancelled or partial operation** is re-run once, then `failed`
  (`shopify_bulk_failed`). A `failed` extract dataset stops the extract now and on every later
  start. `ACCESS_DENIED` first runs the session check; a refusal with a valid session is final
  for that dataset (customer and order queries go to the withheld-detail attribution of the
  customer/order spec; every other dataset is `failed`).
- **Customer/order denial attribution.** A valid-session bulk denial enters `settling`, then
  runs that entity's four ordinary probes. A named, newly withheld kind is upserted and promoted
  as its own coverage row and stops with `shopify_protected_fields_withheld`; after mapping, the
  denied query resets with the narrower projection. An all-readable, pathless or unrelated
  diagnostic is `unattributed`, leaves the projection unchanged and stops every start with
  `shopify_bulk_failed` until `--retry-failed`. Each diagnostic is keyed by query and
  `settlingAt`, so handler replay never sends a finished probe or duplicates a row.
- **`settling`** makes consequences recoverable: the verbatim error is written first, then the
  outcome's idempotent handler (the coverage row), then the terminal state. A restart reruns the
  handler of any `settling` dataset before anything else.
- **Overdue.** A job still preparing 4 hours after it started creates one `question` user action
  (`shopify_bulk_overdue`, choices `wait` / `abort`) and the step holds at
  `awaiting_user_action` (exit 3). Answer it and run the same command again. `abort` makes the
  dataset `failed` (`shopify_bulk_overdue_aborted`); Shopify's operation is not cancelled.
- **Count check.** After the read, customers (plus the withheld-identity file) and orders must
  reach Shopify's own exact count at `T`. Fewer, or a count Shopify gives only as `AT_LEAST`, is a
  `capture-failed` row `shopify:<entity>` (through `lib/import-findings.js` rules) and the stop
  `shopify_extract_count_short` / `shopify_extract_count_inexact`; the run goes back through
  mapping. A read is a picture of the store while it ran, not a frozen snapshot.
- **Gift-card gate.** While `gift-cards` is still `downloaded`, its exact count and every decimal
  amount are checked. Only a pass writes the codeless per-read file named by `cardsFile`, records
  owed counts and balances in the manifest, and permits `done`. Files no `done` entry names are
  ignored. `gift-cards-codeless.ndjson` contains no `maskedCode` and is never a Wix gift-card
  import file.
- **`--retry-failed`** (Import Operator): sends every stopping dataset — each `failed` entry, each
  unattributed `denied` entry, and the datasets whose count check stopped the extract — back to
  `pending` and reads them again. Nothing else is reset.
- **`--catch-up`** (the source catch-up rerun): archives a `complete` manifest as
  `extract-manifest.<T_prev>.json` and reads the whole store again in full with a new `T`. A
  manifest that is not complete is resumed instead. Without the flag a `complete` manifest with
  its final files present reads nothing.

Exit codes: **0** complete; **3** an overdue question is pending; **2** stopped (the printed
code says why; finished datasets are kept); **1** usage error. Stop codes are in
`rp-execute-import`. A manifest bound to another store stops with `shopify_extract_store_mismatch`.

**Cutover — final re-read.** Every import leaves one task: after the merchant's Shopify activity
stops (and before the staff account is removed), run the session check, then the rerun for new
and modified records, which runs `shopify-extract.js --catch-up`. Check that
`extract-manifest.json` says `complete`, every entry's `readAt` is after activity stopped, and the
rerun completed. **Requires Import Operator.**

**Cutover — export withheld details.** Any withheld-kind or hollow-customer row also keeps the
high `shopify-withheld-details-export` completion action open, whatever its mapping disposition.
After the final catch-up and after the merchant exports customers and orders from Shopify Admin,
record the attestation in the original migration environment:

```bash
node scripts/shopify-discovery.js --project <migrations-root>/<project> --confirm-withheld-export owner-exported
```

Regenerate the completion report and check the action is gone. A later Shopify read or a new
withheld row reopens it. This is an operator attestation, not a Shopify verification. The future
0197/0198 catch-up/checklist integration is not wired; the completion report is the durable
handoff. **Requires Import Operator.**

**Cutover — owed gift-card balances.** The completion report always reevaluates the high-severity
`shopify-gift-card-codes-not-migrated` action whenever `shopify:gift-card-codes` exists, even
after its loss was accepted. **Requires Import Operator:**

```bash
node scripts/shopify-gift-card-remedy.js export --project <project>
node scripts/shopify-gift-card-remedy.js activity-stopped --project <project> --at <ISO-time> --by <name>
# Run the final --catch-up read here.
node scripts/shopify-gift-card-remedy.js record-replacements --project <project> --evidence <file.csv> --by <name>
# Or record the still-open date on which Shopify will stop redeeming them:
node scripts/shopify-gift-card-remedy.js keep-redeeming --project <project> --until <YYYY-MM-DD> --by <name>
```

`export` writes `data/shopify-cutover/gift-cards-owed.csv` with id, last characters, balance,
currency, enabled, expiry and current replaced state — no code or customer column. A card closes
only when the current manifest has a successful read started after `activity-stopped`, and its
CSV evidence names a Wix replacement worth at least that card's balance in the same currency
plus a non-future holder-notification date and confirmer. A newer card or higher balance reopens
that card; a pending/failed read or newer activity-stop record reopens all. Keeping Shopify
redeeming is never closure.

## Coverage rows

The adapter always writes `data/shopify-discovery/source-coverage.json` (`platform: "shopify"`,
`adapter: "shopify"`), with `rows: []` when there is nothing to report. Rows are decided at
mapping like any source's rows.

| `coverageId` | When | `reason` | `recoverability` |
| --- | --- | --- | --- |
| `shopify:<entity>` | A discovery read of that entity failed | `capture-failed` | `import-operator` |
| `shopify:<entity>` | A throttled read, an unattributed protected-field probe, a failed or overdue-aborted extract dataset, or a full read short of Shopify's count | `capture-failed` | `import-operator` |
| `shopify:orders-before-window` | Orders older than the CLI window may exist (order-window step) | `auth-gated` | `requires-development` |
| `shopify:customer-<kind>`, `shopify:order-<kind>` (`name`, `email`, `phone`, `address`) | An ordinary probe error path names that withheld kind | `auth-gated` | `requires-development` |
| `shopify:customers-withheld-identity` | At least one extracted customer has no readable identity after projection | `auth-gated` | `requires-development` |
| `shopify:gift-card-codes` | Gift-card codes are never readable | `route-unsupported` | `not-recoverable` |

`capability` is the registry string where one exists (`commerce.orders`, `crm.contact`,
`commerce.gift-cards`, `commerce.catalog-product`, …); otherwise `null` with
`capabilityUnregistered: true`. ⚠️ A row carries no count field; counts stay in the entity files
and the row's `evidence` points at them.

## Read contract

For `rp-import-codegen` when `source-schema.json.platform === "shopify"`:

- Vendor `lib/shopify-cli.js` and read only through it, with its defaults (the adapter's CLI,
  `CI=1`, `--version 2026-10`); never pass `command` or `env`. No direct HTTP, no stored token,
  never `--allow-mutations` for a read. The discovery samples and counts page with `readAllPages`
  (`first: 250`, 500 ms apart); a full-store read never does.
- Run the session check before each extract. On `source_auth_expired` call
  `lib/shopify-session.js` `recordAuthExpired(projectDir, { stage: 'execution', store })` and stop;
  the extract resumes from its manifest after re-approval.
- The full-store extract is the adapter's bulk extractor (`scripts/shopify-extract.js`, above), not
  a generated per-record pager: generate the importer to read `data/source-extract/<entity>.ndjson`
  only when `extract-manifest.json` says `complete`. If this bundle does not ship
  it, stop codegen and report it.
- **A gap first found during the extract** is recorded with `lib/import-findings.js`
  `stopWithFinding(projectDir, { row, code })`: the row is added to the raw coverage file by
  `coverageId` (replacing a row with the same id), the file is re-promoted, and the extract stops
  with `code`. From there the run goes back through mapping by the pipeline's general path, the
  same as for every source.

## Not in this adapter

- Installed apps and their data (reviews, subscriptions, loyalty points) are not inventoried
  here.
- The merchant's own CSV exports go through `rp-source-csv`, a separate, degraded route.
- The final catch-up remains the source-catch-up task shared with every source. Withheld-detail
  export and staff-account removal are tracked here (above) until the cutover checklist carries
  them.
