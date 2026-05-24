# Setup

Runs once per session, immediately after plan approval. Establishes MCP connectivity, installs apps, pulls env, kicks off npm install in background, writes memory, creates the user-facing roadmap.

Target: **~15 seconds on the critical path** (everything after the MCP prefix discovery in Step 0 runs as a single concurrent batch).

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

## Step 0 — MCP Prefix Discovery + Schema Bootstrap (first time only)

Runs once per session, before any MCP call. Separate from the Setup step because it requires a sequential **discover prefix → verify connectivity → bootstrap schemas** chain.

1. **Discover the MCP prefix.** Wix MCP tool names take the form `<prefix>WixREADME`. Use whatever tool-discovery primitive your runtime provides to look up `WixREADME` and strip the trailing suffix from the returned tool name — the remainder (ending in `wix-mcp-remote__` or similar) is the **MCP prefix**.
2. Call `<prefix>WixREADME` once to verify connectivity.
3. If discovery returns no match or the verify call fails → stop and tell the user: *"Wix MCP tools are not available in this session. Please ensure the Wix MCP server is connected (or that the Wix plugin is enabled), then restart your client."*
4. **Pre-load Wix MCP tool schemas** — read `<SKILL_ROOT>/references/commands/mcp-bootstrap.md` and follow its single `ToolSearch` invocation. Loads every Wix MCP tool schema the build will use (CallWixSiteAPI, SearchWixRESTDocumentation, ReadFullDocsArticle, ReadFullDocsMethodSchema, SearchWixCLIDocumentation, SearchWixSDKDocumentation, SearchWixHeadlessDocumentation, SearchWixWDSDocumentation, SearchBuildAppsDocumentation, BrowseWixRESTDocsMenu).
5. Hold the prefix for the whole session. Pass it into **every** subagent prompt as:
   ```
   MCP tool prefix: <prefix>
   Use this prefix for every Wix MCP call. Example: <prefix>CallWixSiteAPI, <prefix>WixREADME.
   ```

See `references/shared/MCP_PREFIX.md` for the tool-not-found recovery procedure that subagents use if the prefix somehow fails downstream.

