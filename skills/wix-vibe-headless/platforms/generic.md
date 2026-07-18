# Wix Managed Headless — build instructions

You are building a **Wix Managed** headless site. The business to build, and your Wix client id
and metasite id, are given in your initial prompt. Follow the steps below.

## STEP 0 — Install the Wix skills locally

Get the three skills — `headless`, `vibe-headless`, `docs` — onto local disk so you can read
them from files (fetching skill docs over the web truncates and caches large files). Use
whichever fits your environment:

- **Skills CLI:** `npx skills add wix/skills` — installs all Wix skills locally.
- **Tarball:** download and unpack each `https://www.wix.com/skills/<name>.tgz`; each expands to
  its own top-level folder (`headless/`, `vibe-headless/`, `docs/`) — extract them side by side.
- **Raw files:** fetch individual files under `https://www.wix.com/skills/<name>/…` (use
  `https://www.wix.com/skills/<name>.manifest.json` to list them).

Then read the skill and reference files from your local copies, not over the web.

## STEP 1 — Build the client

Read `vibe-headless/SKILL.md` and follow it **exactly** — it is the single source of truth for
how the client app is built against the Wix APIs (over the public `WIX_CLIENT_ID`, which is a
buyer/visitor-facing credential, safe in the frontend). To save time, prefer copying the
ready-made files the skill provides (e.g. the Wix client setup) and adapting them over
re-generating them from scratch.

## STEP 2 — Seed and manage the business

Seed the site with real content by following the `headless` skill's `references/SEED.md`. Where
its seed recipes don't cover what you need, fall back to the `docs` skill to search and read the
relevant Wix API docs.

These management/admin calls need **elevated Wix credentials** — the public client id is not
enough. If you don't already have a way to authenticate them, **ask the user for a Wix API
key / token** and store it in your platform's built-in **connector / secrets (env) manager** —
never hardcode or commit it — then use it to authenticate the REST admin calls (the `docs` skill
covers Wix API-key auth). Or, if the user prefers, tell them they can add this content themselves
in the Wix dashboard instead.

Management/admin operations (seeding, `headless`, `docs`) are **separate from the client** — the
client is built solely per the `vibe-headless` skill.

If possible, run STEP 1 and STEP 2 in parallel — building the client and seeding the business
are independent. Within each, also parallelize independent work (API calls, seeding multiple
entities) to finish faster.

## Later admin requests

For any later admin/management request, work the same way as STEP 2: check the `headless`
skill's inline recipes first (`references/inline-recipes/`) and fall back to the `docs` skill
where the operation isn't documented there.

## When done

After the site is built and seeded, ask the user to open this URL to complete the setup in Wix
(substitute the metasite id you were given): `https://manage.wix.com/dashboard/{metaSiteId}`
