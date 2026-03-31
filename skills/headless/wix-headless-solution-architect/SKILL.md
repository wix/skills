---
name: wix-headless-solution-architect
description: "The starting point for ANY new website or site — use this skill whenever the user wants to build, design, or create a new site from scratch, even if the request emphasizes visual style or design direction (e.g., 'brutalist dark site', 'minimal portfolio with neon accents'). This skill handles discovery and planning first; visual design is handled later in the workflow. Triggers: build me a site, design a site, create a website, make me a website, new website, I need a site, I want a site, start a project, create a site, business website, online store, portfolio, landing page, build a dark site, design a new site, I want a website, site for my business."
---

# Wix Headless Solution Architect — Functional Requirements & Project Planning

Guides users from business idea to a functional plan. Asks business questions, determines which Wix apps to install, plans the page set, and hands off to CLI for scaffolding, designer for visual identity, and features for SDK implementation.

## When This Skill Triggers

This skill activates when a user describes what they want to build rather than asking for a specific technical action:

| Trigger | Example |
|---------|---------|
| New site request | "Build me a skincare brand website" |
| Business description | "I run a yoga studio and need a website" |
| Vague starting point | "I want to sell things online" |
| Feature-rich request | "I need a site with a blog and store" |

## When NOT to Use This Skill

| Scenario | Use Instead |
|----------|------------|
| User already has a scaffolded project | `wix-headless-features-orchestrator` for adding features |
| User asks to scaffold with specific template | `wix-headless-cli` |
| User asks about brand, style, or visual design | `wix-headless-designer` |

---

## Preconditions (All Blocking)

Before starting the discovery flow, verify **all three** prerequisites. Run all checks upfront. **All three must pass** — if any check fails, stop and tell the user what to fix. Do not proceed with discovery until all checks pass.

### 1. Wix CLI Authentication

```bash
npx @wix/cli whoami
```

If this fails → tell the user to run `npx @wix/cli login` first (manual step, opens browser).

### 2. Node.js Version

```bash
node --version
```

Verify v20.11.0 or higher. If not → tell the user to upgrade Node.js.

### 3. Wix MCP Connection

Call `mcp__wix-mcp-remote__WixREADME` to verify the MCP server is connected and responding.

If the call fails or the tool is not available → tell the user:
> *"Wix MCP is not connected. Restart Claude Code to activate it (auto-configured by the plugin)."*

---

## Discovery Flow

### Interaction Rules

Follow these rules throughout discovery:

- **One question per step** — ask one thing, wait for the answer, then move on
- **Use `AskUserQuestion` for Steps 1–4** — use the interactive questionnaire for discovery questions
- **Step 5** — present the plan as markdown, then use `AskUserQuestion` for approval
- **Don't infer — ask** — let the user tell you what they need instead of guessing from context
- **Skip what's explicitly answered** — if the user volunteers information ahead of a step, don't re-ask it
- **Keep it conversational** — each step should feel like a natural follow-up, not a form

### Step 1: What's Your Business?

Use `AskUserQuestion` with a single-select question. Include common business categories plus a free-text option:

> "What kind of business is this for?"

Options: Online store / ecommerce, Services & appointments, Restaurant / food & drink, Creative portfolio (art, photography, design), Blog or content site, Something else (let me describe it)

If the user picks "Something else", follow up with `AskUserQuestion` using a text input asking them to describe their business.

Wait for the answer. Record the business type. Do NOT infer capabilities or pages yet.

### Step 2: What Does Your Site Need?

Use `AskUserQuestion` with a single multi-select question:

> "What does your site need to do?"

| Option label | Maps to |
|---|---|
| Sell products online | `stores` app |
| Collect info via forms (contact, signup, waitlist) | `forms` app |
| Publish blog posts or articles | `blog` app / `@wix/blog` |

**Do NOT recommend `@wix/data` for product data** — `@wix/stores` handles that via its own product catalog.

### Step 3: Which Pages?

Use `AskUserQuestion` with a single multi-select question. Generate **3–4 content page suggestions** based on the business type from Step 1. These are static/content pages only — app-driven pages (products, cart, blog, services, contact form, account) are added automatically in Step 5.

> "Which pages do you want on your site?"

Rules:
- Always include **Home** as a pre-selected default
- Generate 3–4 additional page suggestions relevant to the business type
- Do NOT include pages that are handled by apps selected in Step 2 (products, blog, services, contact form, account)

Example suggestions by business type:

