# Setup

Runs once, immediately after the user approves the plan and Discovery has written `.wix/site.json`. This phase's domain is: install the apps the loaded packs declare, pull the Wix env, run `npm install`, and patch `site.json` with `siteId` + `appId`. Run flow (dispatch timing, background handles, waits, batching, transitions) is owned by the framework conductor (`BUILD-astro.md` / `BUILD-own-build.md`; Setup is an early run-step in each).

This article covers the **astro framework-class entry path** (`frontendBuild === "wix"`) — Steps 1–5 below + "npm install recovery". The orchestrator scaffolds a fresh Astro project via `scaffold.sh` in `BUILD-astro.md` run-step 0.

**The no-build framework class (`frontendBuild === "none"`, today the connect/custom path)** reuses this article's app-install step (Step 4a) — but **skips** `env pull` (Step 4b; it inlines the `appId` from `wix.config.json` into CDN `@wix/sdk` imports, needs no `WIX_CLIENT_ID`, and the `init`-bootstrapped project has no `env` command), `scaffold.sh`, the Step 4c per-pack `npm install` (CDN imports `@wix/sdk`), and `seed-utilities.sh`. Its bootstrap is `npm create @wix/new@latest init` (not `scaffold.sh`), and its frontend authoring is the per-capability wiring guides (`references/custom/<cap>/WIRING.md`), not the Composer/pages. The flow is owned by `BUILD-own-build.md`; the playbook is `references/custom/INSTRUCTIONS.md`.

This path assumes DISCOVERY.md's CLI-auth pre-flight has already passed (the foreground check that runs before any `AskUserQuestion`).

Routing (which path runs) is owned by `PLAN.md` § "Operation routing" (operation) and `BUILD.md` (framework). Steps 1–5 below are the astro business steps.

---

## Step 1 — Read the scaffolded project config (siteId + appId)

**Do not** speculatively `Read <folder-name>/wix.config.json` before the scaffold exists — the speculative read returns `File does not exist` on every fast-Q&A run (the file isn't there yet), emits a `[MED]` anomaly in the trace, and costs 3–5 s of round-trip + recovery thinking.

Once the scaffolded project exists, read `<folder-name>/wix.config.json` and extract:
- `siteId` — the site id passed as `--site` to `npx @wix/cli@latest token` and embedded in every install body + as the `wix-site-id` header on every site-scoped REST call. Hold it in orchestrator session scratch.
- `appId` — the project's appId. Hold it in session scratch (it goes into the SDK's `createClient` inputs in later steps).

**Before `cd`, capture the current working directory as `<site-root>` and hold it in session scratch.** This is where Discovery's `init-site-json.mjs` wrote the slim `.wix/site.json` snapshot. The orchestrator is the **sole** reader/writer of that file; no subagent or downstream script reads it during the run. Hold `<site-root>` as an absolute path so the `cd` into the scaffold subdir below does not lose it.

`cd` into `<folder-name>/` so all subsequent file ops + shell calls (`npm`, `npx @wix/cli@latest env pull`) are relative to the project root.

---

## Step 2 — Patch site.json with siteId + appId

Discovery wrote `<site-root>/.wix/site.json` with `brand`, `frontend`, and `verticals`. Setup's only addition is patching `siteId` and `appId` in. This is a one-shot in-process JSON edit:

1. `Read <site-root>/.wix/site.json` (absolute path — `<site-root>` was captured in Step 1, before the `cd` into the scaffold).
2. Add the two top-level fields (`siteId`, `appId`) using the values held in session scratch.
3. `Write` the updated file back to the same absolute path.

The file's purpose at this point is **observability + resume detection** — no subagent reads it; the orchestrator is the sole reader/writer. Six lines of edit doesn't justify a script.

---

## Step 3 — Invoke the `wix-manage` skill

> **Default — just invoke it; do not deliberate.** **Always** invoke `Skill(name="wix-manage")` here. It is near-instant, and it is the *only* thing that both publishes `<wix-manage-root>` into scratch **and loads the recipe files into context** (which Step 4's installs and the whole Seed phase then reuse — SEED.md reads recipes relative to `<wix-manage-root>` and explicitly does **not** re-invoke). **Knowing the `wix-manage` directory path from an earlier `ls`/discovery is NOT a reason to skip the invocation** — a raw filesystem path is not the same as the skill being loaded (the recipes aren't in context). Do not weigh invoke-vs-skip; invoke. The only exception is the Missing-skill fallback below.

