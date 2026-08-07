# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44 — the business is described in your
initial prompt, and the Wix connector is already configured; use it for all admin API calls.

Your Wix client id is in your prompt — a public, buyer-facing credential (anonymous visitor tokens
only), safe in the frontend; use it directly for the Wix client setup.

> **`wix-vibe-headless`, `wix-headless`, and `wix-docs` are the complete build and seed path for this app — the Wix connector supplies the token for admin API calls.** **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

Follow STEPs 1–5 below exactly (run STEP 4 in parallel with STEP 3).

## STEP 1 — Install the Wix skills locally

Install three skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — the client build guide (STEP 3): your main source of truth.
- **`wix-headless`** — STEP 4 seeding/admin recipes only (`SEED.md` + `inline-recipes/`). **Ignore
  everything else** — its `@wix/cli` / "managed project" auth (`references/managed/`) is **not** how
  auth works here (see STEP 4).
- **`wix-docs`** — a **fallback**: search + read the Wix API docs for anything the recipes don't
  cover.

Install via the skills CLI — run this through exec_tool, exactly as written. One call: installs
the three skills, deploys the REST scaffolds into `src/rest/`, and pins an AGENTS.md note
(appended, idempotent):

```js
const { execSync } = require('child_process');
const { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, appendFileSync } = require('fs');

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

// Deploy REST scaffolds flat into src/rest/ so STEP 3 builds from them (siblings import ./wix-client.js).
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

// Pin the skill location + project facts in AGENTS.md for later turns (idempotent).
const NOTE = `

## This app — a Wix-managed headless frontend (built with the Wix skills)

This project is the **frontend for a Wix-managed business** — a REST client that talks directly to a live Wix site over \`WIX_CLIENT_ID\`. The **Wix site is the source of truth** for all content and commerce; build and seed it only through the Wix connector and the skills below. **Do NOT use the Base44 commerce kit (or any Base44 solution kit).**

The Wix skills live under \`.agents/skills/\` — on ANY turn, read them from that exact path (ignore stray copies like \`agent/skills/\`).

- \`wix-vibe-headless\` — **how the CLIENT is built**: copy-as-is REST scaffolds, one vertical per capability under \`references/<vertical>/\` (storefront, bookings, events, blog, portfolio, restaurants, cms, pricing-plans, members).
- \`wix-headless\` — **seeding & admin** over the connector: \`SETUP.md\` installs apps, \`SEED.md\` + \`inline-recipes/\` create content.
- \`wix-docs\` — **fallback** for **frontend code**, **backend code**, or **runtime / API management operations** alike: search + read the Wix API reference docs.
`;
const amd = '/app/AGENTS.md';
const cur = existsSync(amd) ? readFileSync(amd, 'utf8') : '';
if (!cur.includes('Wix-managed headless frontend')) appendFileSync(amd, NOTE);

return { results, installed: readdirSync('/app/.agents/skills'), copiedToSrcRest, agentsMdPinned: true };
```

Read the skills with **`read_file`** (rooted at `/app` → workspace-relative path, e.g.
`.agents/skills/wix-vibe-headless/SKILL.md`; absolute `/app/...` fails — exec_tool/shell wants
absolute). Prefer it over `cat`/exec_tool and web-fetch, which cap output (~5000 chars) and
truncate. Always read from **`.agents/skills/` exactly**, on later turns too — don't guess; ignore
stray copies like `agent/skills/`.

## STEP 2 (optional) — Brief doesn't say what to build? Read the site

Only when the business description is vague or missing (else skip to STEP 3). Don't guess the Wix
Business Solution — **read the site in one call** via the connector (exec_tool):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const res = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ siteId: "<metasite id from your prompt>" }),
});
return (await res.json()).markdown;
```

It returns a markdown report — installed apps (by name), status, URL, locale, CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md)).
Build for the installed apps' solutions (several → prioritize by the user's words and which holds
real, non-sample content); the same output drives STEP 4's seeding — never seed guessed ones. If it
fails or shows nothing relevant, ask the user what they offer.

