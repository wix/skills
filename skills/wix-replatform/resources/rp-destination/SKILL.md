---
name: rp-destination
description: Resolves, adopts, or creates the one destination site (Headless, Wix Studio or Wix Harmony) for a migration.
---

# rp-destination

Use only when no authoritative destination is available or the destination contract
conflicts.

Precedence is the creation receipt `orchestration/destination.json`, then a non-empty
`config/wix.env` site id (an existing or legacy destination: adopt it, never ask for a type),
then one new site of the operator's explicitly chosen type. A conflict is a hard stop;
never retarget on a guess.

## New site: run the coordinator

For a new site, run the deterministic coordinator; do not compose creation requests yourself:

```bash
node <skill>/scripts/wix-destination.js ensure --project-dir <projectDir>
```

It prints a JSON outcome and never prints credentials:

- `awaiting_site_type` — no `targetSiteType` is recorded. It raised the one required
  site-type request (`headless`, `studio`, `harmony_store`, `harmony_bookings`,
  `harmony_other`, or `harmony` = "not sure, start blank"). In chat, ask that combined
  question once; in one-click, group it with the other missing intake; in `replatform`
  runs, end the turn — the request is the question. Record a chat answer with
  `orchestration-state.js decide --key targetSiteType --value <type> [--business-type
  store|bookings|other]`; a Harmony answer without a business type records `unknown`. Never
  ask a separate business-type question, never answer for the operator, and never turn a
  generic "Editor" answer into Studio or Harmony. There is no default type, including in
  one-click and backend-only runs.
- `awaiting_editor_website_decision` — `management_and_website` with Studio/Harmony: the
  request explains that RePlatform has no automatic Editor website migration. The operator
  chooses backend only (scope becomes `management`) or a separate Editor website handoff.
- `awaiting_account_confirmation` — before the first Studio/Harmony create, the request
  names the account the Wix CLI is logged into and the site name. Relay it; never answer it
  for the operator. `confirm_account` binds that account; `switched_account` shows the
  account again after a login change. A login that differs from the confirmed account is
  never used for a create.
- `verified` / `created` / `existing_destination` — report the dashboard URL (and, for an
  Editor site, the verified editor URL) and return to the router.
- `failed_before_create`, `ambiguous`, `awaiting_recovery`, `blocked` — a durable recovery
  request is pending (named by `recoveryRequestId`). Relay it; never retry around it.

When the run context already establishes the business type for a Harmony site, write it
before running the coordinator so the request collapses Harmony to one choice:
`orchestration/destination-brief.json` with `businessType` (`store`, `bookings`, `other`) and
`businessTypeEvidenceRef` (where the evidence came from). The type is context for the run; it
does not change how the site is created. Never invent details.

What the coordinator does:

- Holds `orchestration/destination.lock`, rechecks the receipt and `config/wix.env`, and
  writes an attempt marker before any create. Studio and Harmony use their blank templates
  through `POST /msm/v1/meta-site/create-from-template` with the Wix CLI account login.
  Harmony's AI site generation runs on a private Wix service with no stability promise, so it
  is not used for any business type. Headless delegates once to
  `wix-headless-scaffold.js` (below).
- Saves the returned metasite id in the receipt, checks that the response's owner is the
  confirmed login, then writes `WIX_SITE_ID` to `config/wix.env` (never over a different
  value), mints a site-scoped Wix CLI credential, and verifies the editor (`WIX_STUDIO` /
  `ODEDITOR`) and that the site is unpublished (published-URLs readback). Only a fresh
  `unpublished` readback lets import continue: every rerun on a `verified` site repeats the
  readback, and the router sends setup/import back here (`destination_publication_recheck`)
  when the last readback is more than 10 minutes old.
- A Headless receipt is resumed, never re-delegated: a confirmed site is adopted, and any
  `WIX_SCAFFOLD_STATUS` marker stays the wrapper's recovery.
