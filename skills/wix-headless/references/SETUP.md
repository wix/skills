# Setup

Runs once after approval, with the contract in scratch. Domain: install the apps the loaded packs declare, pull the Wix env, run `npm install`, and read `siteId` + `appId` from `wix.config.json` into scratch. Run flow (timing, handles, waits, batching) is owned by the framework conductor (`BUILD-astro.md` / `BUILD-own-build.md`; Setup is an early run-step in each).

This article is the **astro entry path** (`frontendBuild === "wix"`): Steps 1–5 + npm recovery. The `none`/`own` classes reuse **only** Step 4a (app installs); their skips (no `env pull`, no `scaffold.sh`, no per-pack `npm install`, no `seed-utilities.sh`) and their `init` bootstrap are owned by `BUILD-own-build.md`. Assumes `DISCOVERY.md`'s CLI-auth pre-flight passed. Routing: `PLAN.md` § "Operation routing" + `BUILD.md`.

---

## Step 1 — Read the scaffolded project config (siteId + appId)

> **Single folder — CWD == project == site-root.** `scaffold.sh` flattens the project into CWD: one folder, one `.wix/` (`package.json`, `src/`, `wix.config.json`, `.wix/design-tokens.css`, …), with the end-of-run `AGENTS.md` at its root. Never `cd` into a subdir or look in a parent for `.wix`. `<site-root>` == `<project-dir>` == CWD; pass absolute paths only when a call runs in its own subshell.

Do **not** speculatively `Read ./wix.config.json` before the scaffold completes — it doesn't exist yet on a fast-Q&A run, so the read fails and wastes a round-trip.

Once `scaffold_handle` returns, read `./wix.config.json` and hold in scratch:
- `siteId` — passed as `--site` to `npx @wix/cli@latest token`, embedded in every install body + the `wix-site-id` header on every site-scoped REST call.
- `appId` — goes into the SDK's `createClient` inputs later.

Capture CWD as `<site-root>` in scratch. No `cd` step — every file op runs in the project root.

---

## Step 3 — Invoke the `wix-manage` skill

