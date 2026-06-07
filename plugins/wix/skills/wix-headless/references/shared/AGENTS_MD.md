# AGENTS.md — the end-of-run site doc

The orchestrator writes one file at the end of a successful run: a project-root `AGENTS.md` describing **what the site has**. It is the one end-of-run artifact — *content about the site*, not telemetry. A fresh session (or a coding agent) opening the project reads it to learn what's there.

## Author, location, timing

- **Author:** the orchestrator, in the final turn. Composed **from session scratch** (brand, frontend, verticals, the page/route list it built) **+ `.wix/seeded.json`** (entity counts). **Re-read nothing** to compose it.
- **Location:** project-root `AGENTS.md` — the conventional path agents auto-read. Root, not `.wix/`. It sits outside the astro/Vite bundler root, so it never ships to `dist/`.
- **Timing:** the **last tool call of the final message**. Summary prose (the live URL) first; `Write AGENTS.md` last — same ordering discipline `BUILD.md` § "Final Message" defines.

## Content — fill this template, slotted values only

Deterministic projection of scratch + seeded counts → same inputs produce a byte-identical file. Emit exactly these sections; no free prose beyond the slots.

```markdown
# <brand>

A Wix headless site built with the `wix-headless` skill. <one-line brand description>.

## Live site
- **Site:** <published URL>
- **Dashboard:** https://manage.wix.com/dashboard/<siteId>

## Frontend
<astro (Wix-hosted) | custom>. Run: `<wix dev | npm run dev>`. Build + publish: `<wix release | npm run build then wix release>`.

## Features
- <one bullet per loaded, non-disabled vertical, in plain language>
  Stores → a product catalog · CMS → content collections (About, FAQ, …) · Blog → posts · Forms → a contact form · Gift cards → activate from the dashboard

## Pages
<one line per route that exists: `/`, `/products`, `/products/[slug]`, `/cart`, …>

## Seeded content
<counts only: "3 products across 2 categories · 6 blog posts · About + FAQ collections.">

## Extending
Built with the `wix-headless` skill; re-run it to add features or restyle.
```

## Excluded — never in AGENTS.md

No per-phase timings, statuses, `started`/`ended`/`seconds`, `x-wix-request-id`s, error codes, subagent handles, recoveries, or rate-limit notes. If a field would only matter to someone debugging the *run*, it does not belong here. (Entity IDs stay in `.wix/seeded.json`, not here — counts only.)

## Not a state file

`AGENTS.md` is reading material. Project **detection** ("is this a wix-headless project / which frontend") keys off `wix.config.json` + the `@wix/astro` dep in `package.json` — never `AGENTS.md` presence.
