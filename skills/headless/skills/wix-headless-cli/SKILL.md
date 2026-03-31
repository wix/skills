---
name: wix-headless-cli
description: "Use when scaffolding, configuring, building, previewing, or deploying a Wix Managed Headless project. Triggers: headless project setup, scaffold, wix dev, wix build, wix preview, wix release, wix connect, deploy, configure, environment variables, ship it, see my changes live."
---

# Wix Headless CLI — Project Setup & Management

Manages the lifecycle of Wix Managed Headless projects: scaffolding, linking, credentials, development server, build, preview, and release.

## Immediate Action

Before doing anything, check for a headless project:

```
Check for: wix.config.json AND astro.config.mjs (or .ts)
```

| State Detected | Action |
|---------------|--------|
| Neither file exists | Scaffold a new project → see [Scaffold a New Project](#scaffold-a-new-project) |
| `astro.config.mjs` exists but no `wix.config.json` | Link to Wix → see [Link Existing Project](#link-existing-project) |
| Both exist but no `.env.local` | Guide user to pull credentials → `npx @wix/cli env pull` |
| Both exist + `.env.local` present | Project is ready — proceed with the user's request |

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| `npx @wix/cli dev` in a non-headless project | Check for `wix.config.json` + `@wix/astro` first |
| Running `astro dev` instead of `npx @wix/cli dev` | Always use `npx @wix/cli dev` — it injects Wix credentials |
| Manually editing `.env.local` WIX_CLIENT_* vars | Use `npx @wix/cli env pull` — these are auto-managed |
| Manually editing `wix.config.json` | This file is auto-generated — never edit manually |
| Running `npx @wix/cli release` without previewing | Always run `npx @wix/cli preview` and verify before releasing |
| Committing `.env.local` to git | Add to `.gitignore` — contains sensitive credentials |

---

## Scaffold a New Project

The agent can scaffold a new project using `--json` non-interactive mode.

**Prerequisite — verify authentication:**

```bash
npx @wix/cli whoami
```

If this fails, tell the user to run `npx @wix/cli login` first (the only manual step).

**Run the scaffold command:**

```bash
npx @wix/create-headless --json \
  --business-name "<name>" \
  --project-name "<directory-name>" \
  --site-template-id "<template-uuid>" \
  --skip-vibe-setup \
  --no-publish \
  --skip-install
```

**Required flags:**
- `--json` — enables non-interactive mode
- `--business-name <name>` — name for the Wix business
- `--project-name <name>` — directory name for the local project. **Validation: 3–20 characters, lowercase letters and numbers only** (no hyphens, underscores, or spaces). Directory must not already exist. Invalid names produce `ProjectNameArgumentIsInvalid`.
- `--site-template-id <uuid>` OR `--apps <apps>` — one of these is required (see below)

**Template vs Apps:**
- `--site-template-id <uuid>` — use a template for scaffolding (see table below)
- `--apps <apps>` — comma-separated Wix apps to install (e.g., `--apps stores,forms`). Uses a blank template for code scaffolding and installs specified Wix apps on the business. Valid app names: `stores`, `forms`, `blog`.

When `--apps` is used without `--site-template-id`, the blank vibe template is used for code scaffolding automatically.

**Optional flags:**
- `--skip-vibe-setup` — skip Wix Vibe coding setup
- `--no-publish` — don't publish site after creation
- `--skip-install` — skip `npm install`
- `--skip-git` — skip git init

**Known issue: non-ASCII business names with `--apps`:**
When `--business-name` contains non-ASCII characters (Hebrew, Arabic, CJK, etc.) AND `--apps` is also specified, the scaffold may fail with `FailedCreatingAppProject`. If this happens, retry with an ASCII-transliterated `--business-name` (e.g., "Yeshnaeretz" instead of "ישנה ארץ") while keeping `--apps`. The business display name can be updated later in the Wix dashboard.

**Template IDs — Vibe-Compatible:**

| Template | Description | ID |
|----------|-------------|-----|
| Blank (hello) | Minimal starter with a single hello-world page | `a59b41a5-a5db-4d7c-804f-5dbc86e04c3e` |
| Stores | E-commerce storefront with product catalog and cart | `38fee0f9-830e-445c-8eec-464455c889b1` |
| CMS | Content-managed site with dynamic data collections | `a164bf71-a82e-43b4-a5c9-a037e4345df1` |

**Template IDs — Pure Headless:**

| Template | Description | ID |
|----------|-------------|-----|
| Commerce (Wix Stores) | E-commerce storefront with product catalog and cart | `e5da13f4-c01e-4b61-a9c7-55dacd961d54` |
| Registration (Wix Forms) | Form-based data collection and registration | `e5d63bf1-cd06-48eb-ad77-0da9235adcf1` |
| Blank | Empty project with Wix SDK wired up, no UI | `212b41cb-0da6-4401-9c72-7c579e6477a2` |

**Output:** JSON result to stdout: `{ "projectFolder": "...", "businessId": "...", "projectId": "..." }`. Progress and status messages go to stderr.

**Errors:** `{ "error": { "code": "...", "message": "..." } }` to stdout. Detailed error messages also appear on stderr.

**Error recovery — do NOT silently work around failures:**

If the scaffold command fails:
1. **Do NOT** drop the `--apps` flag and install apps separately via MCP. MCP app installation does not fully initialize apps (e.g., Stores V3 catalog won't activate, making product management impossible).
2. **Do NOT** silently switch to a different template or remove flags without telling the user.
3. Instead, **tell the user what failed** and suggest these options:
   - Retry with an ASCII-only `--business-name` (most common fix for `FailedCreatingAppProject`)
   - Retry with `--site-template-id` for the app-specific template (e.g., `38fee0f9-830e-445c-8eec-464455c889b1` for stores) instead of `--apps`
   - Let the user troubleshoot or scaffold manually

The key principle: when you leave the documented path, ask the user before proceeding — silent workarounds cascade into harder-to-debug problems.

**Agent workflow note:** Always capture both stdout and stderr. Never redirect stderr to `/dev/null` — it contains error details needed for debugging failures. Parse JSON from stdout; use stderr for logging and diagnostics.

After scaffolding, `cd` into the project directory.

**Lifecycle logging:** After scaffolding succeeds, create `.wix/lifecycle.log.md` per `../shared/LIFECYCLE_LOG.md`. Write the `# Lifecycle Log` header, the `## Run` header (timestamp, site name, business type, planned features), the `### solution-architect` phase (from the functional plan context — business type, brand, apps, collections, pages), and the `### cli` phase (command, result, project path, business ID, timestamps).

**When coming from the solution-architect flow:** The functional plan provides `--apps` and `--project-name` values. The brand name from the solution architect (if captured) provides `--business-name`. If the brand name wasn't captured during the solution-architect phase, the designer skill will ask for it during brand discovery.

**Do not run `npm install` yet** — dependencies will be installed in a single batch after all code is written. Proceed to the designer skill (`wix-headless-designer`) for brand discovery and visual design, then to the features skill (`wix-headless-features-orchestrator`) for SDK integration. See the Build Order section in `wix-headless-features-orchestrator` for when and how to run the single install.

---

## Link Existing Project

For an existing Astro project that needs Wix connection. The agent can run this using `--json` non-interactive mode.

**Prerequisite — verify authentication:**

```bash
npx @wix/cli whoami
```

If this fails, tell the user to run `npx @wix/cli login` first.

**Run the link command:**

```bash
npx @wix/create-headless link --json \
  --business-name "<name>" \
  --project-name "<frontend-name>"
```

**Required flags:**
- `--json` — enables non-interactive mode
- `--business-name <name>` — name for the Wix business
- `--project-name <name>` — name for the frontend project

**Output:** Same JSON format as scaffold — `{ "projectFolder": "...", "businessId": "...", "projectId": "..." }` to stdout.

---

## CLI Commands Reference

All commands run from the project root.

| Command | Description | Interactive? |
|---------|-------------|:------------:|
| `npx @wix/create-headless` | Scaffold a new project (interactive mode) | Yes |
| `npx @wix/create-headless --json ...` | Scaffold a new project (non-interactive) | No |
| `npx @wix/create-headless link` | Link existing project (interactive mode) | Yes |
| `npx @wix/create-headless link --json ...` | Link existing project (non-interactive) | No |
| `npx @wix/cli dev` | Start local development server with hot reload | No |
| `npx @wix/cli build` | Compile project for production | No |
| `npx @wix/cli preview` | Deploy to temporary preview URL on Wix infra | No |
| `npx @wix/cli release` | Deploy to production (CDN, SSL, auto-scaling) | No |
| `npx @wix/cli connect` | Link project to Wix Vibe for AI editing | Yes |
| `npx @wix/cli env pull` | Pull environment variables to `.env.local` | Yes (may need auth) |
| `npx @wix/cli env set <KEY> <VALUE>` | Set an environment variable | No |
| `npx @wix/cli env remove <KEY>` | Remove an environment variable | No |
| `npx @wix/cli generate` | Add extensions (dashboard pages, event handlers) | No |
| `npx @wix/cli login` | Authenticate with Wix | Yes |
| `npx @wix/cli logout` | Remove stored credentials | No |
| `npx @wix/cli whoami` | Show current authenticated user | No |

See `references/COMMANDS.md` for full command details with flags and examples.

---

## Development Workflow

```
1. npx @wix/cli dev      → Local dev server (http://localhost:4321)
2. npm install           → Ensure dependencies are current
3. npx tsc --noEmit      → TypeScript check
4. npx @wix/cli build    → Production build
5. npx @wix/cli preview  → Deploy to preview URL for testing
6. [Verify preview]
7. npx @wix/cli release  → Deploy to production
```

**Key points:**
- Always use `npx @wix/cli dev` (not `astro dev`) — it injects Wix SDK credentials
- `npx @wix/cli preview` creates a unique URL per deployment; previous previews remain valid
- `npx @wix/cli release` deploys to production — verify preview first

---

## Project Structure

```
project-root/
├── wix.config.json              # Wix app + site IDs (auto-generated, DO NOT EDIT)
├── astro.config.mjs             # Astro config with @wix/astro integration
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript config
├── .env.local                   # Local env vars (auto-populated, DO NOT COMMIT)
├── .wix/                        # Wix internal data (DO NOT EDIT)
├── .astro/                      # Astro build cache (auto-generated)
├── dist/                        # Production build output (auto-generated)
├── public/                      # Static assets (favicon, images, robots.txt)
├── src/
│   ├── pages/                   # File-based routing (*.astro → routes)
│   ├── components/              # Reusable UI components
│   ├── layouts/                 # Page layouts
│   ├── styles/                  # Global styles (Tailwind CSS)
│   ├── utils/                   # Shared utilities
│   ├── extensions/              # Wix extensions (if any)
│   ├── env.d.ts                 # TypeScript env types
│   └── extensions.ts            # Wix extension registration
└── node_modules/
```

---

## Configuration Files

### wix.config.json

Auto-generated. Contains `appId` and `projectId`. Never edit manually.

```json
{
  "appId": "your-app-id",
  "projectId": "your-project-id"
}
```

### astro.config.mjs

Required Wix headless configuration:

```javascript
import { defineConfig } from "astro/config";
import wix from "@wix/astro";
import cloudProviderFetchAdapter from "@wix/cloud-provider-fetch-adapter";

const isBuild = process.env.NODE_ENV === "production";

export default defineConfig({
  integrations: [wix()],
  ...(isBuild && { adapter: cloudProviderFetchAdapter({}) }),
  image: {
    domains: ["static.wixstatic.com"],
  },
  output: "server",
});
```

### tsconfig.json

Standard TypeScript config with React JSX support for React islands.

### .env.local

Auto-populated by `npx @wix/cli dev`. Contains:
- `WIX_CLOUD_PROVIDER` — Cloud provider (Cloudflare)
- `WIX_CLIENT_ID` — App ID
- `WIX_CLIENT_INSTANCE_ID` — Instance ID
- `WIX_CLIENT_PUBLIC_KEY` — RSA public key
- `WIX_CLIENT_SECRET` — App secret

**Never commit `.env.local` to git.** Never manually edit `WIX_CLIENT_*` variables.

For custom env vars, add them to `.env.local` for local dev and use `npx @wix/cli env set` for production.

Access in Astro frontmatter:
```astro
---
const myKey = import.meta.env.MY_API_KEY;
---
```

---

## Environment Variable Management

| Command | Purpose |
|---------|---------|
| `npx @wix/cli env pull` | Pull remote env vars to local `.env.local` |
| `npx @wix/cli env set MY_KEY my-value` | Set a custom env var (synced to remote) |
| `npx @wix/cli env remove MY_KEY` | Remove a custom env var |

**Production:** Environment variables are injected automatically by Wix infrastructure during `npx @wix/cli preview` and `npx @wix/cli release`. Custom vars set via `npx @wix/cli env set` are available in production.

---

## Build & Deploy

### Preview Deployment

```bash
npx @wix/cli preview
```

- Deploys to a temporary preview URL on Wix's edge infrastructure
- Full production environment: CDN, SSL, edge runtime
- Each preview URL is unique and immutable
- Use for stakeholder review before releasing
- **Finding the URL:** The preview URL is printed to the terminal. There is no CLI command to retrieve it later — find it in the Wix dashboard under Settings > Domains. See `references/GOING_LIVE.md`

> **After running `npx @wix/cli preview`:** Extract the site URL from the command output and present it prominently to the user. This is their headless site URL — they need it to view their site. If the URL is not visible in the output, tell the user to check the Wix dashboard under Settings > Domains.

### Production Release

```bash
npx @wix/cli release
```

- Deploys to production on Wix's managed infrastructure
- CDN distribution, SSL, auto-scaling included
- Takes effect on configured custom domain (if any)
- Verify preview first
- **Finding the URL:** The published site URL is printed to the terminal. To retrieve it later, check the Wix dashboard under Settings > Domains. See `references/GOING_LIVE.md`

> **After running `npx @wix/cli release`:** Extract the production site URL from the command output and present it prominently to the user. This is their live headless site URL. If the URL is not visible in the output, tell the user to check the Wix dashboard under Settings > Domains.

### Custom Domains

Configured in the Wix business dashboard (manual step):
1. Go to Settings > Domains in the Wix dashboard
2. Add custom domain
3. Follow DNS configuration instructions
4. SSL is provisioned automatically

---

## Deploy Preview (Inner Loop)

After any code change (bug fix, feature addition, component edit), run this validated sequence to build, preview, and surface the URL.

### Step 1: TypeScript Check
```bash
npx tsc --noEmit
```
Catches type errors faster than a full build. Fix any errors before proceeding.

### Step 2: Build
```bash
npx @wix/cli build
```
**Success:** Exit code 0, produces `dist/` directory.

**On failure:** Common fixes:
- Adapter errors → `npm install -D @wix/cloud-provider-fetch-adapter`
- Import resolution → Check paths and package installation
- TypeScript errors missed by `tsc` → Fix and re-run from Step 1

### Step 3: Preview

**Prerequisite:** Step 2 MUST have completed successfully. Preview uploads the build output — without it, you get "Project build output is missing".

```bash
npx @wix/cli preview
```

### Step 4: Surface the URL
After `npx @wix/cli preview` succeeds:
1. **Extract the preview URL** from the command output (look for a URL containing `.wix.dev` or similar)
2. **Present it prominently** to the user — this is their primary deliverable
3. Mention they can run `npx @wix/cli release` when ready to go live

**On failure:** Check `.wix/debug.log` for details. If build succeeded but preview fails, run `npx @wix/cli env pull` and retry.

---

## Non-Matching Intents

| User Wants | Redirect To |
|-----------|------------|
| "Build me a website", describe their business needs | `wix-headless-solution-architect` |
| Design my site / brand / style / visual | `wix-headless-designer` |
| Add a feature (form, products, blog) | `wix-headless-features-orchestrator` |
| Build a Wix app (not headless) | This is NOT a headless project |
