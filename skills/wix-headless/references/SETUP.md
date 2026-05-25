# Setup

Runs once, immediately after the user approves the plan and Discovery has written `.wix/site.json`. The phase synchronizes on the background scaffold started during Discovery, installs the apps the loaded packs declare, pulls the Wix env, and dispatches `npm install` as its own background handle that SEED.md Step 4 waits on.

Target wall (foreground critical path): **≤ 20 s**. The npm install tail runs concurrent with the seed phase rather than gating Setup.

This article covers **two entry paths**:

1. **New project flow** (the default — Sections "Step 0", "Setup Dispatch", "npm install recovery"). The orchestrator scaffolds a fresh Astro project via `scaffold.sh` in Discovery Step 1, then runs the dispatch below.
2. **Existing project flow** (see "Existing project flow" at the bottom). The user already has a working frontend (e.g. a Claude Design output, a hand-coded HTML/JSX site) and wants to **connect it** to Wix Headless to get hosting + Business Solutions. No scaffold, no Astro, no design/seed/pages waves — just connect, install needed apps, optionally wire SDK calls, release.

Both paths share **Step 0 (MCP bootstrap)**. Branch immediately after.

> **Routing decision (do this BEFORE Step 0's dispatch).** Inspect the working directory:
> - **Empty / non-existent / freshly-scaffolded** AND Discovery Step 1's `scaffold.sh` is what populated it → **New project flow** (continue with this article top-to-bottom).
> - **Already contains source files** (`index.html`, `*.jsx`, `*.tsx`, `*.vue`, `package.json` from a non-Wix template, etc.) AND no scaffold was dispatched in Discovery → **Existing project flow** (jump to "Existing project flow" at the bottom; skip the Setup Dispatch).
> - **Contains `wix.config.json`** AND an Astro project structure (`src/`, `astro.config.mjs`) → resume a prior wix-headless run (see `SKILL.md` § "When NOT to Use This Skill" — ask the user "continue or start fresh?").
> - **Contains `wix.config.json`** AND a non-Astro frontend (`index.html` at root, `*.jsx` files) → already-`init`'d existing project; jump to "Existing project flow" § "After init" (skip the init step itself).

---

## Step 1 — Wait for `scaffold_handle`, **and load `wix-manage` in the same concurrent batch**

DISCOVERY.md kicked off `scripts/scaffold.sh` in the background as soon as Q1 (brand) returned. The handle (`scaffold_handle`) was captured at dispatch time. Hold `scaffold_handle` only — `npm_handle` does not exist yet; it is created in Step 4c.

**The wait is ~30 s and the `wix-manage` skill load doesn't depend on the scaffold.** Fire both as a single concurrent batch in the same message:

- `TaskOutput` (or harness equivalent) — `block: true` on `scaffold_handle`. This is the wait.
- The Step 3 `Skill` invocation of `wix-manage`. See § Step 3 below.

By the time the wait returns, `wix-manage` is in context — so the only foreground work after the wait is reading `wix.config.json`, patching `site.json`, reading the install recipe, and firing the Step 4 batch. **Serializing the wait before the skill load costs ~5–10 s** of skill-load thinking after the wait instead of during it. The wait is the floor; everything that doesn't depend on its output should overlap with it.

**Do not** speculatively `Read <project-slug>/wix.config.json` and fall back to a wait — the speculative read returns `File does not exist` on every fast-Q&A run (the file isn't there yet), emits a `[MED]` anomaly in the trace, and costs 3–5 s of round-trip + recovery thinking. Wait first; read second.

Once the wait returns exit-0, read `<project-slug>/wix.config.json` and extract:
- `siteId` — the site id passed as `--site` to `npx @wix/cli token` and embedded in every install body + as the `wix-site-id` header on every site-scoped REST call.
- `appId` — the project's appId, written into `.wix/site.json` for downstream phases.

`cd` into `<project-slug>/` so all subsequent file ops + shell calls are relative to the project root.

**On non-zero exit from the wait** (scaffold failed), read the captured stderr tempfile to diagnose. Retry once inline with the same invocation from `scripts/scaffold.sh`. If the retry also fails, surface the stderr to the user — recovery from `npm create` errors (auth, invalid template, network) needs human input. (npm install hasn't been dispatched yet at this point, so failures here are scaffold-only.)

**Before `cd`, capture the current working directory as `<site-root>` and hold it in session scratch.** This is where Discovery's `init-site-json.mjs` wrote `.wix/site.json` (`<site-root>/.wix/site.json`). Phase 3 Seed reads from and writes back to this same root — both for the patched `site.json` and for the per-pack `seed-returns/`. Mixing the eval-run dir with the scaffold subdir is a known cause of `merge-seed-results.mjs: site.json does not exist` failures.

`cd` into `<project-slug>/` so subsequent shell calls (`npm`, `npx @wix/cli env pull`) are relative to the project root. **Use the captured `<site-root>` (an absolute path) for every subsequent `Read`/`Write`/`Bash` that touches `.wix/site.json` or `.wix/seed-returns/`** — do not rely on relative paths after the `cd`.

---

## Step 2 — Patch site.json with siteId + appId

Discovery wrote `<site-root>/.wix/site.json` with `brand`, `intent`, and `verticals`. Setup's only addition is patching `siteId` and `appId` in. This is a one-shot in-process JSON edit, not a script:

1. `Read <site-root>/.wix/site.json` (absolute path — `<site-root>` was captured in Step 1, before the `cd` into the scaffold).
2. Add the two top-level fields (`siteId`, `appId`) using the values from Step 1.
3. `Write` the updated file back to the same absolute path.

Do not author a `patch-site-json.mjs` for this — six lines of edit doesn't justify a script.

---

## Step 3 — Invoke the `wix-manage` skill (run during Step 1's wait)

Per Step 1, fire this in the same concurrent batch as the `TaskOutput` block on the background scaffold handle. It doesn't depend on the scaffold's output; the only thing that does is reading `wix.config.json` after the wait returns.

App installation is delegated to `wix-manage`. Use the harness's skill-invocation primitive — in Claude Code that's `Skill(name="wix-manage")`; other harnesses provide an analogous mechanism. **Do not** hardcode a tool-call snippet here; the prose instruction "Invoke the `wix-manage` skill" is the contract, and the harness owns the mechanics. This mirrors `wix-app/SKILL.md:241` ("Invoke the `wix-design-system` skill") and keeps the skill agent-agnostic.

After invocation, `wix-manage`'s SKILL.md is in context with absolute paths to its `references/<topic>/` files. Read its app-install recipe by absolute path:

```
Read <wix-manage-root>/references/app-installation/install-wix-apps.md
```

> **Sequencing note.** Within Step 3, the `Skill` invocation must precede the `Read install-wix-apps.md` (the Read needs the absolute path that `wix-manage`'s SKILL.md publishes). Both can ride alongside the Step 1 wait in the opening concurrent batch — the wait is long enough to absorb a 1–2-message follow-up Read inside that window. The goal: by the time the wait returns, the recipe is loaded.

The recipe's Step 2 documents the body shape every Step 4 install call will use:

```
tenant: { tenantType: "SITE", id: "<siteId>" }
appInstance: { appDefId: "<pack.apps[N].appDefId>" }
```

Endpoint: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install`.

> **Recipe call shape.** Every loaded `wix-manage` recipe is authored in `curl` form. Build each call with the headers documented in `references/shared/AUTHENTICATION.md` (`Authorization: Bearer $TOKEN` + `wix-site-id: $SITE_ID` + `Content-Type: application/json`). The recipe's URL, method, and body are the source of truth — do not re-derive them.

> **Sibling-path fallback.** If `wix-manage` is not installed in the current harness, the orchestrator can fall back to the body shape documented above (it is REST-shaped and stable; the recipe wraps it but does not transform it). Note the missing-skill in the run digest. Do not silently substitute — the canonical entry point is `wix-manage`.

---

## Step 4 — One concurrent batch

> **BATCHING — read this twice before proceeding.**
>
> Launch every operation below as a single concurrent batch. No narration, no *"Now installing apps:"*, no transition text between dispatches.
>
> Any text adjacent to a dispatch closes the batch and forces remaining operations into separate turns. A prior run lost 13 s to roadmap-tracker calls splitting across 13 turns. The same regression applies here even though this dispatch is smaller (~3–5 ops) — strict single-batch dispatch is the cure.

The dispatch contains three operations:

### 4a. App installs — one `curl` per `pack.apps[*]`

Mint the site-scoped REST token once and cache it for the rest of the run, then iterate every loaded pack (top-level + transitive via `requires:`) and fire one `curl` per entry in the pack's `apps:` array:

```bash
SITE_ID="<siteId>"
TOKEN=$(npx @wix/cli token --site "$SITE_ID")  # once; cache in scratch for the run

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

Use `npx @wix/cli token …` (not bare `wix token …`): `@wix/cli` may not be globally installed in every harness, and `npx` resolves to the project-local copy that scaffold just produced. The first invocation auto-fetches the CLI (~3–5 s) if missing; subsequent calls are instant.

A 200 response confirms the install. On 401/403, re-mint and retry once per the recovery ladder in `references/shared/AUTHENTICATION.md`; if it still fails, surface the response body — recovery beyond a single re-mint usually means the CLI session expired and `wix login` is required.

**Packs with `apps: []` (e.g. `cms`, `ecom`):** skip the curl but record a phase entry as `{phase: "app-install-<pack>", status: "skipped", notes: "no app required for this pack"}` — the explicit skipped entry keeps run observability unambiguous.

**Packs with `disabled: true` (today: `gift-cards`):** the pack still loads and contributes to the resolved set, but its `apps:` array is empty by design (the user opts in via the dashboard later). No curl. Same `skipped` phase entry as above.

### 4b. `npx @wix/cli env pull`

Foreground shell, ~5 s. Writes `WIX_CLIENT_ID` to `.env.local`. Idempotent. Skipping this historically caused `Missing environment variable WIX_CLIENT_ID` build failures in downstream phases.

### 4c. Dispatch background `npm install`

Now that scaffold is verified complete and we're `cd`'d into the project, fire `npm install` as a backgrounded shell in the same batch as 4a + 4b. Capture the handle as `npm_handle` and the path to `<npm-tempfile>` (used by SEED.md Step 4 if the install fails). Hold both in session scratch through the seed phase.

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
| | **cms** → (none — uses `@wix/data` from `@wix/sdk`) |
| | **gift-cards** → (none — disabled-by-default pack ships no Astro-time imports) |

Concrete example for the most common case (stores prompt; resolved set = stores + ecom + gift-cards + cms):
```bash
npm install --no-fund --no-audit --legacy-peer-deps \
  @wix/sdk @wix/stores @wix/ecom @wix/redirects tailwindcss @tailwindcss/vite \
  2> <npm-tempfile>
```

Per pre-flight S0.2, `pnpm install` fails against the `@wix/cli` template — use `npm install --legacy-peer-deps`.

**Why per-pack packages live here, not in pack frontmatter:** `references/verticals/_schema.md` is scoped to Discovery; it deliberately excludes `packages:` to keep that schema small. The install set is owned by SETUP.md instead — the lookup table above is the contract. **If you skip the per-pack additions and ship only the always-on three, `astro build` fails at Wave 5 with `Rollup failed to resolve import "@wix/stores"` (or whichever pack-side package the run depends on) and Setup's win on the foreground wall is paid back many times over in a recovery cycle.** Both prior runs hit this — the build retried after an in-flight `npm install @wix/stores @wix/ecom`, costing ~30 s.

Do not invent packages beyond the table above. If a future vertical needs a new package, extend the table here.

**Do not `wait` on `npm_handle` inside this batch.** SEED.md Step 4 waits on it once the seed subagents have all returned, so the install runs concurrent with seed. Waiting here would defeat the split (it would re-serialize the install before seed, the regression this Step 4c shape was created to avoid).

---

## Step 5 — Transition to Seed

Setup does not print a summary sentence. After the Step 4 batch's final-scan checks pass, open `<SKILL_ROOT>/references/SEED.md` and follow Steps 1–5. Step 2 runs the Wave 3 batch (seeders + design system + image phase 1 in parallel). Step 5 prints a short seed-progress line, then chains into `ORCHESTRATION.md` at Step 4.5 — do not treat Seed as the end of the run.

---

## npm install recovery

Invoked from SEED.md Step 4 when `npm_handle` returns non-zero. The handle was dispatched in Step 4c above; recovery is owned by Seed because that's where the wait happens.

If the background `npm install` fails or hangs:

1. **Foreground retry with 90-second timeout:**
   ```bash
   npm install --no-fund --no-audit --legacy-peer-deps <packages>
   ```

2. **If still hanging, retry with `--prefer-offline`:**
   ```bash
   npm install --prefer-offline --no-fund --no-audit --legacy-peer-deps <packages>
   ```

3. **If still hanging, clear the cache:**
   ```bash
   npm cache clean --force
   npm install --no-fund --no-audit --legacy-peer-deps <packages>
   ```

4. **Last resort:** tell the user: *"npm install is hanging. Please run `npm install --legacy-peer-deps` manually in your terminal, then let me know when it's done."* Do not silently substitute pnpm/yarn — pre-flight S0.2 confirmed pnpm fails against the `@wix/cli` template.

The package set is the union of `@wix/sdk tailwindcss @tailwindcss/vite` (always) plus each loaded pack's frontmatter `packages:` array. The current pack frontmatter does not declare `packages:` blocks — vertical packs are discovery-only at this phase, so the install set is just the always-on three. Do not invent package names.

---

## Final scan (MANDATORY)

Before transitioning to SEED.md in Step 5:

- `wix.config.json` was read and `siteId` + `appId` were extracted (not empty, not undefined).
- `.wix/site.json` now contains both `siteId` and `appId` at the top level.
- `npx @wix/cli token --site "$SITE_ID"` returned a non-empty token (cached in session scratch).
- Every loaded pack with non-empty `apps:` got a 200 OK from the install endpoint.
- Every loaded pack with empty `apps:` got a `skipped` phase entry.
- `.env.local` exists and contains `WIX_CLIENT_ID`.
- `npm_handle` (background `npm install`) was captured and is in session scratch — its exit gate lives in SEED.md Step 4, not here.

If any check fails, surface the failure verbatim instead of transitioning to SEED.md.

---

## Existing project flow (Path B)

Use this path when the user already has a working frontend on disk (Claude Design output, Vite/React app, hand-coded `index.html`) and wants to **connect it to Wix Headless** for hosting + Business Solutions. SKILL.md § "When this skill triggers" routes here based on working-directory detection.

**Differences from Path A:**

| Aspect | Path A (new project) | Path B (existing project) |
|---|---|---|
| Project creation | `npm create @wix/new@latest headless` (via `scaffold.sh`) — fresh Astro blank template | `npm create @wix/new@latest init` — wraps the existing project, leaves source untouched |
| Frontend | Generated by Designer + Components + Pages subagents | Already exists; orchestrator does **not** generate UI |
| Seeders / Designer / Pages / ORCHESTRATION | Run | **Skipped** — there is no Astro structure to populate |
| App installs | From inferred vertical packs | From a quick **project analysis** (see E2) — only apps the existing project actually needs |
| SDK wiring into source | N/A (subagents write Astro + SDK calls from scratch) | **Required (E4)** — edit the project's existing source files in place |
| Build / release | `npx @wix/cli build` + `release` via `release.sh` | `npx @wix/cli release` directly — **no build step**; existing `index.html` is published as-is |
| Entry file | `src/pages/index.astro` (Astro convention) | **Must be `index.html`** at the configured `outputDirectory` |

Run **only**: Wave 0 (MCP bootstrap from SKILL.md) → E1 → E2 → E3 → E4 → E5 → E6. Skip Steps 1–5 above entirely.

### Step E1 — Init (replaces scaffold)

`cd` into the existing project directory. Run, foreground (it's interactive-ish but non-blocking with `--yes`-style defaults; capture stdout):

```bash
npm create @wix/new@latest init
```

> Same package + invoker as Path A's scaffold (`npm create @wix/new@latest headless`), only the subcommand differs: **`init` for existing projects, `headless` for new projects**. Do not combine them (`… headless init` is a known regression).

This creates a Wix Site + Headless Project (App) connected to that Site, and writes `wix.config.json` in the project root:

```jsonc
{
  "projectType": "Site",
  "appId": "16511cb9-3d3a-4371-a04a-bcc176ae5d50",   // SDK clientId
  "siteId": "90b8c952-a7f9-4d79-a2c0-b0ec3e1c1434",  // siteId for every REST call this session
  "site": {
    "outputDirectory": "./site"  // edit to "./" if the entry file is at project root
  }
}
```

**Required follow-ups before continuing:**

1. **Entry file must be `index.html`.** If the project's entry is `index.htm`, `main.html`, etc., either rename to `index.html` or ask the user to confirm renaming. Wix Headless hosting serves `index.html` as the site root; anything else 404s.
2. **`site.outputDirectory` must point at the directory containing `index.html`.** If `index.html` is at the project root, edit `wix.config.json` and set `"outputDirectory": "./"`. Default is `"./site"` which assumes a build output directory.
3. Extract `siteId` and `appId` from `wix.config.json` and hold in session scratch (same role as Path A: `siteId` is the `wix-site-id` header on every REST call).
4. Capture `{ phase: "init", seconds, started, ended }` in `run.json.phases[]`.

Recovery ladder:
- Auth error → surface `"Run \`npx @wix/cli login\` and retry."` and stop (same as Path A; full ladder in `references/shared/AUTHENTICATION.md`).
- `wix.config.json` already exists → skip E1, continue to E2.
- Network / unknown → surface stderr to the user.

### Step E2 — Analyze the project to decide which apps to install

The existing-project flow does NOT use vertical-pack inference from the user prompt. Instead, **read the project files** to decide which Wix Business Solutions are needed. Quick heuristic table:

| Signal in source files | Pack(s) to install |
|---|---|
| Mentions of "event", "wedding", "RSVP", "guests", "ceremony" | `events` (if pack exists), else CMS-backed RSVP via `cms` |
| `<form>` tags, "Contact us", "Get in touch", email collection | `forms` |
| Product listings, "buy", "$", "add to cart", price tags | `stores` (transitively pulls `ecom`, `gift-cards`) |
| Article / blog content, post listings | `blog` |
| Booking, appointments, calendar | `bookings` (if pack exists) |
| Restaurant menu, dishes | `restaurants` (if pack exists) |
| Always | `cms` (any user-editable content) |

Read `index.html` and any top-level source files (`*.jsx`, `*.tsx`, `*.html`, `*.js`) to look for these signals. Cap reading at the top 5 source files by size — don't grovel.

> If unsure between two packs, ask the user with `AskUserQuestion`. Don't install everything "just in case" — every app install adds clutter to the user's dashboard.

### Step E3 — Install apps

For each pack identified in E2, fire the install `curl` per § Step 4a above — same `tenant` / `appInstance` body, same headers, same recovery ladder (delegated to `wix-manage` per Step 3). Capture `{ phase: "app-install-<pack>", seconds }` per install.

**Skip the rest of Path A's Step 4 batch:** no `env pull` for a pure-static site (only needed if E4 below adds SDK code that reads `WIX_CLIENT_ID` at build time; if so, run `env pull` then), **no `npm install`** (the existing project manages its own deps), **no `seed-utilities.sh`** (no Astro `src/utils/` to seed), **no `init-site-json.mjs`** (no `.wix/site.json` lifecycle in this flow).

### Step E4 — SDK wiring

Installing apps in E3 only registers them against the Site — the existing frontend still ignores them until SDK calls are wired in. For each app installed in E3, find the matching feature surface in the project's source files (the same surfaces E2 detected) and wire its SDK calls inline.

1. Add `@wix/sdk` + the pack's packages (from § Step 4c's lookup table above) to the project's `package.json` (`npm init -y` first if absent), then run the project's install command with `--no-fund --no-audit --legacy-peer-deps`.
2. Edit the source files in place. Follow call patterns from `<SKILL_ROOT>/references/<pack>/INSTRUCTIONS.md` (translate Astro idioms → the project's framework; SDK calls themselves are framework-agnostic). Initialize the client once per file:

   ```js
   import { createClient, OAuthStrategy } from "@wix/sdk";
   const wix = createClient({
     modules: { /* pack modules */ },
     auth: OAuthStrategy({ clientId: "<appId from wix.config.json>" }),
   });
   ```

   **Always inline the `appId` literal from `wix.config.json`.** No env vars, no `import.meta.env`, no `window.__WIX_CLIENT_ID__` — read `wix.config.json` once and paste the appId string into every `createClient` call. Keeps the static-site case working with no build step.

Capture `{ phase: "sdk-wiring-<pack>", seconds }` per pack.

### Step E5 — Release (no build)

**Do NOT run `release.sh`** in this flow — `release.sh` runs `npx @wix/cli build` first, and there is nothing to build. The existing project's `index.html` and its sibling assets already sit at the configured `site.outputDirectory`; Wix just needs to publish that directory as-is. Calling `build` here either no-ops (wastes ~5–15 s) or fails if the project has no Astro/Vite config the Wix CLI knows how to invoke.

Run release directly:

```bash
npx @wix/cli release
```

Capture stdout. The CLI prints `Site published on <url>` on success — extract that URL (same parser logic as `release.sh` uses):

```bash
sed -nE 's/.*Site published on ([^[:space:]]+).*/\1/p'
```

Capture `{ phase: "release", seconds }` around the call. No `{ phase: "build" }` entry in `run.json` for this flow.

Auth-failure recovery: same as `release.sh` — if stderr mentions login, surface `"Run \`npx @wix/cli login\` and retry."` and stop. Transient errors (`ECONNRESET`, `temporarily unavailable`, etc.) — retry up to 3 times with `attempt * 5` second backoff, mirroring `release.sh`.

> **If the project needs a client build** (Vite, React, Webpack, etc.), run the project's own build command manually (e.g. `npm run build`) before `npx @wix/cli release`, and make sure `site.outputDirectory` points at the build output. Do not use `wix build`.

### Step E6 — Final message

Emit **exactly two URLs**, both copy-pasted verbatim from tool output / config (URL discipline from `SKILL.md` § "URL discipline" applies here too):

1. **Production URL** — bold heading / link at the top. The exact string from `Site published on <url>` in Step E5's stdout. Do not retype or modify.
2. **Dashboard URL** — `https://manage.wix.com/dashboard/<siteId>` where `<siteId>` is the value from `wix.config.json`.

Skip Path A's perf one-liner buckets that didn't run. For Path B the perf line is:

> `Connected in <Nm Ss> — init <n>s · app-install <n>s · sdk-wiring <n>s · release <n>s`

`sdk-wiring` aggregates every `sdk-wiring-<pack>` phase from E4.

Write a `project`-type memory entry capturing brand (from `wix.config.json`'s implicit project name or ask), siteId, installed apps, and **phase: `connected-existing`** so future sessions know this is an existing-project shell, not a wix-headless-scaffolded build.
