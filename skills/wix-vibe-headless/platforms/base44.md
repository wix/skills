# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44. The business to build is
described in your initial prompt. The Wix connector is already configured for this app — use
it for all Wix API calls.

Your Wix client id is given in your prompt. It's a public, buyer/visitor-facing credential (it
only mints anonymous visitor tokens), so it's safe in the frontend — use that value directly for
the Wix client setup.

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

**STEP 1b — pin the skill location in AGENTS.md.** After the install succeeds (either option),
run this via exec_tool exactly as written. It appends (never rewrites) a note so any later
turn knows where the skills live without guessing, and is idempotent (re-running is a no-op):

```js
const fs = require('fs');
const NOTE = `

## Wix skills (installed)

Wix skills live under \`.agents/skills/\` — on ANY turn, read them from that exact path; ignore stray copies (e.g. \`agent/skills/\`).

- \`wix-vibe-headless\` — how the CLIENT is built: the REST-only frontend against Wix APIs (start at \`SKILL.md\`; per-vertical \`references/\`).
- \`wix-headless\` — seeding/admin of the Wix site over the connector (\`SETUP.md\` installs apps, \`SEED.md\` + \`inline-recipes/\` create content).
- \`wix-docs\` — search/read the Wix API docs when the recipes don't cover something.
`;
const amd = '/app/AGENTS.md';
const cur = fs.existsSync(amd) ? fs.readFileSync(amd, 'utf8') : '';
if (!cur.includes('## Wix skills')) fs.appendFileSync(amd, NOTE);
return 'noted';
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
source of truth for how the client app is built. To save time, prefer copying ready-made files
the `wix-vibe-headless` skill provides (e.g. the Wix client setup) and adapting them over
re-generating them from scratch.

**`src/App.jsx`: edit surgically, never rewrite.** On Base44 it carries required platform auth
scaffolding (the `AuthProvider` / `useAuth` imports and wrappers from `@/lib/AuthContext`) — a
full-file rewrite drops them and the platform validator rejects the write, costing you a redo.
Wire your routes/imports in with targeted `find_replace` edits and leave the rest of the file
as-is.

## STEP 4 — Manage and seed the business

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