App installation is delegated to `wix-manage`. Use the harness's skill-invocation primitive — in Claude Code that's `Skill(name="wix-manage")`; other harnesses provide an analogous mechanism. **Do not** hardcode a tool-call snippet here; the prose instruction "Invoke the `wix-manage` skill" is the contract, and the harness owns the mechanics. This mirrors `wix-app/SKILL.md:241` ("Invoke the `wix-design-system` skill") and keeps the skill agent-agnostic.

After invocation, `wix-manage`'s SKILL.md is in context with absolute paths to its `references/<topic>/` files. Read its app-install recipe by absolute path:

```
Read <wix-manage-root>/references/app-installation/install-wix-apps.md
```

> **Sequencing note.** Within Step 3, the `Skill` invocation must precede the `Read install-wix-apps.md` (the Read needs the absolute path that `wix-manage`'s SKILL.md publishes).

The recipe's Step 2 documents the body shape every Step 4 install call will use:

```
tenant: { tenantType: "SITE", id: "<siteId>" }
appInstance: { appDefId: "<pack.apps[N].appDefId>" }
```

Endpoint: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install`.

> **Recipe call shape.** Every loaded `wix-manage` recipe is authored in `curl` form. Build each call with the headers documented in `references/shared/AUTHENTICATION.md` (`Authorization: Bearer $TOKEN` + `wix-site-id: $SITE_ID` + `Content-Type: application/json`). The recipe's URL, method, and body are the source of truth — do not re-derive them.

> **Missing-skill fallback (only when the `Skill` primitive fails).** This applies **only** when the skill-invocation primitive itself is unavailable — i.e. `wix-manage` is not installed in the current harness and the `Skill(name="wix-manage")` call errors. It is **not** a "use the path you already found" shortcut: a known directory path never justifies skipping the invocation (see the default above). When the invocation genuinely fails, fall back to the install **body shape** documented above (it is REST-shaped and stable; the recipe wraps it but does not transform it), and note the missing skill in the run digest. Do not silently substitute — the canonical entry point is `wix-manage`.

---

## Step 4 — One concurrent batch

> Fire 4a + 4b + 4c as a single concurrent batch — see `PLAN.md` § "Batching discipline".

The dispatch contains three operations:

### 4a. App installs — one `curl` per `pack.apps[*]` (business track, frontend-blind)

This is **business-track** work: the install body is identical per `pack.apps[*]` regardless of the `frontend`/template — it registers Wix apps against the Site and never reads which frontend will consume them.

Mint the site-scoped REST token once and cache it for the rest of the run, then iterate every loaded pack (top-level + transitive via `requires:`) and fire one `curl` per entry in the pack's `apps:` array:

```bash
SITE_ID="<siteId>"
TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")  # once; cache in scratch for the run

# per-pack iteration; one curl per pack.apps[*]:
curl -sS -X POST "https://www.wixapis.com/apps-installer-service/v1/app-instance/install" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant":      { "tenantType": "SITE", "id": "'"$SITE_ID"'" },
    "appInstance": { "appDefId": "<pack.apps[N].appDefId>", "enabled": true }
  }'
