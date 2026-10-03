---
name: rp-destination
description: Resolves, adopts, or creates the one Wix Managed Headless destination for a migration.
---

# rp-destination

Use only when no authoritative destination is available or the destination contract
conflicts.

Precedence is non-empty `config/wix.env` site id, then one new Wix Managed Headless site.
A conflict is a hard stop; never retarget on a guess.

For creation, confirm the Wix CLI is logged into the intended account, scaffold once inside
the active migration project, and persist the metasite id. Always scaffold with
`--site-template blank`, whatever the delivery mode or whether the migration carries a
catalog — Catalog V3 is guaranteed at provisioning regardless of template (see
`0079-catalog-v3-guaranteed-retire-v1-gate.md`), so there is no longer a reason to start
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