## STEP 3 — Build the client

Read `.agents/skills/wix-vibe-headless/SKILL.md` and follow it **EXACTLY** — the single source of
truth for how the client is built.

**All REST scaffolds are already in `src/rest/`** — STEP 1 deployed the shared transport
(`wix-client.js`, `wix-manage-banner.js`) and every vertical helper (`wix-store-catalog.js`, …)
there. Use your vertical's files, set `WIX_CLIENT_ID` in `wix-client.js` and
`WIX_METASITE_ID` in `wix-manage-banner.js`, and adapt with targeted edits — **do not regenerate
them**. Unused verticals are harmless. Generate only the app-specific UI (components/pages).

**No need to read the scaffolds' source** (`wix-client.js`/`wix-store-*.js`) — the vertical's
`INSTRUCTIONS.md` has every field shape + correct usage. Just import them.

**`src/App.jsx`: edit surgically, never rewrite.** It carries required platform auth scaffolding
(`AuthProvider`/`useAuth` from `@/lib/AuthContext`); a full rewrite drops them → the validator
rejects the write. Wire routes/imports in with `find_replace`, leave the rest as-is.

## STEP 4 — Manage and seed the business

**Never delete or clean up anything on the user's site — seeding is additive only.** Ignore any
cleanup/reset step in the `wix-headless` seed recipes: it's a live user-owned business, so never
delete or overwrite existing content, even apparent sample data. If a cleanup truly seems needed,
ask the user first.

Seed by calling your vertical's ready-made seed module — read
`.agents/skills/wix-vibe-headless/references/<vertical>/seed/SEED.md` and `require` its `seed-*.js`
(build-time, via exec_tool); call its functions with your data. Gaps or an unexpected shape →
the **`wix-docs`** skill.

**Auth for these admin calls is the already-configured Wix connector — nothing else.** Get its
access token and send it as a bearer token; do **not** hand-roll a token getter (e.g.
`getAdminToken()`), install/run the Wix CLI (`@wix/cli`), device-login, or follow `wix-headless`'s
`references/managed/AUTHENTICATION.md` (that managed-project flow doesn't apply to Base44):

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
// then: fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, ... })
```

Inline via exec_tool, `base44` is already declared — use it directly; do **not** import
`@base44/sdk`, re-declare it, or call `createClient()` (that's for standalone `.js` files only;
inline it throws *"Identifier 'base44' has already been declared."*).

**Entity images.** For image-bearing entities (store products, blog covers, bookings services,
restaurant items, portfolio projects, event heroes, CMS items), generate with **Base44's built-in
image generation**, then import into Wix Media and attach per the capability's `wix-headless`
inline recipe "Attach images" step.

The connector + `wix-headless` seeding are **admin-only** (STEP 4) — **not** part of the client,
which is built solely per the `wix-vibe-headless` skill.

## Parallelism

Run STEP 3 and STEP 4 in parallel — building and seeding are independent. Within each, also
parallelize independent work (API calls, multiple entities).

## STEP 5 — Wrap up

Once the site is built and seeded:

1. **Mount the dev-only manage banner** (required; links the app to its Wix back office): import
   `mountWixManageBanner` from `src/rest/wix-manage-banner.js` (deployed in STEP 1, `WIX_METASITE_ID`
   set in STEP 3) and call it once from the app entry. It self-gates to dev builds (via
   `import.meta.env.DEV`) — never in production; use as-is. If a `fixed`/`absolute` app header
   slides under it, offset that header by the banner's height.
2. **Ask the user to open** `https://manage.wix.com/dashboard/{metaSiteId}` (substitute your
   metasite id) to complete setup in Wix (required), and mention that dev builds show a dismissible
   top banner linking to this same dashboard.

## Later admin requests

For any later admin/management request, work as in STEP 4: `wix-headless` inline recipes first
(`.agents/skills/wix-headless/references/inline-recipes/`), else `wix-docs` — all over the connector.
