# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44. The business to build is
described in your initial prompt. The Wix connector is already configured for this app — use
it for all Wix API calls.

Your Wix client id is given in your prompt. It's a public, buyer/visitor-facing credential (it
only mints anonymous visitor tokens), so it's safe in the frontend — use that value directly for
the Wix client setup.

Follow the steps below exactly.

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

**Option A — skills CLI.** This is the Base44-verified install path — run it first via
exec_tool, exactly as written:

```js
const { execSync } = require('child_process');
const { readdirSync } = require('fs');

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

return { results, installed: readdirSync('/app/.agents/skills') };
```

**Option B — tarball.** Use this **only if Option A actually errored** (check its `results`) —
do not skip Option A on a guess. Run via exec_tool:

```js
const { execSync } = require('child_process');
for (const s of ['headless', 'vibe-headless', 'docs']) {
  execSync(`mkdir -p /app/.agents/skills/wix-${s} && curl -s "https://www.wix.com/skills/${s}.tgz" | tar xz -C /app/.agents/skills/wix-${s} --strip-components=1`);
}
return 'done';
```

Either way you end up with `.agents/skills/{wix-headless,wix-vibe-headless,wix-docs}`. **Read them
with the `read_file` tool** — it caps by line (~5000, well above these docs, so each comes through
whole; page with offset/limit only if ever needed), whereas `cat` through exec_tool caps output at
~5000 chars and silently truncates, and web-fetch tools truncate/summarise. The path form depends
on the tool:
- **`read_file` (preferred):** rooted at `/app`, so use the workspace-relative path
  `.agents/skills/wix-vibe-headless/SKILL.md` — an absolute `/app/...` double-prefixes and fails.
- **exec_tool / shell** (only if you must): use the absolute path
  `/app/.agents/skills/wix-vibe-headless/SKILL.md`.

## STEP 1 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **EXACTLY** — it is the single
source of truth for how the client app is built. To save time, prefer copying ready-made files
the `wix-vibe-headless` skill provides (e.g. the Wix client setup) and adapting them over
re-generating them from scratch.

## STEP 2 — Manage and seed the business

Seed the site with real content by following the **`wix-headless` skill**'s
`references/SEED.md` (`.agents/skills/wix-headless/references/SEED.md`). Where its seed recipes
don't cover what you need, **fall back to the `wix-docs` skill** (`.agents/skills/wix-docs`) to
search and read the relevant Wix API docs.

**Seeding is additive.** You may clean up the app install's **obvious default sample/mock data**
right after a fresh install, but the site may already hold **real content** (a prior run, or
owner-added) — if what's there isn't obviously install sample data, or you're unsure, **do not
delete or overwrite it without the user's explicit ask or approval** (ask first).

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

**IMPORTANT:** the Wix connector and the `wix-headless` skill's seeding instructions are for
management/admin operations only (STEP 2) — they are **NOT** part of the client. The client is
built solely per the `wix-vibe-headless` skill.

## Parallelism

If possible, run STEP 1 and STEP 2 in parallel — building the client and seeding the business
are independent, so don't wait for one to start the other. Within each step, also work in
parallel where possible (e.g. independent API calls, seeding multiple entities) instead of
one-by-one, to finish faster.

## STEP 3 — Wrap up

Once the site is built and seeded:

1. **Leave a brief "Wix skills" note in `AGENTS.md`** (project root) so a future session has
   context. If the file already exists, **`read_file` it first and only append your section** —
   do **not** rewrite, reorder, or remove anything already there; if you can't append cleanly,
   skip this rather than overwrite. Create the file only if none exists. Keep the note
   high-level, e.g.: the Wix skills are installed under `.agents/skills/`; the client is built
   per the `wix-vibe-headless` skill; seeding/management is done per the `wix-headless` +
   `wix-docs` skills.
2. **Ask the user to open** this URL to complete the setup in Wix (substitute the metasite id
   you were given): `https://manage.wix.com/dashboard/{metaSiteId}`

## Later admin requests

For any later admin/management request the user makes, work the same way as STEP 2: check the
`wix-headless` skill's inline recipes first (`.agents/skills/wix-headless/references/inline-recipes/`)
and, where the operation isn't documented there, fall back to the `wix-docs` skill to search the
Wix API docs — all over the Wix connector.
