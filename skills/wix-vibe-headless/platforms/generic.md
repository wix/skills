# Wix Managed Headless — build instructions

You are building a **Wix Managed** headless site. The business to build, and your Wix client id
and metasite id, are given in your initial prompt. Follow the steps below:

1. **Install the Wix skills locally**
2. **(optional) Brief doesn't say what to build? Ask, or read the site**
3. **Build the client**
4. **Seed and manage the business** (run in parallel with 3)
5. **When done** (required: mount the dev-only manage banner + point the user to the Wix dashboard)

## STEP 1 — Install the Wix skills locally

Install three skills — they land under `.agents/skills/` as:
- **`wix-vibe-headless`** — the client build guide: how to build the frontend against the Wix
  APIs. This is your main source of truth (STEP 3).
- **`wix-headless`** — a broad skill for building full Wix apps with the Wix SDK packages, **most
  of which does not apply to how you build here**. Use it **only** as a seeding/admin recipe
  reference — its `references/SEED.md` and `references/inline-recipes/`, for STEP 4. **Ignore
  everything else in it** — in particular do **not** follow its authentication / `@wix/cli` /
  "managed project" setup (e.g. anything under `references/managed/`, such as `AUTHENTICATION.md`).
  That is **not** how auth works here — auth is handled per STEP 4 below.
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

## STEP 2 (optional) — Brief doesn't say what to build? Ask, or read the site

Only needed when the business description in your prompt is vague or missing — otherwise skip
to STEP 3. Don't guess which Wix Business Solution to build (stores, bookings, blog, events,
portfolio, restaurants, CMS, pricing plans, members, etc..): **ask the user** one short
question (what do they offer?), or — with an admin-grade Wix credential (connector token or
API key, per STEP 4; the public `WIX_CLIENT_ID` is not enough) — **read the site in one call**:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"siteId": "<metasite id from your prompt>"}'
```

It returns a markdown report of the site — installed apps (by name), status, URL, locale, and
CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md);
with an API key send it raw as the `Authorization` value, no `Bearer`). Build for the solutions
whose apps are installed (several → prioritize by the user's words and by which holds real,
non-sample content); the same set drives STEP 4's seeding — never seed guessed ones.

## STEP 3 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **exactly** — it is the single
source of truth for how the client app is built against the Wix APIs (over the public
`WIX_CLIENT_ID`, which is a buyer/visitor-facing credential, safe in the frontend). To save time,
prefer copying the ready-made files the `wix-vibe-headless` skill provides (e.g. the Wix client
setup) and adapting them over re-generating them from scratch.

## STEP 4 — Seed and manage the business

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

If possible, run STEP 3 and STEP 4 in parallel — building the client and seeding the business
are independent. Within each, also parallelize independent work (API calls, seeding multiple
entities) to finish faster.

## Later admin requests

For any later admin/management request, work the same way as STEP 4: check the `wix-headless`
skill's inline recipes first (`.agents/skills/wix-headless/references/inline-recipes/`) and fall
back to the `wix-docs` skill where the operation isn't documented there.

## When done

After the site is built and seeded:

1. **Add the dev-only manage banner** (required) (links the app to its Wix back office): copy the
   `wix-vibe-headless` skill's `references/shared/wix-manage-banner.js` next to
   `wix-client.js`, set `WIX_METASITE_ID` to your metasite id, and call
   `mountWixManageBanner()` once from the app entry. The file already gates itself to dev
   builds (via `import.meta.env.DEV`) — use it as-is, don't rewrite it — but you own the
   guarantee: verify the gate actually holds in this stack, and that a production build never
   shows the banner (no dev flag → no banner at all). Also verify it really pushes the site
   down: a `fixed`/`absolute` app header is not in normal flow and will slide under the
   banner — offset such a header by the banner's height.
2. **Ask the user to open** this URL to complete the setup in Wix (required; substitute the
   metasite id you were given): `https://manage.wix.com/dashboard/{metaSiteId}` — and, since
   the banner from step 1 is mounted, also tell them: *in dev builds the site shows a slim
   banner at the top linking straight to this Wix dashboard (dismissible; never shown in
   production).*
