---
name: rp-destination
description: Resolves, adopts, or creates the one Wix Managed Headless destination for a migration.
---

# rp-destination

Use only when no authoritative destination is available or the destination contract
conflicts.

Precedence is host-supplied destination, then non-empty `config/wix.env` site id, then one
new Wix Managed Headless site. A conflict is a hard stop; never retarget on a guess.

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

After resolution, report the deterministic dashboard URL and return to the router. Source
credentials are never requested until this destination exists.