**Always invoke `Skill(name="wix-manage")` here** — it is the only thing that publishes `<wix-manage-root>` into scratch **and loads the recipe files into context** (Step 4's installs and the whole Seed phase reuse them; `SEED.md` does not re-invoke). A known directory path is not a substitute — the recipes must be in context. Use the harness's skill-invocation primitive (Claude Code: `Skill(name="wix-manage")`); the prose instruction is the contract — don't hardcode a tool-call snippet.

Then read the app-install recipe by absolute path (the `Skill` invocation must precede this Read — it needs the path `wix-manage`'s SKILL.md publishes):

```
Read <wix-manage-root>/references/app-installation/install-wix-apps.md
```

The recipe's Step 2 documents the install body shape:

```
tenant: { tenantType: "SITE", id: "<siteId>" }
appInstance: { appDefId: "<pack.apps[N].appDefId>" }
```

Endpoint: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install`.

> **Recipe call shape.** Recipes are authored in `curl` form. Build each call with the headers in `references/shared/AUTHENTICATION.md` (`Authorization: Bearer $TOKEN` + `wix-site-id: $SITE_ID` + `Content-Type: application/json`). The recipe's URL/method/body are the source of truth.

> **Missing-skill fallback (only if the `Skill` primitive errors):** fall back to the install body shape above (REST-shaped and stable) and note the missing skill in the run digest. Don't silently substitute — `wix-manage` is the canonical entry point.

---

## Step 4 — One concurrent batch

Fire 4a + 4b + 4c as a single concurrent batch (`PLAN.md` § "Batching discipline").

### 4a. App installs — one `curl` per `pack.apps[*]` (business track, frontend-blind)

The install body is identical per `pack.apps[*]` regardless of frontend. Mint the site-scoped REST token once, cache it for the run, then fire one `curl` per `apps:` entry across every loaded pack (top-level + transitive via `requires:`):

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

Use `npx @wix/cli@latest token …` (not bare `wix token`) — `npx` resolves the project-local CLI the scaffold produced (first call auto-fetches it ~3–5 s if missing). A 200 confirms the install. On 401/403, retry the same call once with the cached token (do **not** re-mint — it's byte-identical for the run; recovery ladder in `references/shared/AUTHENTICATION.md`); a persistent 401 usually means the CLI session expired and `wix login` is required — surface the response body.

Packs with `apps: []` (`cms`, `ecom`) or `disabled: true` (`gift-cards`, whose `apps:` is empty by design — the user opts in via the dashboard) install nothing — skip the curl.

### 4b. `npx @wix/cli@latest env pull --json`

Foreground, ~5 s. Writes `WIX_CLIENT_ID` to `.env.local` (idempotent). Skipping it causes `Missing environment variable WIX_CLIENT_ID` build failures downstream. **Always pass `--json`** — without it the CLI emits an interactive spinner that floods the non-TTY pipe with ANSI frames; `--json` gives one clean line (the skill only needs `.env.local` on disk).

### 4c. Dispatch background `npm install`

Background shell; capture `npm_handle` + `<npm-tempfile>` in scratch. Trust the exit code at the seed gate — do not probe `node_modules`.

```bash
npm install --no-fund --no-audit --legacy-peer-deps <package-set> \
  2> <npm-tempfile>
# dispatched with run_in_background: true; capture as npm_handle
```

`<package-set>` from the resolved pack set (loaded + transitive via `requires:`):

| Always | Add when pack is loaded |
|---|---|
| `@wix/sdk tailwindcss @tailwindcss/vite` | — |
| | **stores** → `@wix/stores` |
| | **ecom** (direct or via stores `requires:`) → `@wix/ecom @wix/redirects` |
| | **blog** → `@wix/blog @wix/ricos @astrojs/rss @astrojs/sitemap` |
| | **forms** → `@wix/forms` |
| | **cms** → `@wix/data @wix/essentials` |
| | **bookings** → `@wix/bookings @wix/essentials` |
| | **gift-cards** → (none — disabled-by-default pack ships no Astro-time imports) |

Example (resolved set = stores + ecom + gift-cards + cms):

```bash
npm install --no-fund --no-audit --legacy-peer-deps \
  @wix/sdk @wix/stores @wix/ecom @wix/redirects \
  @wix/data @wix/essentials \
  tailwindcss @tailwindcss/vite \
  2> <npm-tempfile>
```

Use `npm --legacy-peer-deps` — `pnpm` fails against the `@wix/cli` template. **Skipping the per-pack additions makes `astro build` fail with `Rollup failed to resolve import "@wix/<pack>"`** (~30 s recovery). Don't invent packages beyond the table; extend the table for a new vertical.

---

## Step 5 — Transition to Seed

Setup prints no summary. Before transitioning to `SEED.md`, confirm: `siteId` + `appId` in scratch (from `wix.config.json`, both non-empty), the cached token mints, every `apps:` pack got a 200 (empty-`apps:` packs skipped), `.env.local` contains `WIX_CLIENT_ID`, and `npm_handle` was dispatched. On any failure, surface it verbatim instead of proceeding.

---

## npm install recovery

Invoked when `npm_handle` returns non-zero (dispatched in Step 4c, waited at the seed gate in `BUILD-astro.md`):

1. **Foreground retry** `npm install --no-fund --no-audit --legacy-peer-deps <packages>` (90 s timeout). If it hangs, add `--prefer-offline`; if still hanging, `npm cache clean --force` and retry once more.
2. **Last resort:** ask the user to run `npm install --legacy-peer-deps` manually and report back. Don't substitute pnpm/yarn — pnpm fails against the `@wix/cli` template.

Package set = the Step 4c table (always-on three ∪ per-pack packages). Don't invent package names.
