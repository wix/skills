---
name: wix-headless-features-orchestrator
description: "Use when adding any feature to a Wix Managed Headless project.
Entry point for ALL feature requests — single or multiple.
Triggers: add a form, add products, contact form,
product catalog, implement the plan, wire up the site,
coming from design skill, add features."
---

# Wix Headless Features — Orchestrator

Entry point for all feature work. Handles shared setup and teardown, delegates implementation to dedicated solution skills.

## CRITICAL — This Skill Must Not Be Bypassed

Individual feature skills (`wix-headless-forms`, `wix-headless-cms`,
`wix-headless-stores`, `wix-headless-blog`) are **inner skills**.
They must ONLY be invoked by this orchestrator, never directly.

If you are the designer skill handing off to features:
→ Invoke `wix-headless:wix-headless-features-orchestrator`

If you are the solution-architect or CLI skill:
→ Invoke `wix-headless:wix-headless-features-orchestrator`

Never invoke `wix-headless:wix-headless-forms` or
`wix-headless:wix-headless-cms` directly.

## Flow Enforcement

Features requires the full flow: solution-architect → cli → designer → features.

If the user reaches features directly (e.g., "add a contact form") without a project:
- No `wix.config.json` → redirect to `wix-headless-solution-architect`

If a project exists but design hasn't run (no designed components):
- Redirect to `wix-headless-designer` first

## When to Use This Skill

| Trigger | Example |
|---------|---------|
| Wire components to data | "Connect the product grid to real products" |
| Add SDK functionality | "Add cart functionality" |
| Add a specific feature | "Add a contact form" |
| Coming from design skill | Automatic handoff after visual design is complete |
| Implement the plan | "Wire up all the features", "Implement the plan" |

## When NOT to Use This Skill

| Scenario | Use Instead |
|----------|------------|
| Design or restyle a page | `wix-headless-designer` |
| Brand, colors, fonts, visual identity | `wix-headless-designer` |
| Create a new page from scratch (no designed component exists) | `wix-headless-designer` first, then features |

---

## Shared Beginning (always runs first)

### 1. MCP Availability (Blocking — standalone entry only)

**Skip this step if arriving from the solution-architect → cli → designer flow** (the solution-architect skill already verified MCP connectivity in that session).

Only verify MCP when this skill is invoked directly (e.g., user says "add a contact form" on an existing project). In that case, call `mcp__wix-mcp-remote__WixREADME`.

If the call fails or the tool is not available → **stop** and tell the user:
> *"Wix MCP tools are not connected. Feature implementation requires MCP for product replacement and site data operations. Add the Wix MCP server to your Claude Code settings before continuing."*

### 2. Read Context

Read the functional plan, design system, and designed components:

- **Functional plan** — apps, pages, business type, brand name (from solution-architect). For forms, note the stated form purpose (contact, waitlist, lead, etc.)
- **Design system** — read `src/styles/global.css` to extract CSS custom properties (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`). Note the page color strategy (documented as a CSS comment at the top).
- **Designed components** — Props interfaces, class names (the styling contract), layout structure from each designed `.astro` component

### 3. Lifecycle Log Init

If `.wix/lifecycle.log.md` doesn't exist (standalone entry — no prior scaffolding), create it with a `# Lifecycle Log` header and `## Run` header per `shared/LIFECYCLE_LOG.md`.

Append the `### features-orchestrator` phase header with `Started` timestamp and `Skills planned` list.

### 4. Determine Skills

Map the user request or functional plan to solution skill(s) using the registry below.

## Solution Skills Registry

| Capability | Skill | Triggers |
|---|---|---|
| Products, cart, checkout | `wix-headless-stores` | stores, products, cart, checkout, e-commerce, @wix/stores, @wix/ecom |
| Contact/lead forms | `wix-headless-forms` | forms, contact form, lead form, @wix/forms |
| Blog posts, RSS | `wix-headless-blog` | blog, @wix/blog |
| CMS collections | `wix-headless-cms` | @wix/data, CMS, collections, dynamic content, portfolio, projects, work showcase, team, staff, directory, FAQ, knowledge base, resources, downloads |

---

## Delegation (middle)

Invoke solution skill(s) in order. Each skill completes its full build order — code, MCP seeding, and image generation. Only npm install and build/preview are deferred to the orchestrator.

**Pass design context to each skill:**
- Form purpose (from the functional plan)
- Design system summary: key CSS custom properties and their values
- Designed component's class names and layout (the styling contract)
- Styling contract class names for each React island component (from the `<!-- Styling contract: ... -->` comments)
- Color context: whether the section/page is dark or light

**Pass image generation context to each skill:**
- Whether the skill has image fields that need generation (always yes for stores products, blog covers, CMS collections with image fields)
- Brand context for image prompts: business type, brand name, aesthetic direction, color palette from `global.css`
- OpenAI API key status: whether `$OPENAI_API_KEY` is available or needs to be requested

1. `wix-headless-stores` (if stores)
2. `wix-headless-forms` (if forms)
3. `wix-headless-blog` (if blog)
4. `wix-headless-cms` (if @wix/data)

For single-feature requests, only one skill is invoked.

For e-commerce projects, all e-commerce pages must be wired before the first preview. Other features can be previewed incrementally.

---

## Shared Ending (always runs after)

### 1. Wire Home Page Data

If the home page references real data (featured products, latest posts), wire those queries. The home page layout already exists from design.

### 2. Verify Content via Features Log

Before proceeding to install, read `.wix/features.log.md` and verify that each invoked skill completed its work — including image generation. See `shared/FEATURES_LOG.md` for the log format.

**Verification steps:**

1. **Every invoked skill has a log entry** — if a skill has no entry, it didn't complete its work. Re-invoke the skill's seeding/image steps.
2. **Status is "complete" for all skills** — if "partial" or "failed", investigate and re-run the failing steps.
3. **Image status uses a 4-value taxonomy** (see `shared/FEATURES_LOG.md`): `generated` and `skipped` are acceptable outcomes; `not applicable` means the skill has no image fields; `not attempted` is the only failure state.
4. **If images show "not attempted"** → this is a gap. Ask the user about image generation now and follow `shared/IMAGE_GENERATION.md` to generate + attach images for the affected skill.

**Do not proceed to npm install until every invoked skill's content is verified.** A site that builds and previews with empty data is a build failure — the user sees a broken page.

> **HARD STOP — Image verification is not optional.**
> If ANY skill with image fields shows `"not attempted"` in the features log, you MUST:
> 1. Stop the flow — do not proceed to npm install
> 2. Ask the user if they want images generated (they already provided an API key if one was given during design)
> 3. Generate and attach images before continuing
> 4. Only acceptable skip states are: `"generated"`, `"skipped (user declined)"`, or `"n/a"`
>
> A site that deploys with placeholder images instead of real content is a failed delivery.

### 3. Single Batch npm Install

Collect all packages from invoked skills and run **one single install**:

| Skill | Packages |
|---|---|
| stores | `@wix/stores @wix/ecom @wix/redirects` |
| forms | `@wix/forms @wix/essentials` |
| blog | `@wix/blog @wix/ricos @astrojs/rss @astrojs/sitemap` |
| cms | `@wix/data @wix/essentials` |
| always | `@wix/sdk tailwindcss @tailwindcss/vite` |

**Before installing:** If `package-lock.json` exists from scaffolding (created with `--skip-install`), delete it before running the batch install. The stale lockfile causes resolution conflicts when adding new packages:
```bash
rm -f package-lock.json
```

```bash
npm install --no-fund --no-audit --legacy-peer-deps @wix/stores @wix/ecom @wix/redirects @wix/forms ...
```

List every SDK package needed for the invoked skills. Always include `--no-fund --no-audit` to prevent interactive prompts that hang in agent sessions.

Always include `--legacy-peer-deps` — Wix SDK packages have frequent transitive peer dependency conflicts (e.g., `@react-aria/*` version mismatches) that block installation without this flag.

**If npm install hangs** (common in agent-driven sessions):
1. Run `npm install --no-fund --no-audit --legacy-peer-deps <packages>` with a **90-second timeout**.
2. If it hangs, kill and retry: `npm install --prefer-offline --no-fund --no-audit --legacy-peer-deps <packages>`
3. If still hanging: `npm cache clean --force && npm install --no-fund --no-audit --legacy-peer-deps <packages>`
4. If all retries fail, tell the user: *"npm install is hanging. Please run `npm install` manually in your terminal, then let me know when it's done."*

### 4. Log Verification to Lifecycle

Append `### verification` and `### build` entries to `.wix/lifecycle.log.md` as each step completes. After the final preview/release, append `### summary` with totals per `shared/LIFECYCLE_LOG.md`.

### 5. Build & Run Preview

> **Build is required before preview** — preview uploads the build output; without a build it fails with "Project build output is missing."

```bash
npx @wix/cli build
npx @wix/cli preview
```

Extract the preview URL from the output and present it prominently to the user — this is their live headless site. The first full flow should always end with a running site the user can visit.

---

## How Features Modifies Designed Components

Features **respects the design**. When SDK constraints require visual changes, features adjusts while staying within the design system:

1. **Replace placeholder data** — Swap `sampleProducts` arrays with real SDK queries
2. **Convert to React islands** — Components needing client-side state (cart, forms) get converted from `.astro` to `.tsx` while preserving the visual design
3. **Add loading/error states** — Within the design system's tokens (colors, radii, fonts)
4. **Add interactive behavior** — Click handlers, form submission, cart updates
5. **Adjust for data shapes** — If SDK returns data differently than the placeholder assumed, adjust prop mapping (not the visual design)
6. **Preserve form styling contracts** — When converting a designed form placeholder to a React island, keep the same class names so the page's `<style>` block continues to apply. Do not rename or restructure classes.
7. **Use CSS custom properties exclusively** — React islands must use `var(--color-*)`, `var(--font-*)`, etc. for all visual properties. Never use hardcoded Tailwind color utilities (`bg-green-50`, `text-red-600`, `bg-neutral-800`) in React islands — these bypass the design system.
8. **Feature skills do not write CSS.** All visual styling comes from the designed components. React islands use the styling contract class names from the designed component's `<style is:global>` block. If a feature needs a visual state the design didn't anticipate, it uses CSS variables from the design system — never raw Tailwind classes or hardcoded colors.

---

## Deploying Features

After completing a feature:

> **E-commerce projects:** Do not run `npx @wix/cli preview` or `npx @wix/cli release` until the full ecommerce flow is complete (products listing, product detail, cart, checkout, thank-you page). The Stores app installs 12 sample products — partial deploys show a broken site with no way to browse or purchase them.

```bash
# Build and preview
npx @wix/cli build
npx @wix/cli preview

# When ready for production
npx @wix/cli build
npx @wix/cli release
```

> **After deploying:** Extract the site URL from the command output and present it to the user — this is their headless site URL. If the URL is not in the output, direct them to the Wix dashboard > Settings > Domains.

> **Going live with payments?** If the project uses Wix Stores, a Wix premium plan and payment methods must be configured before checkout works. See `wix-headless-cli/references/GOING_LIVE.md` for the full checklist.

---

## Non-Matching Intents

| User Wants | Redirect To |
|-----------|------------|
| Build, validate, and deploy a preview after changes | `wix-headless-cli` |
| Build a new site from scratch (no project exists) | `wix-headless-solution-architect` |
| Design or restyle the site / change brand & style | `wix-headless-designer` |
| Scaffold or configure project | `wix-headless-cli` |