> **Why the MCP bootstrap is mandatory.** Without it, the first `CallWixSiteAPI` emits `body` as a JSON string (because the schema isn't loaded) and returns `Expected object, received string`. Pinning the schema-load list in `references/commands/mcp-bootstrap.md` and reading it as a discrete step makes the operation impossible to skim past — the orchestrator can skip a footnote; it can't skip a numbered step that resolves to a single concrete tool call.

---

## Setup Dispatch — one concurrent batch

> **BATCHING — read this twice before proceeding.**
>
> Launch every operation below as a single concurrent batch. No narration, no *"Now setting up:"*, no transition text between dispatches.
>
> Any text adjacent to a dispatch closes the batch and forces remaining operations into separate turns. An earlier run lost 13s to roadmap-tracker calls splitting across 13 turns; an earlier run lost ~50 minutes to an npm install recovery gate. Both are eliminated by strict single-batch dispatch here.

### Contents of the setup dispatch

The skill assembles this dispatch dynamically from the loaded vertical packs. The items below list what to emit.

#### 1. Verify scaffold completed

**Before the setup dispatch:** read `<project>/wix.config.json` to confirm the background scaffold from Discovery Step 1 finished. If not, wait for the background scaffold to finish. On scaffold failure, retry the inline `npm create @wix/new` call once (same shell command from DISCOVERY.md Step 1); surface the error if it still fails. Recovery ladder is documented in DISCOVERY.md § "Strict-then-recover" — auth, invalid template, etc.

Once `wix.config.json` exists, extract `siteId` (value of the `siteId` field — this is the businessId for all MCP calls in the session).

`cd` into the project directory so all subsequent file operations and shell commands are relative to it.

#### 2. The dispatch itself (one concurrent batch)

**MCP app installs** — one `<prefix>CallWixSiteAPI` per app in the union of loaded packs' `apps[*]`. Example for an ecommerce run (stores pack contributes one app; cms pack contributes none):

```
<prefix>CallWixSiteAPI(
  siteId: "<siteId>",
  reason: "Install Wix Stores app for <brand>",
  sourceDocUrl: "https://dev.wix.com/docs/picasso/wix-ai-docs/recipes-v2/manage/platform/recipe-install-wix-apps",
  method: "POST",
  url: "https://www.wixapis.com/apps-installer-service/v1/app-instance/install",
  body: {
    tenant: { tenantType: "SITE", id: "<siteId>" },
    appInstance: { appDefId: "<pack.apps[0].appDefId>", enabled: true }
  }
)
```

> The `CallWixSiteAPI` schema was already loaded by the Step 0 MCP bootstrap, so `body` is correctly typed as a JSON object on the first call. See `references/shared/MCP_PREFIX.md` § "CallWixSiteAPI call conventions".

A 200 response with `"enabled": true` confirms success.

**Packs with `apps: []` (e.g. `cms`)** — record a phase entry in `run.json` anyway: `{phase: "app-install-<pack>", status: "skipped", notes: "Bundled with Wix platform; no install required"}`. Without an explicit skipped entry, `run.json` reads as a silent omission ("did the CMS install run? was it skipped? did it fail?"); the explicit entry makes observability unambiguous.

**Namespace propagation:** After app install, the app's API namespace may take up to 30 seconds to register. If a downstream MCP call fails with `UNSUPPORTED_FORM_NAMESPACE`, wait 10 seconds and retry up to 3 times. Phase 1 Seeders handle this retry themselves.

**Shell: `npx @wix/cli env pull`** (foreground, ~5s). Writes `WIX_CLIENT_ID` to `.env.local`. Idempotent. Skipping this historically caused `Missing environment variable WIX_CLIENT_ID` build failures.

**Background shell: `npm install ...`**:

The package list is the union of:
- Always: `@wix/sdk tailwindcss @tailwindcss/vite`
- Per loaded pack: each pack's `packages` array

> **Do not add any package beyond this set.** If a pack feels like it should have its own SDK (`@wix/<pack-name>`), confirm by reading its `packages:` array. Passive packs (gift-cards) intentionally declare nothing because they're runtime-detected via REST. There is no `@wix/gift-cards` SDK on npm — adding it on a hunch fails with `npm 404`. Same logic for any other pack: the union above is the install list. Period.

Flags: `--no-fund --no-audit --legacy-peer-deps`. `--legacy-peer-deps` is mandatory (Wix SDK transitive peer conflicts). `--no-fund --no-audit` prevent interactive prompts that hang agent sessions.

Because scaffold runs with `--skip-install`, delete the stale lockfile before installing: `rm -f package-lock.json`.

Example combined command (ecommerce run):
```bash
rm -f package-lock.json && npm install --no-fund --no-audit --legacy-peer-deps \
  @wix/sdk tailwindcss @tailwindcss/vite \
  @wix/stores @wix/ecom @wix/redirects @wix/site \
  @wix/data @wix/essentials
```

Capture the background process's handle (whatever your runtime uses to wait on a long-running shell) for later wait in Step 8 (Build & Preview).

**Memory writes** — two writes:
1. `MEMORY.md` index entry (one line)
2. `project`-type memory file with brand, vertical(s), apps, pages, project path, phase: `scaffolding`

**User-facing roadmap × N** — target 6–8 entries mapped to phase boundaries:

| Entry | Marks completed |
|------|-----------------|
| Scaffold project | Immediately on creation (already done in Discovery) |
| Install apps | Immediately on creation (this dispatch) |
| Seed data | After Phase 1 Seed returns (Step 6) |
| Design site | After Phase 2 Design System returns (Step 4) |
| Generate images | After image subagent returns (may finish later than critical path) |
| Wire features | After Phase 3 Components + Phase 4 Pages return (Step 7/8) |
| Install dependencies | After npm install background shell completes (Step 8) |
| Build and preview | After Step 8 |

> **No ampersands in roadmap titles.** Some progress trackers HTML-escape input — `"Build & preview"` renders as literal `Build &amp; preview`. Spell out "and" (or restructure) to avoid `&`. Same for `<`, `>`, `"` and other HTML-meaningful characters.

> **Avoid the 13-entry sprawl.** Historical runs used one entry per phase-per-feature ("Design page — Home", "Seed stores", "Wire CMS", etc.). Collapse to the phase-boundary list above. Users care about milestones, not sub-phases.

**Shell: `mkdir -p .wix`** — minimal. No `.wix/logs/`.

### Batching verification

After the dispatch, the run log should show ~8–12 operations dispatched as one concurrent batch (varies by pack count). If they spread across multiple turns, the batching guidance failed and the skill needs to be tightened.

---

## npm install recovery

If the background npm install from the Setup dispatch fails or hangs:

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

4. **Last resort:** tell the user: *"npm install is hanging. Please run `npm install --legacy-peer-deps` manually in your terminal, then let me know when it's done."*

---

## After the Setup Dispatch

Proceed immediately to **Step 3 — Phase 1 Seed + Phase 2 Design System + Image Phase 1** — see `ORCHESTRATION.md`. Do not wait for the background npm install; that's waited on in Step 8.

---

## Existing project flow

Use this path when the user already has a working frontend on disk (e.g. a Claude Design output, a Vite/React app, a hand-coded `index.html`) and wants to **connect it to Wix Headless** for hosting + Business Solutions. The user explicitly says things like *"connect this to Wix Headless"*, *"add Wix Headless to this project"*, or invokes a prompt that references `wix-headless.dev/skill.md`.

**Differences from the new-project flow:**

| Aspect | New project | Existing project |
|---|---|---|
| Project creation | `npm create @wix/new@latest headless` (via `scaffold.sh`) — fresh Astro blank template | `npx @wix/create-new init` — wraps the existing project, leaves source untouched |
| Frontend | Generated by Phases 2–5 (Astro + designer + components + pages) | Already exists; orchestrator does **not** generate UI |
| Seeders / Designer / Pages waves | Run | **Skipped** — there is no Astro structure to populate |
| App installs | From inferred vertical packs | From a quick **project analysis** (see below) — only apps the existing project actually needs |
| SDK wiring into source | N/A (designer/pages waves write Astro + SDK calls from scratch) | **Required** — edit the project's existing source files in place to wire each installed app's SDK calls to its corresponding feature surface |
| Build / release | `npx @wix/cli build` + `release` via `release.sh` | `npx @wix/cli release` directly — **no build step**; the existing `index.html` is published as-is |
| Entry file | `src/pages/index.astro` (Astro convention) | **Must be `index.html`** at the configured `outputDirectory` |

### Step E1 — Init (replaces scaffold)

`cd` into the existing project directory. Run, foreground (it's interactive-ish but non-blocking with `--yes`-style defaults; capture stdout):

```bash
npx @wix/create-new init
```

This creates a Wix Site + Headless Project (App) connected to that Site, and writes `wix.config.json` in the project root:

```jsonc
{
  "projectType": "Site",
  "appId": "16511cb9-3d3a-4371-a04a-bcc176ae5d50", // SDK clientId
  "siteId": "90b8c952-a7f9-4d79-a2c0-b0ec3e1c1434", // businessId for all MCP calls
  "site": {
    "outputDirectory": "./site"  // edit to "./" if the entry file is at project root
  }
}
```

**Required follow-ups before continuing:**

1. **Entry file must be `index.html`.** If the project's entry is `index.htm`, `main.html`, etc., either rename to `index.html` or ask the user to confirm renaming. Wix Headless hosting serves `index.html` as the site root; anything else 404s.
2. **`site.outputDirectory` must point at the directory containing `index.html`.** If `index.html` is at the project root, edit `wix.config.json` and set `"outputDirectory": "./"`. Default is `"./site"` which assumes a build output directory.
3. Extract `siteId` from `wix.config.json` — same role as in the new-project flow (businessId for every MCP call this session).
4. Capture timing as `{ phase: "init", seconds: <duration>, started, ended }` in `run.json.phases[]`.

Recovery ladder:
- Auth error → surface `"Run \`npx @wix/cli login\` and retry."` and stop (same as new-project flow).
- `init` already ran here (a `wix.config.json` already exists) → skip Step E1, continue to E2.
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

### Step E3 — Install apps (reuse new-project flow's install mechanism)

For each pack identified in E2, follow `<SKILL_ROOT>/references/commands/install-app.md` — the `CallWixSiteAPI` body, `appName → appDefId` lookup, and recovery ladder are identical to the new-project flow. Capture `{ phase: "app-install-<appName>", seconds }` per install.

Skip the new-project flow's other Wave-2 operations: **no `env pull` is required** for a pure-static site (only needed if the project will call Wix SDK from server-side / build-time code), **no `npm install`** (the existing project manages its own deps), **no `seed-utilities.sh`** (no Astro `src/utils/` to seed), **no `init-site-json.mjs`** (no `.wix/site.json` lifecycle).

> If the user wants to wire Wix SDK calls into the existing project (e.g. submit an RSVP form to a Wix CMS collection), then `env pull` + adding `@wix/sdk` + the relevant `@wix/<pack>` packages to the project's own `package.json` IS needed. Treat that as a follow-up sub-task per-pack and let the user confirm before modifying their `package.json`.

### Step E4 — SDK wiring

Installing apps in E3 only registers them against the Site — the existing frontend still ignores them until SDK calls are wired in. For each app installed in E3, find the matching feature surface in the project's source files (the same surfaces E2 detected) and wire its SDK calls inline.

1. Add `@wix/sdk` + the pack's `packages:` (from `references/verticals/<pack>.md`) to the project's `package.json` (`npm init -y` first if absent), then run the project's install command. `--no-fund --no-audit --legacy-peer-deps`.
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

Skip the new-project flow's perf one-liner phases that didn't run (`design-system`, `images`, etc.). For Path B the perf line is:

> `Connected in <Nm Ss> — init <n>s · app-install <n>s · sdk-wiring <n>s · release <n>s`

`sdk-wiring` aggregates every `sdk-wiring-<pack>` phase from E4.

Write a `project`-type memory entry capturing brand (from `wix.config.json`'s implicit project name or ask), siteId, installed apps, and **phase: `connected-existing`** so future sessions know this is an existing-project shell, not a wix-headless-scaffolded build.

---
