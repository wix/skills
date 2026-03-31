# CLI Command Reference

Complete reference for all Wix CLI commands used in Managed Headless projects.

## Project Creation

### `npx @wix/create-headless`

Scaffold a new Wix Managed Headless project.

**Interactive mode** (default): Opens browser for Wix login, prompts for template selection.

**Non-interactive mode** (`--json`): Runs without prompts. Requires prior authentication via `npx @wix/cli login`.

#### Non-Interactive Init

```bash
npx @wix/create-headless --json \
  --business-name "<name>" \
  --project-name "<directory-name>" \
  --site-template-id "<template-uuid>"
```

**Required flags:**

| Flag | Description |
|------|-------------|
| `--json` | Enable non-interactive mode |
| `--business-name <name>` | Name for the Wix business |
| `--project-name <name>` | Directory name for the local project (see validation rules below) |
| `--site-template-id <uuid>` | Template UUID (see template table below) |

**`--project-name` validation rules:**
- 3 to 20 characters long
- Only lowercase letters and numbers (no hyphens, underscores, spaces, or special characters)
- Target directory must not already exist (or must be empty)

**Optional flags:**

| Flag | Description |
|------|-------------|
| `--skip-vibe-setup` | Skip Wix Vibe coding setup |
| `--no-publish` | Don't publish site after creation |
| `--skip-install` | Skip `npm install` |
| `--skip-git` | Skip git init |
| `--template-repo <url>` | Custom git template repo (use with `--site-template-id`) |
| `--template-repo-path <path>` | Path inside git repo |
| `--template-path <path>` | Local template directory |
| `--template-params <json>` | Extra template params as JSON string |
| `--cloud-provider <provider>` | `cloudflare` (default) or `kubernetes` |

**Non-interactive mode recommendation:** Use `--skip-install` in agent-driven or non-interactive workflows. The `npm install` step can hang with no visible progress. Run `npm install` separately after scaffolding to see output and diagnose failures.

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
| Scheduler (Wix Bookings) | Appointment and service booking system | `72ade0e3-1871-4c04-ac54-419ca874d9d3` |
| Registration (Wix Forms) | Form-based data collection and registration | `e5d63bf1-cd06-48eb-ad77-0da9235adcf1` |
| Blank | Empty project with Wix SDK wired up, no UI | `212b41cb-0da6-4401-9c72-7c579e6477a2` |

**JSON output (stdout):**
```json
{
  "projectFolder": "/path/to/project",
  "businessId": "uuid",
  "projectId": "uuid"
}
```

**Progress (stderr):** Human-readable status messages.

**Errors (stdout + stderr):**
```json
{ "error": { "code": "...", "message": "..." } }
```

**Common errors:**

| Error Code | Cause | Fix |
|------------|-------|-----|
| `ProjectNameArgumentIsInvalid` | `--project-name` contains invalid characters (hyphens, underscores, uppercase) or is outside the 3–20 character range | Use only lowercase letters and numbers, 3–20 characters (e.g., `longevityskincare` not `longevity-skincare`) |
| `ProjectNameArgumentIsInvalid` | Target directory already exists and is not empty | Choose a different name or delete/empty the existing directory |

**Prerequisites:**
- Node.js v20.11.0+
- Git installed
- Active Wix account
- Authenticated via `npx @wix/cli login` (for non-interactive mode)

### `npx @wix/create-headless link`

Link an existing Astro project to a Wix Headless backend.

**Interactive mode** (default): Opens browser for Wix login.

**Non-interactive mode** (`--json`): Runs without prompts. Requires prior authentication via `npx @wix/cli login`.

#### Non-Interactive Link

```bash
npx @wix/create-headless link --json \
  --business-name "<name>" \
  --project-name "<frontend-name>"
```

**Required flags:**

| Flag | Description |
|------|-------------|
| `--json` | Enable non-interactive mode |
| `--business-name <name>` | Name for the Wix business |
| `--project-name <name>` | Name for the frontend project |

**JSON output:** Same format as `headless init` — `{ "projectFolder", "businessId", "projectId" }` to stdout.

**What it creates:**
- `wix.config.json` with appId and projectId
- `.env.local` with authentication credentials
- Updates `package.json` with `@wix/astro` dependency

---

## Development

### `npx @wix/cli dev`

