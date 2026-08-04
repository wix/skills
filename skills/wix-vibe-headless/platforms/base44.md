# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44. The business to build is
described in your initial prompt. The Wix connector is already configured for this app — use
it for all Wix API calls.

Your Wix client id is given in your prompt. It's a public, buyer/visitor-facing credential (it
only mints anonymous visitor tokens), so it's safe in the frontend — use that value directly for
the Wix client setup.

> **`wix-vibe-headless`, `wix-headless`, and `wix-docs` are the complete build and seed path for this app — the Wix connector supplies the token for admin API calls.** **⛔ Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

Follow the steps below exactly:

1. **Install the Wix skills locally** (and pin their location in AGENTS.md)
2. **(optional) Brief doesn't say what to build? Read the site**
3. **Build the client**
4. **Manage and seed the business** (run in parallel with 3)
5. **Wrap up** (required: mount the dev-only manage banner + point the user to the Wix dashboard)

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

Install via the skills CLI — run this through exec_tool, exactly as written:

```js
const { execSync } = require('child_process');
const { readdirSync, existsSync, mkdirSync, copyFileSync } = require('fs');

const skills = ['wix-headless', 'wix-vibe-headless', 'wix-docs'];
const results = {};

for (const skill of skills) {
  try {
    const out = execSync(`CI=1 npx -y skills add wix/skills/skills/${skill} --yes 2>&1`, {
      cwd: '/app', timeout: 60000, shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const text = out.toString().replace(/\x1b\[[0-9;]*m/g, '');
    results[skill] = /installed 1 skill|found 1 skill/i.test(text)
      ? 'success'
      : text.includes('No valid skills') ? 'not_found' : 'unknown';
  } catch (e) {
    results[skill] = 'error: ' + e.message;
  }
}

// Deploy the ready-made REST scaffolds into src/rest/ so STEP 3 builds from them instead of
// regenerating them token-by-token. Copy EVERY .js under references/*/ (the shared transport +
// all vertical helpers) FLAT into src/rest/ — filenames are unique and each helper imports its
// sibling `./wix-client.js`, so a flat folder keeps those imports valid with no rewrite.
// copyFileSync is a no-cost copy (no LLM decode); unused verticals are dead files the bundler drops.
const REF = '/app/.agents/skills/wix-vibe-headless/references';
const copiedToSrcRest = [];
if (existsSync(REF)) {
  mkdirSync('/app/src/rest', { recursive: true });
  for (const dir of readdirSync(REF)) {
    let files;
    try { files = readdirSync(`${REF}/${dir}`); } catch { continue; }   // skip non-dirs
    for (const f of files) {
      if (f.endsWith('.js')) { copyFileSync(`${REF}/${dir}/${f}`, `/app/src/rest/${f}`); copiedToSrcRest.push(f); }
    }
  }
}

return { results, installed: readdirSync('/app/.agents/skills'), copiedToSrcRest };
```

**STEP 1b — pin the skill location in AGENTS.md.** After the install succeeds,
run this via exec_tool exactly as written. It appends (never rewrites) a note so any later
turn knows where the skills live without guessing, and is idempotent (re-running is a no-op):

```js
const fs = require('fs');
const NOTE = `

## This app — a Wix-managed headless frontend (built with the Wix skills)

This project is the **frontend for a Wix-managed business** — a REST client that talks directly to a live Wix site over \`WIX_CLIENT_ID\`. The **Wix site is the source of truth** for all content and commerce; build and seed it only through the Wix connector and the skills below.

**`wix-vibe-headless`, `wix-headless`, and `wix-docs` are the complete build and seed path for this app — the Wix connector supplies the token for admin API calls.** **⛔ Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

The Wix skills live under \`.agents/skills/\` — on ANY turn, read them from that exact path (ignore stray copies like \`agent/skills/\`).

- \`wix-vibe-headless\` — **how the CLIENT is built**: copy-as-is REST scaffolds, one vertical per capability under \`references/<vertical>/\`:
  - \`storefront\` — Stores / eCommerce: products, cart, checkout
  - \`bookings\` — services, slots, appointments
  - \`events\` — event browse, RSVP, ticketing
  - \`blog\` — posts, categories, tags
  - \`portfolio\` — collections, projects, galleries
  - \`restaurants\` — menu, online ordering, reservations
  - \`cms\` — Wix Data: list / detail / filter, forms, CRUD
  - \`pricing-plans\` — memberships, subscriptions, checkout
  - \`members\` — custom login (email/password, Google/Facebook, SSO), account areas, gated content
- \`wix-headless\` — **seeding & admin** of the Wix site over the connector: \`SETUP.md\` installs apps, \`SEED.md\` + \`inline-recipes/\` create content.
- \`wix-docs\` — **fallback** when the two above don't cover it: search + read the Wix API reference docs for **frontend code**, **backend code**, or **runtime / API management operations** alike.
`;
const amd = '/app/AGENTS.md';
const cur = fs.existsSync(amd) ? fs.readFileSync(amd, 'utf8') : '';
if (!cur.includes('Wix-managed headless frontend')) fs.appendFileSync(amd, NOTE);
return 'noted';
```

You end up with `.agents/skills/{wix-headless,wix-vibe-headless,wix-docs}`. **Read them
with the `read_file` tool** — it caps by line (~5000, well above these docs, so each comes through
whole; page with offset/limit only if ever needed), whereas `cat` through exec_tool caps output at
~5000 chars and silently truncates, and web-fetch tools truncate/summarise. The path form depends
on the tool:
- **`read_file` (preferred):** rooted at `/app`, so use the workspace-relative path
  `.agents/skills/wix-vibe-headless/SKILL.md` — an absolute `/app/...` double-prefixes and fails.
- **exec_tool / shell** (only if you must): use the absolute path
  `/app/.agents/skills/wix-vibe-headless/SKILL.md`.

**The canonical skill location is `.agents/skills/` — for the whole session, not just now.** The
installer may also leave stray copies (e.g. `agent/skills/` without the leading dot); **ignore
them.** On any **later turn** (a follow-up request, after the initial build), do **not** guess or
recall the path — read from **`.agents/skills/…` exactly**. Guessing variants like `agent/skills/`
or `.agent/skills/` wastes turns on `File not found` and can read a stale duplicate.

## STEP 2 (optional) — Brief doesn't say what to build? Read the site

Only needed when the business description in your prompt is vague or missing — otherwise skip
to STEP 3. Don't guess which Wix Business Solution to build (stores, bookings, blog, events,
portfolio, restaurants, CMS, pricing plans, members, etc..) — **read the site in one call**
via the connector (exec_tool):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const res = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ siteId: "<metasite id from your prompt>" }),
});
return (await res.json()).markdown;
```

