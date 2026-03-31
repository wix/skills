# Project Setup Guide

Step-by-step guide for setting up a Wix Managed Headless project.

## New Project (From Scratch)

### Step 1: Verify Prerequisites

- Node.js v20.11.0 or higher: `node --version`
- Git installed: `git --version`
- Active Wix account at wix.com

### Step 2: Verify Authentication

```bash
npx @wix/cli whoami
```

If this fails, tell the user to run `npx @wix/cli login` first (the only manual step).

### Step 3: Scaffold the Project

Determine the user's intent and pick the appropriate template ID:

| Template | Description | ID |
|----------|-------------|-----|
| Blank Vibe (hello) | Minimal starter with a single hello-world page (Vibe) | `a59b41a5-a5db-4d7c-804f-5dbc86e04c3e` |
| Stores Vibe | E-commerce storefront with product catalog and cart (Vibe) | `38fee0f9-830e-445c-8eec-464455c889b1` |
| CMS Vibe | Content-managed site with dynamic data collections (Vibe) | `a164bf71-a82e-43b4-a5c9-a037e4345df1` |
| Commerce (Wix Stores) | E-commerce storefront with product catalog and cart | `e5da13f4-c01e-4b61-a9c7-55dacd961d54` |
| Scheduler (Wix Bookings) | Appointment and service booking system | `72ade0e3-1871-4c04-ac54-419ca874d9d3` |
| Registration (Wix Forms) | Form-based data collection and registration | `e5d63bf1-cd06-48eb-ad77-0da9235adcf1` |
| Blank (pure headless) | Empty project with Wix SDK wired up, no UI | `212b41cb-0da6-4401-9c72-7c579e6477a2` |

Run the scaffold command:

```bash
npx @wix/create-headless --json \
  --business-name "<name>" \
  --project-name "<directory-name>" \
  --site-template-id "<template-uuid>" \
  --skip-vibe-setup \
  --no-publish \
  --skip-install
```

**`--project-name` validation rules:** 3–20 characters, lowercase letters and numbers only (no hyphens, underscores, or spaces). The target directory must not already exist or must be empty. Invalid names produce a `ProjectNameArgumentIsInvalid` error.

The command outputs JSON to stdout: `{ "projectFolder": "...", "businessId": "...", "projectId": "..." }`. Progress messages go to stderr.

### Step 3.5: Dependencies (Deferred)

Because `--skip-install` is used above, the project has no `node_modules` yet. **Do not run `npm install` now.** All dependencies — both base packages from `package.json` and feature SDK packages (`@wix/stores`, `@wix/forms`, etc.) — will be installed in a single batch after all code is written. This avoids multiple install steps that can hang in agent-driven sessions.

```bash
cd <directory-name>
# No npm install here — proceed to writing code.
# Install happens once before the first execution command (dev/build/preview/release).
# See the Build Order section in wix-headless-features-orchestrator for details.
```

### Step 4: Verify Setup

After scaffolding completes, verify these files exist (these are created by scaffolding itself — no `node_modules` needed):

```
project-root/
├── wix.config.json          # Must have appId and projectId
├── astro.config.mjs         # Must import @wix/astro
├── package.json             # Must have @wix/astro dependency
└── src/
    └── pages/
        └── index.astro      # Default home page
```

Note: `.env.local` is populated later by `npx @wix/cli dev` (which runs after install).

### Step 5: Start Development

```bash
cd project-name
npx @wix/cli dev
```

The dev server starts at `http://localhost:4321`.

---

## Link Existing Astro Project

If you already have an Astro project and want to add Wix Headless:

### Step 1: Verify Authentication

```bash
npx @wix/cli whoami
```

If this fails, tell the user to run `npx @wix/cli login` first.

### Step 2: Run the Link Command

```bash
npx @wix/create-headless link --json \
  --business-name "<name>" \
  --project-name "<frontend-name>"
```