| Business Type | Suggested Pages |
|---|---|
| Online store / ecommerce | Home, About, FAQ, Shipping & Returns |
| Services & appointments | Home, About, Pricing, Team |
| Restaurant / food & drink | Home, About, Menu, Location |
| Creative portfolio | Home, Work, Process, Testimonials |
| Blog or content site | Home, About, Archive, Resources |
| General / other | Home, About, FAQ |

### Step 3b: Static or CMS-Managed?

After the user selects their pages, evaluate each selected content page.
For any page that could contain structured, repeating, or frequently
updated content (e.g., a list of people, a set of Q&As, a menu of items,
testimonials, project showcases), ask the user whether it should be
CMS-managed or static.

Use `AskUserQuestion` with a single multi-select question listing only
the pages that qualify as potentially dynamic:

> "Some of your pages could be powered by Wix CMS, so you can update
> content from the dashboard without touching code. Which pages should
> be CMS-managed?"

Each option should be a page name with a brief description of what
CMS would enable:
- e.g., "FAQ — manage questions & answers from the dashboard"
- e.g., "Team — add/edit team members from the dashboard"
- e.g., "Menu — update dishes, prices, and categories from the dashboard"

Pages NOT selected here will be implemented as static Astro pages
with content hardcoded in the template.

If no selected pages qualify as potentially dynamic (e.g., the user
only selected Home and About), skip this step entirely.

When any page is marked as CMS-managed, include `@wix/data` and
`@wix/essentials` in the functional plan, and add a CMS Collections
section listing each collection with its key fields. The field schema
for each collection should be inferred from the page purpose
(e.g., a Team page needs name, role, bio, photo fields).

### Step 4: Brand Name

Use `AskUserQuestion` with a single-select question. Generate **3–4 creative brand name suggestions** based on the business type from Step 1, plus a "Type my own" option:

> "What should we call your brand?"

Options: [3–4 generated names relevant to the business], Type my own

Name generation guidelines:
- Keep names short (1–3 words), memorable, and relevant to the business type
- Mix styles: one punchy/modern, one descriptive, one abstract/evocative
- Avoid generic names — make each option feel like a real brand

If the user picks "Type my own", follow up in natural conversation asking them to type their brand name.

If the user already mentioned a brand name in Step 1, skip this step.

### Step 5: Present the Functional Plan

Present the plan as formatted markdown text. After presenting, use `AskUserQuestion` to ask for approval.

This is a **functional** plan — no colors, fonts, or style decisions here. Those are handled by later skills.

The plan has three sections (four when CMS-managed pages exist):

**Section A: Apps & SDK Packages** — A table listing each app and the SDK packages it brings. When CMS-managed pages exist, add a `CMS (built-in)` row with `@wix/data`, `@wix/essentials`:

| App | SDK Packages |
|-----|-------------|
| Wix Stores | `@wix/stores`, `@wix/ecom`, `@wix/redirects` |
| Wix Forms | `@wix/forms` |
| CMS (built-in) | `@wix/data`, `@wix/essentials` |

**Section B: CMS Collections** (only when CMS-managed pages exist) — List each collection with its key fields, inferred from the page purpose:

| Collection | Key Fields |
|------------|-----------|
| Team Members | name, role, bio, photo |
| FAQ | question, answer, sortOrder |

**Section C: Pages** — The full page list with routes. Include both user-selected pages and automatic pages implied by the apps. Mark CMS-managed pages with source "CMS" instead of "Your selection":

- `stores` → automatically adds: `/products`, `/products/[slug]`, `/cart`, `/thank-you` + Checkout (hosted by Wix)
- `@wix/blog` (Wix Blog) → automatically adds: `/blog`, `/blog/[slug]`
- `forms` → automatically adds: `/contact` (if not already in user-selected pages)

List every page with its route. Mark automatic pages so the user understands what comes "for free" with each app.

**Section D: Features** — 1–2 line descriptions of user-facing functionality for each capability. Explain what the user's customers will be able to do.

#### Example (ecommerce skincare brand with stores + forms)

