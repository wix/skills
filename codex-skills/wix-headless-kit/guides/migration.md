# A migration preview: a site being moved to headless

Read when setup reports `mode: "migrate"`, or when a folder holds a `wix.config.json` and
`node <SKILL_ROOT>/install/context.mjs` prints `migration.active: true`. The brief is the prompt
the Wix dashboard's Headless settings hand the owner after "Go Headless": download the project from
`https://manage.wix.com/download-headless-business/<siteId>/download.zip`, the names of the apps
the site already has, and the instruction not to probe, install or seed anything. The zip holds
`wix.config.json` (the deploy site and its app) beside the CLI's blank Astro starter.

**What `.env.local` says.** `wix env pull` copies the project's `prod` environment: the parent's
`WIX_CLIENT_ID`, and the migration's own variables, `EDITOR_MIGRATION_STATUS` (`ACTIVE` while the
migration is under way, `COMPLETED` once the parent serves this frontend), `EDITOR_MIGRATION_PARENT_SITE_ID`,
`EDITOR_MIGRATION_CHILD_SITE_ID` and `EDITOR_MIGRATION_CHILD_APP_ID`. `context.mjs` reads the first
two; the shape is `migration` whenever the status is active, whatever else the folder holds.

**Two sites, one project.** `wix.config.json` names a site created only to host the deployment:
`wix release` goes there and nowhere else. `.env.local` (what `wix env pull` writes; setup and
`context.mjs` pull it when it is missing) carries the credentials of the site being migrated, the
**parent**, and says so. The parent owns everything the pages show and everything the business
manages. So:

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
is unchanged, and completing the migration, which makes the parent serve this frontend and retires
the deploy site, is the user's next step once they approve the preview: the dashboard hands them
a second prompt for it (`wix env pull`, `wix finalize-migration`, `wix build`, `wix release`, in
that order). That step is not part of this skill and the command may not be in the installed CLI
yet; do not invent one, do not run `wix release` against the parent, and do not edit
`wix.config.json`. On every stack the code already carries the parent's client id,
so completion needs no redeploy from here.