The command outputs JSON to stdout: `{ "projectFolder": "...", "businessId": "...", "projectId": "..." }`.

### Step 3: Verify Generated Files

After linking, verify:
- `wix.config.json` exists with real `appId` and `projectId` values
- `.env.local` contains `WIX_CLIENT_*` variables
- `package.json` includes `@wix/astro` as a dependency

### Step 4: Update Astro Config

Ensure `astro.config.mjs` includes the Wix integration:

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

### Step 5: Dependencies (Deferred)

**Do not run `npm install` now.** Dependencies will be installed in a single batch after all code is written — see the Build Order section in `wix-headless-features-orchestrator`.

---

## Template Types

### Wix Vibe-Compatible Templates

Support AI-assisted visual editing through `npx @wix/cli connect`. These templates are designed for:
- AI-powered content editing
- Visual theme customization
- Component-level editing in the browser

| Template | Description | ID |
|----------|-------------|-----|
| Blank (hello) | Minimal starter with a single hello-world page | `a59b41a5-a5db-4d7c-804f-5dbc86e04c3e` |
| Stores | E-commerce storefront with product catalog and cart | `38fee0f9-830e-445c-8eec-464455c889b1` |
| CMS | Content-managed site with dynamic data collections | `a164bf71-a82e-43b4-a5c9-a037e4345df1` |

### Pure Headless Templates

Standard Astro + Wix Headless templates without Vibe integration. Best for:
- Custom designs that don't need visual editing
- Projects with complex custom logic
- Full developer control over all aspects

| Template | Description | ID |
|----------|-------------|-----|
| Commerce (Wix Stores) | E-commerce storefront with product catalog and cart | `e5da13f4-c01e-4b61-a9c7-55dacd961d54` |
| Scheduler (Wix Bookings) | Appointment and service booking system | `72ade0e3-1871-4c04-ac54-419ca874d9d3` |
| Registration (Wix Forms) | Form-based data collection and registration | `e5d63bf1-cd06-48eb-ad77-0da9235adcf1` |
| Blank | Empty project with Wix SDK wired up, no UI | `212b41cb-0da6-4401-9c72-7c579e6477a2` |

---

## Project Detection Checklist

To confirm a project is a valid Wix Managed Headless project, verify **all three**:

1. `wix.config.json` exists at project root with real (non-placeholder) `appId` and `projectId`
2. `astro.config.mjs` (or `.ts`) imports `@wix/astro`
3. `package.json` has `@wix/astro` as a dependency

If only `wix.config.json` exists without Astro configuration, this may be a standard Wix app project (not headless).

---

## Credential Recovery

If `.env.local` is missing or corrupted:

```bash
npx @wix/cli env pull
```

This pulls all environment variables from the remote Wix configuration. May require re-authentication via `npx @wix/cli login` if session has expired.

---

## Adding React Support

Wix Headless projects support React islands for interactive components.

### Step 1: Install React

```bash
npm install @astrojs/react react react-dom
npm install -D @types/react @types/react-dom
```

### Step 2: Update Astro Config

```javascript
import react from "@astrojs/react";

export default defineConfig({
  integrations: [wix(), react()],
  // ... rest of config
});
```

### Step 3: Use React Components

Create `.tsx` files in `src/components/` and use with `client:*` directives in Astro pages:

```astro
---
import MyComponent from "../components/MyComponent.tsx";
---
<MyComponent client:load />
```

---

## Adding Tailwind CSS

Most Wix Headless templates include Tailwind CSS v4. If not:

### Step 1: Install

```bash
npm install @tailwindcss/vite
```

### Step 2: Configure Vite Plugin

In `astro.config.mjs`:

```javascript
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  // ... rest of config
});
```

### Step 3: Create Global Stylesheet

```css
/* src/styles/global.css */
@import "tailwindcss";
```

### Step 4: Import in Layout

```astro
<style is:global>
  @import "../styles/global.css";
</style>
```