```
Here's my plan for your website:

## Apps & SDK Packages

| App          | SDK Packages                               |
|--------------|-------------------------------------------|
| Wix Stores   | @wix/stores, @wix/ecom, @wix/redirects   |
| Wix Forms    | @wix/forms                                 |

## Pages (8 total)

| Page               | Route               | Source          |
|--------------------|---------------------|-----------------|
| Home               | /                   | Your selection   |
| About              | /about              | Your selection   |
| Products           | /products           | Stores (auto)    |
| Product Detail     | /products/[slug]    | Stores (auto)    |
| Cart               | /cart               | Stores (auto)    |
| Thank You          | /thank-you          | Stores (auto)    |
| Checkout           | Hosted by Wix       | Stores (auto)    |
| Contact            | /contact            | Forms (auto)     |

## Features

- **Product catalog** — Browse all products with images, prices, and
  variants. Click through to detailed product pages.
- **Cart & checkout** — Add items to cart, review order, and check out
  via Wix's secure hosted checkout. Order confirmation on thank-you page.
- **Contact form** — Visitors can reach you through a styled contact form.
  Submissions are collected in your Wix dashboard.

Should I proceed?
```

#### Example (restaurant with forms + CMS-managed pages)

```
Here's my plan for your website:

## Apps & SDK Packages

| App              | SDK Packages                               |
|------------------|--------------------------------------------|
| Wix Forms        | @wix/forms                                 |
| CMS (built-in)   | @wix/data, @wix/essentials                 |

## CMS Collections

| Collection   | Key Fields                                      |
|--------------|-------------------------------------------------|
| Menu Items   | name, description, price, category, photo       |
| Team Members | name, role, bio, photo                           |
| FAQ          | question, answer, sortOrder                      |

## Pages (8 total)

| Page               | Route               | Source            |
|--------------------|---------------------|-------------------|
| Home               | /                   | Your selection     |
| About              | /about              | Your selection     |
| Menu               | /menu               | CMS                |
| Team               | /team               | CMS                |
| FAQ                | /faq                | CMS                |
| Contact            | /contact            | Forms (auto)       |

## Features

- **Menu** — Browse dishes organized by category with photos, descriptions,
  and prices. Manage everything from the Wix dashboard.
- **Team** — Meet the team behind the restaurant. Add or update members
  from the dashboard.
- **FAQ** — Common questions and answers, editable from the dashboard.
- **Contact form** — Visitors can reach you with questions or feedback.

Should I proceed?
```

### Step 6: Handoff

After user approval, invoke the following skills in sequence — do not pause between them:

1. **Scaffold** → `Skill: wix-headless:wix-headless-cli`
   Pass the brand name, project name (derived from brand: lowercase alphanumeric only, 3–20 chars), and the apps list from the functional plan.

2. **Design** → `Skill: wix-headless:wix-headless-designer`
   Pass the functional plan (apps, pages, capabilities, business type, brand name).

3. **Implement** → `Skill: wix-headless:wix-headless-features-orchestrator`
   Design will hand off automatically. The features orchestrator delegates to the appropriate solution skills based on the functional plan.
   ⚠️ Do NOT invoke individual feature skills (forms, cms, stores, blog) directly.

**The flow always ends with a running site.** After all features are built, run `npx @wix/cli preview` and present the preview URL to the user.

---

## App Selection Logic

See `references/CAPABILITY_MAP.md` for the complete mapping.

> **Important:** Blog functionality uses the **Wix Blog app** with `@wix/blog` — do NOT use `@wix/data` for blog posts. `@wix/data` is ONLY for custom CMS collections or editorial content that is NOT blog posts. Do NOT include `@wix/data` for ecommerce sites — `@wix/stores` already provides its own product catalog API. Include `@wix/data` when content pages are marked as CMS-managed in Step 3b. Do NOT use `@wix/data` for blog posts (use `@wix/blog`), product data (use `@wix/stores`), or form submissions (use `@wix/forms`).

**Quick reference:**

| Business Need | Wix App | `--apps` value | SDK Package |
|---------------|---------|----------------|-------------|
| Sell products | Wix Stores | `stores` | `@wix/stores`, `@wix/ecom`, `@wix/redirects` |
| Collect form data (contact, signup, waitlist) | Wix Forms | `forms` | `@wix/forms` |
| Blog posts and articles | Wix Blog | `blog` | `@wix/blog` |
| Custom CMS content (NOT product data, NOT blog) | None (built-in CMS) | — | `@wix/data`, `@wix/essentials` (included when content pages are CMS-managed in Step 3b) |
| Static pages (about, landing) | None | — | None |

---

## Non-Matching Intents

| User Wants | Redirect To |
|-----------|------------|
| Add a feature to existing project | `wix-headless-features-orchestrator` |
| Scaffold with specific template | `wix-headless-cli` |
| Design my site / change the look / brand & style | `wix-headless-designer` |
| Add a blog to existing project | `wix-headless-features-orchestrator` |