- Never repeats a create whose outcome is unknown, never publishes,
  unpublishes or deletes a site, and never falls back to another editor or to Headless.

Recovery requests and what each answer does (each answer triggers one bounded step):

| Request | Choice | Effect |
| --- | --- | --- |
| Pre-create rejection (access, site limit, template, name) | `retry_create` | one new creation attempt after the prerequisite is fixed |
| Uncertain creation (**Requires Import Operator**) | text: the metasite id, or `none-created: <evidence>` | adopt and verify that site, or one new attempt only with recorded evidence that nothing was created |
| Response owner missing or not the confirmed login (**Requires Import Operator**) | text: `owner-verified: <evidence>` | editor and publication verification of the kept site; any other reply asks again |
| Editor not verified | `recheck` | one new editor + publication readback; no create |
| Publication `unknown` | `recheck` | one new readback; the answer itself proves nothing |
| Publication `published` | `recheck_after_unpublish` | one new readback after a person unpublished the site in Wix |

Import Operator prompt for an uncertain creation, editor mismatch or a
`published`/`unknown` readback: "In the original migration workspace, reconcile the
destination creation attempt against the intended account, preserve the returned metasite ID,
rerun editor verification and the published-URLs
readback, and resume only after recording the resolved receipt. Do not create a replacement
site, and do not publish or unpublish it without an explicit human publication decision."

An Editor site is not a website build: never scaffold Headless frontend files for it, and
never hand it to `wix-headless-replatform`. Its website and publication stay outstanding for
the site owner/designer and the Cutover Operator (completion-report `operatorActions`).

## Headless

For Headless creation, the coordinator runs the wrapper once; the wrapper confirms the Wix
CLI is logged into the intended account, scaffolds inside the active migration project, and
persists the metasite id. Always scaffold with
`--site-template blank`, whatever the delivery mode or whether the migration carries a
catalog — Catalog V3 is guaranteed at provisioning regardless of template, so there is no longer a reason to start
from a non-blank template. Let `wix-headless-replatform` supply the actual page content;
do not skip this module just because there is no backend work. Do not create probe, test,
replacement, or second sites without the explicit recovery authority in the existing
destination contract.

Scaffolding (`wix-headless-scaffold.js`) publishes the site as part of creation — this is
the Wix CLI's own default; never add `--no-publish` back. A `management`-only migration's
entire deliverable is this published site running its unmodified template: "no
customer-facing website is built" means left un-customized, not left unpublished.

The script also patches the generated `astro.config.mjs`/`package.json` right after a
destination is confirmed, once, so a `website`-mode project's local dev server works
without manual fixes, on any client running it from a Wix Remote Machine: a Vite
`allowedHosts` wildcard + `host: true` (the remote machine's dynamic preview hostname and
its 127.0.0.1-only default otherwise break a local preview with a host-block or a 504),
and `predev`/`prebuild`/`prerelease` hooks that re-run `wix env pull` (the frontend's
`.env.local` — `WIX_CLIENT_ID` and friends — is gitignored and is wiped whenever the
remote machine restarts, so it must be re-derived, not assumed to persist). The Vite patch
is conservative: it skips (logging why) rather than touch a config shape it doesn't
recognize, so a template that already sets these deliberately wins. The hooks patch instead
composes `wix env pull` in front of whatever a hook already runs — idempotently, never
duplicated on a re-run — since an existing hook is almost always doing something unrelated
(e.g. codegen) and skipping it outright would silently leave that project without a working
preview.

After resolution, report the deterministic dashboard URL and return to the router. Source
credentials are never requested until this destination exists.

## Output

`config/wix.env`'s `WIX_SITE_ID` persisted, `orchestration/destination.json` for a new site
(choice, creation method, attempt, metasite id, verified editor and publication readback),
and the reported dashboard URL — or a durable request in `orchestration/user-actions/` that
names what is missing. This is what a dispatched run must produce.