Start local development server with Wix SDK credential injection.

```bash
npx @wix/cli dev
```

**Behavior:**
- Starts Astro dev server at `http://localhost:4321`
- Injects Wix SDK credentials automatically
- Populates `.env.local` with required WIX_CLIENT_* variables
- Hot reload enabled — code changes reflect immediately
- Wix SDK calls work with automatic authentication

**Important:** Always use `npx @wix/cli dev` instead of `astro dev`. The `astro dev` command does NOT inject Wix credentials, so SDK calls will fail.

---

## Build & Deploy

### `npx @wix/cli build`

Compile the project for production deployment.

```bash
npx @wix/cli build
```

**Behavior:**
- Runs TypeScript compilation
- Bundles all pages, components, and assets
- Uses Cloudflare adapter (`@wix/cloud-provider-fetch-adapter`)
- Output goes to `dist/` directory
- Equivalent to running `astro build` with Wix-specific configuration

**Common failures:**
- TypeScript errors → Run `npx tsc --noEmit` first to identify issues
- Missing dependencies → Run `npm install`
- Import resolution errors → Check package installation and paths

### `npx @wix/cli preview`

Deploy to a temporary preview URL for testing.

```bash
npx @wix/cli preview
```

**Behavior:**
- Builds and deploys to Wix edge infrastructure
- Returns a unique preview URL
- Full production environment: CDN, SSL, edge runtime
- Each preview URL is immutable — subsequent deployments create new URLs
- Previous preview URLs remain accessible

**Use cases:**
- Verify production behavior before releasing
- Share with stakeholders for review
- Test with production-like environment

### `npx @wix/cli release`

Deploy to production.

```bash
npx @wix/cli release
```

**Behavior:**
- Builds and deploys to Wix production infrastructure
- CDN distribution with global edge network
- Automatic SSL provisioning
- Auto-scaling enabled
- Takes effect on configured custom domain (if set)
- Provides preview URLs for site and dashboard, plus published site URL

**Caution:** Always run `npx @wix/cli preview` and verify before releasing.

---

## Authentication

### `npx @wix/cli login`

Authenticate with Wix platform.

```bash
npx @wix/cli login
```

**Interactive:** Yes — opens browser for login flow.

### `npx @wix/cli logout`

Remove stored authentication credentials.

```bash
npx @wix/cli logout
```

### `npx @wix/cli whoami`

Display the currently authenticated user.

```bash
npx @wix/cli whoami
```

---

## Environment Variables

### `npx @wix/cli env pull`

Retrieve environment variables from remote storage to local `.env.local`.

```bash
npx @wix/cli env pull
```

**Interactive:** May require authentication if not logged in.

**Behavior:**
- Downloads remote environment configuration
- Writes to `.env.local` in project root
- Overwrites existing `.env.local` content

### `npx @wix/cli env set`

Set or update an environment variable.

```bash
npx @wix/cli env set <KEY> <VALUE>
```

**Example:**
```bash
npx @wix/cli env set GOOGLE_MAPS_KEY abc123
```

The variable is stored remotely and available in preview/production deployments.

### `npx @wix/cli env remove`

Delete an environment variable.

```bash
npx @wix/cli env remove <KEY>
```

---

## Extensions

### `npx @wix/cli generate`

Add Wix extensions to an existing project.

```bash
npx @wix/cli generate
```

**Available extensions:**
- Dashboard pages (custom admin pages)
- Event handlers (react to Wix events)
- Service plugins (custom business logic)

Each extension is created in `src/extensions/` and must be registered in `src/extensions.ts`.

---

## Integration

### `npx @wix/cli connect`

Link project to Wix Vibe for AI-assisted visual editing.

```bash
npx @wix/cli connect
```

**Interactive:** Yes — opens browser to create a GitHub repository.

**Requirements:** Project must use a Vibe-compatible template.

---

## Skills Management

### `npx @wix/cli skills add`

Install Wix Skills for AI tool integration.

```bash
npx @wix/cli skills add
```

### `npx @wix/cli skills update`

Update existing Wix Skills to latest versions.

```bash
npx @wix/cli skills update
```

---

## Telemetry

### `npx @wix/cli telemetry`

Manage anonymous usage data collection.

```bash
npx @wix/cli telemetry
```

Allows enabling or disabling telemetry data collection.
