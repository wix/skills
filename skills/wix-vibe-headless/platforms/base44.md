# Wix Managed Headless — Base44 build instructions

You are building a **Wix Managed** headless site inside Base44. The business to build is
described in your initial prompt. The Wix connector is already configured for this app — use
it for all Wix API calls.

Your Wix client id is the env var `WIX_CLIENT_ID`. It's a public, buyer/visitor-facing
credential (it only mints anonymous visitor tokens), so it's safe in the frontend — but the
exec_tool secret-guard still **blocks returning it** from a script, and you don't know its
value at code-write time. So don't hardcode it and don't read it via exec_tool; expose it to
the client with a tiny backend function and fetch it at runtime:

```ts
Deno.serve(() => Response.json({ clientId: Deno.env.get("WIX_CLIENT_ID") }));
```

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

Each archive nests its own folder under `/app` → `skills/{headless,vibe-headless,docs}`. Read
them with the `read_file` tool, using workspace-relative paths (`skills/vibe-headless/SKILL.md`),
not an absolute `/app/...` path (`read_file` is rooted at `/app`). `read_file`'s cap is by line
(~5000) — well above these docs, so each comes through whole; page past it with its offset/limit
params only if ever needed. Do **not** `cat` skill files through exec_tool: its output caps at
~5000 chars and silently truncates them. And don't fetch the skill URLs over the web (truncates/caches).

## STEP 0.5 — Note it in AGENTS.md

Add a short "Wix skills" section to `AGENTS.md` (or the project's existing agent file —
`CLAUDE.md`, `.cursor/rules`) so the next session doesn't rediscover it: skills at `/app/skills`
(read via `read_file` with workspace-relative paths, not exec_tool `cat`); client built per
`vibe-headless/SKILL.md`; admin/seeding
via `headless/references/SEED.md` + `docs` over the Wix connector (management only, not the
client); `WIX_CLIENT_ID` is public but must be exposed via a backend function (above).

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

When you run seed/management code **inline via exec_tool**, `base44` is already declared — use
it directly. Do **not** import `@base44/sdk`, re-declare `base44`, or call `createClient()` —
that pattern is only for standalone `.js` skill files, and inline it throws *"Identifier
'base44' has already been declared."*

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
