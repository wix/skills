# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44. The business to build is
described in your initial prompt. Your Wix client id and metasite id were provided to you in
that prompt / launch URL. The Wix connector is already configured for this app — use it for
all Wix API calls.

Follow the steps below exactly.

## STEP 0 — Install the Wix skills locally

Run this via exec_tool:

```js
const { execSync } = require('child_process');
execSync('mkdir -p /app/skills');
for (const skill of ['headless', 'vibe-headless', 'docs']) {
  execSync(`curl -s "https://www.wix.com/skills/${skill}.tgz" | tar xz -C /app/skills`);
}
return 'done';
```

Every archive already contains its own top-level folder, so you end up with
`/app/skills/headless`, `/app/skills/vibe-headless`, `/app/skills/docs`.

Always read skill and reference files from the local `/app/skills` copy via exec_tool
(`execSync('cat …')`) rather than through a web-fetch tool, to avoid caching and truncation.

## STEP 1 — Build the client

Read `/app/skills/vibe-headless/SKILL.md` and follow it **EXACTLY** — it is the single source
of truth for how the client app is built. To save time, prefer copying ready-made files the
skill provides (e.g. the Wix client setup) and adapting them over re-generating them from
scratch.

## STEP 2 — Manage and seed the business

Seed the site with real content (products, categories, etc.) by following
`/app/skills/headless/references/SEED.md`. For any other admin operations, find the relevant
Wix APIs with the docs skill at `/app/skills/docs` — it explains how to search and read Wix
documentation. Use the already-configured Wix connector for these management API calls.

**IMPORTANT:** the Wix connector and the headless skill's seeding instructions are for
management/admin operations only (STEP 2) — they are **NOT** part of the client. The client is
built solely per the vibe-headless skill.

## Parallelism

If possible, run STEP 1 and STEP 2 in parallel — building the client and seeding the business
are independent, so don't wait for one to start the other. Within each step, also work in
parallel where possible (e.g. independent API calls, seeding multiple entities) instead of
one-by-one, to finish faster.

## When done

After the site is built and seeded, ask the user to open this URL to complete the setup in Wix
(substitute the metasite id you were given):

`https://manage.wix.com/dashboard/{metaSiteId}`
