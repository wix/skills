---
name: sp-wix
description: "Connect Wix business services (Stores, Blog, CMS, Forms, Events, Bookings, Pricing Plans) to a Stripe Projects app. Use AFTER `stripe projects add wix/*` has provisioned a Wix metasite + synced its credentials to `.env`. Given the metasite and the user's intent, this skill runs the Wix business flow — infers which Wix capabilities the app needs, installs the apps, seeds backend content — then returns an SDK-integration guide (how to call Wix from the frontend) for the host agent to use. The host keeps ownership of the frontend, the build, and the hosting. Triggers: set up Wix in this Stripe project, add a Wix store/blog/CMS/forms/events/bookings/pricing-plans backend, connect Wix Headless to my Stripe app, provision Wix content for this project, I added wix with stripe projects now wire it up. NOT for: building a new Wix-hosted site from scratch (use wix-headless), or anything outside a Stripe Projects app."
allowed-tools:
  - Bash(curl *)
  - Read
  - Write
---

# Wix Headless × Stripe Projects

This skill connects **Wix business services** to an app managed by [Stripe Projects](https://docs.stripe.com/projects). The host agent (Claude Code / Cursor / an MCP agent, driven by Stripe's flow) owns the conversation, the frontend, the build, and the hosting.

**This skill's job is to configure the Wix backend**: infer the needed capabilities, **install the Wix apps**, **seed the backend content**, return an integration guide describing how to call Wix from the frontend, and — once the site is deployed — **register the deployed origin on the OAuth app** so the frontend is actually allowed to call Wix. The configured backend is the work; the guide just describes it. A run is complete only when **Setup and Seed have run**, the guide has been emitted, and the deployed origin has been registered (or, if deployment is out of this flow, the user has been told it's required).

## Preconditions (the host provides these — we read, never create)

1. **A Stripe Project with Wix connected** — `stripe projects add wix/*` has run, provisioning a metasite + a headless OAuth app and syncing credentials to `.env`: `WIX_WIX_CLIENT_ID`, `WIX_WIX_CLIENT_SECRET`, `WIX_WIX_METASITE_ID` (see `references/AUTHENTICATION.md`).
2. **The user intent** — free text describing what Wix should power ("add a store", "blog + contact form", "persist my app's data").
3. *(Optional)* the project on disk — read-only, to sharpen brand/capability inference.

If the Wix credentials are absent, Wix isn't connected in this project — **stop with a clear error**.

## What this skill does

When invoked, **run these four steps in order, start to finish.** Steps 1–3 are the skill's actual work — they execute against the metasite over `curl`; step 4 reports the result. Open `DISCOVERY.md` and begin.

1. **Discovery** (`references/DISCOVERY.md`) — infer the capability set + brand + per-capability intent from the user's words, then drive straight into Setup.
2. **Setup** (`references/SETUP.md`) — **install** the Wix apps those capabilities need on the metasite.
3. **Seed** (`references/SEED.md`) — **create** the backend content for each capability (products, posts, collections + items, forms).
4. **Handoff** (`references/SDK_HANDOFF.md`) — **only after Setup and Seed have run**, return the integration guide: the SDK bootstrap, per-capability call shapes, the **seeded IDs** (which exist only because Seed ran), and the `@wix/*` package list.
5. **Finalize deployment** (`references/DEPLOYMENT_CHECKLIST.md`) — **after the site is deployed**, run the two one-time backend steps: **publish the metasite** (always), and **register the deployed origin** on the OAuth app (the admin call `init` normally does for hosted sites; once per URL, skip if already registered). If deployment isn't part of this flow, **flag to the user** that the origin step is required before the frontend can call Wix.

Steps 1–4 run in one pass; step 5 happens once the deployed URL exists (the skill performs it if it sees the deploy, otherwise flags the user). The guide in step 4 describes the backend that Setup and Seed built. Each Wix call uses a token minted from `.env` (`references/AUTHENTICATION.md`). The skill runs non-interactively, inferring from the user's words rather than asking.

## Path resolution

Compute `<SKILL_ROOT>` from this file (`<SKILL_ROOT>/SKILL.md` — strip `/SKILL.md`); hold the absolute path in scratch.

| What | Path |
|---|---|
| Authentication (token mint + REST contract + ladder) | `<SKILL_ROOT>/references/AUTHENTICATION.md` |
| Vertical index (intent matching + per-vertical site spec) | `<SKILL_ROOT>/references/CAPABILITIES.md` |
| Discovery (infer capabilities + brand + intent) | `<SKILL_ROOT>/references/DISCOVERY.md` |
| Setup (install apps) | `<SKILL_ROOT>/references/SETUP.md` |
| Seed (create backend content) | `<SKILL_ROOT>/references/SEED.md` |
| SDK-integration handoff (the returned document) | `<SKILL_ROOT>/references/SDK_HANDOFF.md` |
| Finalize deployment — publish the site + register the deployed origin (post-deploy) | `<SKILL_ROOT>/references/DEPLOYMENT_CHECKLIST.md` |

**Start a run by opening `DISCOVERY.md`.**

## Where the *how* comes from

This skill has **no skill upstream** — the *how* is read from the **live Wix docs** at `dev.wix.com/docs`, fetched as raw markdown via `curl` (append `.md` to any docs URL; menu pages list child links, content pages carry the schema):

- **Seed** reads the **REST docs** for each capability's create method — navigated from the Business Solutions index (`api-reference/business-solutions.md`) per the mechanism in `SEED.md` (Forms lives under `api-reference/crm/forms.md`).
- **Handoff** links the **SDK docs** for each capability's API shape, and supplies the runtime package set from the inlined map in `SDK_HANDOFF.md` (the SDK `.md` pages don't expose `@wix/*` import strings to navigation, so packages are mapped, not navigated).

Setup carries its app-install call (and the appDefId constants) inline in `SETUP.md`; `CAPABILITIES.md` is the vertical index that lets Discovery match intent **and** declares, per built vertical, the *Required site features* + *Implementation checklist* that Seed enables (backend-backed features) and the Handoff carries into the guide (so the host builds a complete site, not a bare data dump). This skill carries the *what* (which capabilities, how much content, what a finished site includes) and reads the *how* off the docs.