It returns a markdown report of the site — installed apps (by name), status, URL, locale, and
CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md)).
Build for the solutions whose apps are installed (several → prioritize by the user's words and
by which holds real, non-sample content); the same output drives STEP 4's seeding — never seed
guessed ones. If the call fails or reports nothing relevant, ask the user what they offer.

## STEP 3 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **EXACTLY** — it is the single
source of truth for how the client app is built.

**All the REST scaffolds are already in `src/rest/`** — STEP 1 deployed the shared transport
(`wix-client.js`, `wix-manage-banner.js`) and every vertical helper (`wix-store-catalog.js`,
`wix-bookings-services.js`, …) there, so SKILL.md's "get them into `src/rest/`" step is already
done. **Use your vertical's files** from `src/rest/` (e.g. a store uses `wix-store-catalog.js` +
`wix-store-cart.js`), set `WIX_CLIENT_ID` in `src/rest/wix-client.js` and `WIX_METASITE_ID` in
`wix-manage-banner.js`, and adapt with targeted edits — **do not regenerate them**. Files for
other verticals are harmless (unused → dropped by the bundler); leave or delete them. Generate
from scratch only the app-specific UI (components/pages).

**`src/App.jsx`: edit surgically, never rewrite.** On Base44 it carries required platform auth
scaffolding (the `AuthProvider` / `useAuth` imports and wrappers from `@/lib/AuthContext`) — a
full-file rewrite drops them and the platform validator rejects the write, costing you a redo.
Wire your routes/imports in with targeted `find_replace` edits and leave the rest of the file
as-is.

## STEP 4 — Manage and seed the business

**⛔ Never delete or clean up anything on the user's site.** Seeding here is strictly **additive**:
never delete, remove, overwrite, or "reset" existing entities or content — products, collections,
posts, media, CMS items, categories, anything — and never call a delete/bulk-delete endpoint. This
holds **even for what looks like install sample/mock data**, and **even where the `wix-headless`
seed skill's recipes describe a cleanup/reset step — ignore that; it does not apply here.** The
site is a live, user-owned business that may already hold real content (a prior run, or
owner-added). If a genuine cleanup truly seems needed, **ask the user first** and act only on their
explicit approval.

Seed the site with real content by following the **`wix-headless` skill**'s
`references/SEED.md` (`.agents/skills/wix-headless/references/SEED.md`). Where its seed recipes
don't cover what you need, **fall back to the `wix-docs` skill** (`.agents/skills/wix-docs`) to
search and read the relevant Wix API docs.

**Auth for these admin calls is the already-configured Wix connector — and nothing else.** Get the
access token from it and send it as a bearer token — do **not** hand-roll a token getter (e.g. a
custom `getAdminToken()`):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
// then: fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, ... })
```

Do **not** install or run the Wix CLI (`@wix/cli`), do a device-login, or follow `wix-headless`'s
`references/managed/AUTHENTICATION.md` — that managed-project auth flow does not apply to Base44
and will send you down the wrong path.

When you run seed/management code **inline via exec_tool**, `base44` is already declared — use
it directly. Do **not** import `@base44/sdk`, re-declare `base44`, or call `createClient()` —
that pattern is only for standalone `.js` skill files, and inline it throws *"Identifier
'base44' has already been declared."*

**Entity images.** For image-bearing entities (store products, blog covers, bookings services, restaurant items, portfolio projects, event heroes, CMS items) — generate the image with **Base44's built-in image generation**, then import it into Wix Media and attach it to the entity following the capability's `wix-headless` inline recipe "Attach images" step.

**IMPORTANT:** the Wix connector and the `wix-headless` skill's seeding instructions are for
management/admin operations only (STEP 4) — they are **NOT** part of the client. The client is
built solely per the `wix-vibe-headless` skill.

## Parallelism

If possible, run STEP 3 and STEP 4 in parallel — building the client and seeding the business
are independent, so don't wait for one to start the other. Within each step, also work in
parallel where possible (e.g. independent API calls, seeding multiple entities) instead of
one-by-one, to finish faster.

## STEP 5 — Wrap up

Once the site is built and seeded:

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

## Later admin requests

For any later admin/management request the user makes, work the same way as STEP 4: check the
`wix-headless` skill's inline recipes first (`.agents/skills/wix-headless/references/inline-recipes/`)
and, where the operation isn't documented there, fall back to the `wix-docs` skill to search the
Wix API docs — all over the Wix connector.