```

Use `npx @wix/cli@latest token …` (not bare `wix token …`): `@wix/cli` may not be globally installed in every harness, and `npx` resolves to the project-local copy that scaffold just produced. The first invocation auto-fetches the CLI (~3–5 s) if missing; subsequent calls are instant.

A 200 response confirms the install. On 401/403, retry the same call once with the cached token per the recovery ladder in `references/shared/AUTHENTICATION.md` — do **not** re-mint (the token is byte-identical for the run); if it still fails, surface the response body — a persistent 401 usually means the CLI session expired and `wix login` is required.

**Packs with `apps: []` (e.g. `cms`, `ecom`):** skip the curl but record a phase entry as `{phase: "app-install-<pack>", status: "skipped", notes: "no app required for this pack"}` — the explicit skipped entry keeps run observability unambiguous.

**Packs with `disabled: true` (today: `gift-cards`):** the pack still loads and contributes to the resolved set, but its `apps:` array is empty by design (the user opts in via the dashboard later). No curl. Same `skipped` phase entry as above.

### 4b. `npx @wix/cli@latest env pull --json`

Foreground shell, ~5 s. Writes `WIX_CLIENT_ID` to `.env.local`. Idempotent. Skipping this causes `Missing environment variable WIX_CLIENT_ID` build failures in downstream phases.

> **Always pass `--json`.** Without it the CLI renders an interactive spinner; captured through the tool's non-TTY pipe, every animation frame lands as a separate line of ANSI escapes (`\x1b[2K\x1b[1A…⠙ Pulling…`) and bloats the context for zero signal. `--json` selects the CLI's non-interactive render-to-string path (one clean `{"success": true}` line), and the skill doesn't parse this command's output anyway — it only needs `.env.local` on disk.

### 4c. Dispatch background `npm install`

Run `npm install` as a backgrounded shell. Capture the handle as `npm_handle` and the path to `<npm-tempfile>`. Hold both in session scratch.

```bash
npm install --no-fund --no-audit --legacy-peer-deps <package-set> \
  2> <npm-tempfile>
# dispatched with run_in_background: true; capture as npm_handle
```

`<package-set>` is composed from the resolved pack set (loaded packs from Setup Step 1, including transitives via `requires:`):

| Always | Add when pack is loaded |
|---|---|
| `@wix/sdk tailwindcss @tailwindcss/vite` | — |
| | **stores** → `@wix/stores` |
| | **ecom** (loaded directly or as `requires:` of stores) → `@wix/ecom @wix/redirects` |
| | **blog** → `@wix/blog @wix/ricos @astrojs/rss @astrojs/sitemap` |
| | **forms** → `@wix/forms` |
| | **cms** → `@wix/data @wix/wix-data-items-sdk @wix/essentials` |
| | **gift-cards** → (none — disabled-by-default pack ships no Astro-time imports) |

Concrete example for the most common case (stores prompt; resolved set = stores + ecom + gift-cards + cms):
```bash
npm install --no-fund --no-audit --legacy-peer-deps \
  @wix/sdk @wix/stores @wix/ecom @wix/redirects \
  @wix/data @wix/wix-data-items-sdk @wix/essentials \
  tailwindcss @tailwindcss/vite \
  2> <npm-tempfile>
```

> **Why three packages for cms?** `@wix/data` exposes collections / permissions / backups namespaces; the actual `items` API (used by every CMS page for queries) lives in `@wix/wix-data-items-sdk` since `@wix/data` 1.0.448 dropped the `items` re-export (see [astro/cms/CMS_FOUNDATIONS.md](./astro/cms/CMS_FOUNDATIONS.md) § "Import note"). `@wix/essentials` is required for `auth.elevate` — every CMS page elevates queries to bypass per-collection permission checks. Shipping only `@wix/data` produces `'items' is not exported by '@wix/data'` at `astro build`; shipping without `@wix/essentials` produces `Cannot find module '@wix/essentials'` at SSR time.

Per pre-flight S0.2, `pnpm install` fails against the `@wix/cli` template — use `npm install --legacy-peer-deps`.

**Why per-pack packages live here, not in pack frontmatter:** `references/verticals/_schema.md` is scoped to Discovery; it deliberately excludes `packages:` to keep that schema small. The install set is owned by SETUP.md instead — the lookup table above is the contract. **If you skip the per-pack additions and ship only the always-on three, `astro build` fails at Wave 5 with `Rollup failed to resolve import "@wix/stores"` (or whichever pack-side package the run depends on) and Setup's win on the foreground wall is paid back many times over in a recovery cycle.** When this happens, the build retries after an in-flight `npm install @wix/stores @wix/ecom`, costing ~30 s.

Do not invent packages beyond the table above. If a future vertical needs a new package, extend the table here.

---

## Step 5 — Transition to Seed

Setup does not print a summary sentence. Setup ends once the Final-scan checks pass.

---

## npm install recovery

Invoked when `npm_handle` returns non-zero. The handle is dispatched in Step 4c above; the orchestrator waits on it at the seed gate (`BUILD-astro.md`) and runs this recovery ladder there if it failed.

If the background `npm install` fails or hangs:

1. **Foreground retry** with `npm install --no-fund --no-audit --legacy-peer-deps <packages>` (90 s timeout). If that hangs, add `--prefer-offline`; if still hanging, run `npm cache clean --force` and retry once more.
2. **Last resort:** ask the user to run `npm install --legacy-peer-deps` manually and report back. Do not silently substitute pnpm/yarn — pre-flight S0.2 confirmed pnpm fails against the `@wix/cli` template.

The package set is the union of `@wix/sdk tailwindcss @tailwindcss/vite` (always) plus each loaded pack's frontmatter `packages:` array. The current pack frontmatter does not declare `packages:` blocks — vertical packs are discovery-only at this phase, so the install set is just the always-on three. Do not invent package names.

---

## Final scan (MANDATORY)

Before transitioning to SEED.md in Step 5, verify: `siteId` + `appId` are in `.wix/site.json` (extracted from `wix.config.json`, both non-empty), the cached token mints, every loaded pack with `apps:` got a 200 OK (or a `skipped` phase entry for empty `apps:`), `.env.local` contains `WIX_CLIENT_ID`, and `npm_handle` was dispatched. If any check fails, surface the failure verbatim instead of transitioning to SEED.md.
