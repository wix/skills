# A migration preview: a site being moved to headless

Read when setup reports `mode: "migrate"`, when a folder holds a `wix.config.json` and
`node <SKILL_ROOT>/install/context.mjs` prints `migration.active: true`, or when the user asks to
complete the migration (the dashboard's second prompt names `wix finalize-migration`). The brief is
the prompt the Wix dashboard's Headless settings hand the owner after "Go Headless": download the
project from `https://manage.wix.com/download-headless-business/<siteId>/download.zip`, the names of
the apps the site already has, and the instruction not to probe, install or seed anything. The zip
holds `wix.config.json` (the deploy site and its app) beside the CLI's blank Astro starter.

**What `.env.local` says.** `wix env pull` copies the project's `prod` environment: the parent's
`WIX_CLIENT_ID`, and the migration's own variables, `EDITOR_MIGRATION_STATUS` (`ACTIVE` while the
migration is under way, `COMPLETED` once the parent serves this frontend), `EDITOR_MIGRATION_PARENT_SITE_ID`,
`EDITOR_MIGRATION_CHILD_SITE_ID` and `EDITOR_MIGRATION_CHILD_APP_ID`. `context.mjs` reads the first
two; the shape is `migration` whenever the status is active, whatever else the folder holds.

**Two sites, one project.** `wix.config.json` names a site created only to host the deployment:
`wix release` goes there and nowhere else until completion repoints the config (below). `.env.local`
(what `wix env pull` writes; setup and `context.mjs` pull it when it is missing) carries the
credentials of the site being migrated, the **parent**, and says so. The parent owns everything the
pages show and everything the business manages. So:

- **The SDK client is the parent's.** The Astro integration reads `WIX_CLIENT_ID` from the env and
  never the config; `deploy.mjs` copies the same value into `src/wix/config.ts` (react, lib) and
  `js/wix/config.js` (static). Nothing in the data layer is told about the migration; it reads the
  parent because its client is the parent's app.
- **Admin, discovery and seed calls target the parent.** `read-site.mjs` and the seeds resolve the
  site through `templates/shared/seed/site-context.mjs`; `wix-manage` recipes and any raw call take
  `--site <parentSiteId>` (the `siteId` of the `ready_for_brand_layer` event). The dashboard link
  is the parent's.
- **Nothing is seeded, nothing installed.** The parent is a live site with its content; a seed
  would write into the original. The seeds refuse on a preview unless run with `--allow-parent`,
  which is the user's explicit decision, never a default. Apps are not installed: the brief names
  what the site has, and the verticals follow from that list (Wix Stores → storefront, Wix
  Bookings → bookings, Wix Forms → forms, and so on per the Verticals table; Wix Pro Gallery and
  Wix Members Area map to portfolio and members). When the brief allows reading, the vertical's
  `read-site.mjs` sizes the content as in `guides/existing-site.md`; when it says not to probe,
  design from the brief.

**The run.** `setup.mjs --vertical <vertical>[,<vertical>…] [--stack <stack>]` in the folder (every vertical the brief needs, in one call): it keeps the
starter the download carries and deploys the vertical's code and dependencies into it (a bare config
gets the composed template copied in around it), starts the install, writes the project's AGENTS.md
with the migration recorded, and skips the seed. Then
SKILL.md steps 4 and 5 as for any run. `attach.mjs` refuses a migration folder on purpose: the
app, hosting and credentials came with the download; nothing is provisioned or re-pointed.

**The close.** The release is a **preview** on the deploy site. Close with the preview URL (copied
from the `wix release` output), the parent's dashboard link, and the two facts: the original site
is unchanged, and completing the migration puts this frontend live on the parent and retires the
deploy site. Offer to complete it once they approve the preview.

## Completing the migration

Run it once the user approves the preview and asks to go live, or pastes the dashboard's finalize
prompt: it switches the parent's live site to this frontend. The calls target the parent
(`migration.parentSiteId` from `context.mjs`).

1. **Read the migration.**

   ```bash
   curl -sS "https://www.wixapis.com/headless-business-setup/v1/editor-migrations" \
     -H "Authorization: $(npx -y @wix/cli@latest token --site <parentSiteId>)"
   ```

   `migration.phase` `ITERATING` → step 2; `MIGRATION_FINALIZING` or `COMPLETED` → step 3;
   `PREPARING` → the preview release is not observed yet, read again shortly; anything else → stop
   and report it with the dashboard link.

2. **Accept it**, as the dashboard's Complete Migration button does. On
   `STALE_MIGRATION_REVISION`, read again and resend.

   ```bash
   curl -sS -X POST "https://www.wixapis.com/headless-business-setup/v1/editor-migrations/prepare-commit" \
     -H "Authorization: $(npx -y @wix/cli@latest token --site <parentSiteId>)" \
     -H "Content-Type: application/json" \
     -d '{"migrationId":"<migration.id>","expectedRevision":<migration.revision>}'
   ```

3. **Release to the parent.** `npx @wix/cli@latest finalize-migration` (`@wix/cli` 1.1.256 or later)
   repoints `wix.config.json` to the parent, builds and releases. React and static projects have no such command: set
   `wix.config.json`'s `appId` and `siteId` to `.env.local`'s `WIX_CLIENT_ID` and
   `EDITOR_MIGRATION_PARENT_SITE_ID`, then build and release as in SKILL.md step 5.

Close with the parent's URL and its dashboard link, and say Wix finishes the switch on its side;
the dashboard notifies them when it is done. Later changes ship with a plain build and
`wix release`.
