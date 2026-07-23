# Wix Managed Headless — build instructions

You are building a **Wix Managed** headless site. The business to build, and your Wix client id
and metasite id, are given in your initial prompt. Follow the steps below.

## STEP 0 — Install the Wix skills locally

Install three skills — they land under `.agents/skills/` as:
- **`wix-vibe-headless`** — the client build guide: how to build the frontend against the Wix
  APIs. This is your main source of truth (STEP 1).
- **`wix-headless`** — a broad skill for building full Wix apps with the Wix SDK packages, **most
  of which does not apply to how you build here**. Use it **only** as a seeding/admin recipe
  reference — its `references/SEED.md` and `references/inline-recipes/`, for STEP 2. **Ignore
  everything else in it** — in particular do **not** follow its authentication / `@wix/cli` /
  "managed project" setup (e.g. anything under `references/managed/`, such as `AUTHENTICATION.md`).
  That is **not** how auth works here — auth is handled per STEP 2 below.
- **`wix-docs`** — a **fallback**: how to search and read the Wix API reference docs, for anything
  the seeding recipes above don't cover.

Install them so you can read them from files as you go (fetching skill docs over the web
truncates or summarises large files).

**Run the Skills CLI** — this is the install path to use:
```bash
CI=1 npx skills@latest add wix/skills/skills/wix-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-vibe-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-docs --yes
```

**Only if the CLI above actually errors** (not on a guess), fall back to curl + gzip — download
each bundle and extract it into `.agents/skills/wix-<name>/`:
```bash
for s in headless vibe-headless docs; do
  mkdir -p ".agents/skills/wix-$s"
  curl -s "https://www.wix.com/skills/$s.tgz" | tar xz -C ".agents/skills/wix-$s" --strip-components=1
done
```

## STEP 1 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **exactly** — it is the single
source of truth for how the client app is built against the Wix APIs (over the public
`WIX_CLIENT_ID`, which is a buyer/visitor-facing credential, safe in the frontend). To save time,
prefer copying the ready-made files the `wix-vibe-headless` skill provides (e.g. the Wix client
setup) and adapting them over re-generating them from scratch.

## STEP 2 — Seed and manage the business

Seed the site with real content by following the `wix-headless` skill's `references/SEED.md`
(`.agents/skills/wix-headless/references/SEED.md`). Where its seed recipes don't cover what you
need, fall back to the `wix-docs` skill to search and read the relevant Wix API docs.

**Seeding is additive.** You may clean up the app install's **obvious default sample/mock data**
right after a fresh install, but the site may already hold **real content** (a prior run, or
owner-added) — if what's there isn't obviously install sample data, or you're unsure, **do not
delete or overwrite it without the user's explicit ask or approval** (ask first).

These management/admin calls need **elevated Wix credentials** — the public client id is not
enough. If you don't already have a way to authenticate them, either **connect your platform's
Wix connector** (if it has one) or **ask the user for a Wix API key / token** and store it in your
platform's built-in **connector / secrets (env) manager** — never hardcode or commit it. **Once
the connector is connected (or the API key is in place), you can make Wix REST admin calls
directly** — authenticate each call with that credential (the `wix-docs` skill covers Wix API-key
auth). Or, if the user prefers, tell them they can add this content themselves in the Wix
dashboard instead.

Authenticate admin calls with **only** that connector/API key. Do **not** install or run the Wix
CLI (`@wix/cli`), do a device-login, or follow `wix-headless`'s `references/managed/AUTHENTICATION.md`
— that managed-project auth flow does not apply here.

Management/admin operations (seeding, `wix-headless`, `wix-docs`) are **separate from the
client** — the client is built solely per the `wix-vibe-headless` skill.

If possible, run STEP 1 and STEP 2 in parallel — building the client and seeding the business
are independent. Within each, also parallelize independent work (API calls, seeding multiple
entities) to finish faster.

## Later admin requests

For any later admin/management request, work the same way as STEP 2: check the `wix-headless`
skill's inline recipes first (`.agents/skills/wix-headless/references/inline-recipes/`) and fall
back to the `wix-docs` skill where the operation isn't documented there.

## When done

After the site is built and seeded, ask the user to open this URL to complete the setup in Wix
(substitute the metasite id you were given): `https://manage.wix.com/dashboard/{metaSiteId}`
