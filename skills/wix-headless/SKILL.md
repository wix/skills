---
name: wix-headless
description: "Connect Wix business services (Stores, Bookings, CMS, Blog, Events, Forms, and more) to a Wix Headless frontend — infer the needed capabilities, install the apps, seed backend content, and produce an SDK-integration guide. For managed (Wix-hosted) projects it can also build the frontend: scaffold a new site (create) or wire an existing/brought-in design (connect), then build and release. Works across managed, self-managed, and stripe project types. Triggers: set up a Wix Headless backend, add Wix business features to my app, build or host a Wix site, connect/implement this design with Wix."
allowed-tools:
  - Bash(curl *)
  - Bash(npx @wix/cli@latest *)
  - Bash(npx @wix/cli *)
  - Bash(npm create @wix/new@latest *)
  - Bash(npm install *)
  - Bash(npm run *)
  - Bash(node *)
  - Bash(bash *)
  - Bash(cd *)
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cp *)
  - Bash(mv *)
  - Bash(uuidgen)
  - Read
  - Write
  - Edit
---

# Wix Headless

This skill connects **Wix business services** to a **Wix Headless frontend**. Its core job is to **configure the Wix backend**: infer the needed capabilities, **install the Wix apps**, **seed the backend content**, and produce an SDK-integration guide describing how to call Wix from the frontend.

What happens with the frontend depends on the project type and operation:
- **Backend-only** (self-managed, stripe, or a managed "just set up the backend" run) — the skill **emits the SDK guide** as its final output; the **host owns** the frontend, build, and hosting.
- **Managed create / connect** — the skill **also owns the frontend**: it scaffolds a new project (create) or attaches Wix to an existing one (connect), wires it to the backend using that same guide, builds, and releases to Wix. (There is no Designer or template library — the frontend is built ad-hoc to intent.)

> **On a backend-only run the skill does not own the project scaffolding.** When the work needs a frontend, **scaffold it according to user intent** — framework and structure follow the prompt; the skill's job is the Wix backend plus the **emitted SDK guide** describing how to call Wix from whatever frontend exists, not choosing or generating the app. This is the norm for a **stripe** run: the project is provisioned via Stripe Projects (credentials land in `.env` — see `stripe/AUTHENTICATION.md`), the skill configures the backend and emits the guide, and the live site is finalized per `stripe/DEPLOYMENT.md` — while the frontend is scaffolded and wired to intent, by the host.

## Project types

The skill behaves identically across project types **except for authentication and deployment**, which are isolated in a per-type folder under `references/`:

| Project type | Hosting | Authentication & deployment live in |
|---|---|---|
| `managed` | Wix infrastructure (maintained by Wix) | `references/managed/` |
| `self-managed` | the user's own host (TBD) | `references/self-managed/` |
| `stripe` | the user's own host, provisioned via Stripe Projects | `references/stripe/` |

Everything else — Discovery, Setup, Seed, the SDK handoff — is **project-type-agnostic** and refers to "the provided authentication mechanism" rather than any specific method.

### Resolving the project type

Resolve the type **before Discovery**, in this order — stop at the first that decides:

1. **Caller-provided.** If the host/caller passed a project type (`managed` | `self-managed` | `stripe`), use it. An explicit value always wins.
2. **Detect from project signals (on disk).** Check the working directory (read-only):
   - **`stripe`** — `.env` carries `WIX_WIX_CLIENT_ID` / `WIX_WIX_CLIENT_SECRET` / `WIX_WIX_METASITE_ID` (or the plain `WIX_*` fallback). This is the Stripe-Projects fingerprint.
   - **`managed`** — a Wix CLI project: `wix.config.json` present, or a `.wix/` directory, or `@wix/cli` / `@wix/astro` in `package.json`.
   - **`self-managed`** — a frontend project on disk (e.g. `package.json` with a bundler/framework) with **neither** the Stripe `.env` fingerprint **nor** the Wix-CLI markers above.
3. **Detect from user intent.** If disk is inconclusive, read the prompt:
   - **`managed`** — "managed", "host on Wix", "Wix-hosted", "deploy to Wix", "`wix release`".
   - **`stripe`** — "stripe projects", "I added Wix via Stripe", a Stripe-Projects context.
   - **`self-managed`** — "self-hosted", "my own host", names a non-Wix host, "I'll deploy it myself".
4. **Ask.** If signals are absent or conflict, **ask the user** which type applies — don't guess.

Hold the resolved type in scratch; it selects `<TYPE_DIR>` (see Path resolution). Note `self-managed` is **TBD** — once resolved to it, the auth step will stop with a clear "not wired yet" error.

### Resolving the operation (managed only)

create/connect/iterate are **managed-only**. For `managed`, resolve the operation **by intent first, directory second** — never let an empty directory override what the user is asking for. Check `iterate` first (it's decided by an unambiguous on-disk signal):

- **`iterate`** → `references/managed/CONNECT.md`. The project is **already connected to Wix** — a `wix.config.json` (or `.wix/`) is already present — and the owner wants to add or change capabilities. Same flow as `connect`, but §1 **skips `init`** and reuses the existing `wix.config.json`; **never re-`init` an already-connected project**.
- **`connect`** → `references/managed/CONNECT.md`. The user **brings a design not yet connected to Wix and wants it wired**: a frontend project on disk **without** a `wix.config.json`, **or** a brought-in/fetched design (a `.zip`/folder/file you unzip or read, a design-file URL, a Claude-Design/v0/Lovable export), **or** language like "connect this / implement this design (… connecting to Wix) / host this on Wix / deploy this to Wix / add Wix Headless to this project". **A brought-in or fetched design is `connect` even when the current directory is empty** — the design arrives from elsewhere (zip/fetch/URL), so emptiness at trigger time is *not* a create signal. (`CONNECT.md` step 1 places the brought design into CWD, then `init`s it.)
- **`create`** → `references/managed/CREATE.md`. The user wants a **new site built from a prompt with nothing brought in** — "build me a site / store / blog…", no design file, no project on disk.
- **`backend-only`** — the user only wants the backend configured (no frontend work). → the shared spine + emit the SDK handoff.

For `self-managed` and `stripe`, the operation is always **backend-only** (the host owns the frontend). Only when there is **genuinely no brought-in design and no connect language** does directory emptiness decide: empty → `create`; an existing frontend on disk → `connect`.

## Preconditions (the host provides these — we read, never create)

1. **The project type** — `managed` | `self-managed` | `stripe` — provided by the caller, else **detected from project signals / user intent** (see Project types § "Resolving the project type"), else asked. It selects `<TYPE_DIR>` (see Path resolution).
2. **A Wix metasite + a headless OAuth app exist, and credentials are available** — obtained via the project type's `AUTHENTICATION.md`. The skill needs a bearer token authorized for the metasite and the metasite id.
3. **The user intent** — free text describing what Wix should power ("add a store", "blog + contact form", "persist my app's data").
4. *(Optional)* the project on disk — read-only, to sharpen brand/capability inference.

If the credentials are absent, the Wix backend isn't reachable — **stop with a clear error**.

## What this skill does

**Always open `DISCOVERY.md` first** (it's agnostic — capability/brand/intent inference + the imagery gate, no auth). Then route by project type + operation:

**Backend-only** (self-managed, stripe, or managed backend-only) — the lean spine:
1. **Discovery** (`references/DISCOVERY.md`) — infer capabilities + brand + intent + imagery.
2. **Setup** (`references/SETUP.md`) — **install** the Wix apps those capabilities need.
3. **Seed** (`references/SEED.md`) — **create** the backend content (+ entity images if imagery is on).
4. **Handoff** (`references/SDK_HANDOFF.md`) — after Setup and Seed, **emit** the integration guide: SDK bootstrap, per-capability call shapes, the **seeded IDs**, and the `@wix/*` package list.
5. **Finalize deployment** (`<TYPE_DIR>/DEPLOYMENT.md`) — run the project-type's finalize steps.

**Throughout any run** — if the user asks to send feedback to Wix, complains/gets frustrated, or the run hits substantial friction (repeated API/doc/tooling failures), you may **offer** to relay it to Wix per `references/FEEDBACK.md`. Send only after an explicit yes — never automatically.

**Managed create / connect / iterate** — after Discovery, hand the whole run to the managed flow:
- **create** → **`references/managed/CREATE.md`** (scaffold → Setup → Seed → build the frontend → release).
- **connect** → **`references/managed/CONNECT.md`** (init → Setup → Seed → wire the existing UI → release).
- **iterate** → **`references/managed/CONNECT.md`** — the project is already connected, so it reuses the existing `wix.config.json` (no `init`). Setup / Seed / wiring are **incremental**: it may already be set up and seeded from a prior run, so the agent **checks current state first** (installed apps, already-seeded content, existing wiring) and applies only the delta the new intent needs — never blindly re-installing or re-seeding. Re-release only if the frontend build output changed.
  These reuse the same `SETUP.md`/`SEED.md`/`SDK_HANDOFF.md`, but **apply** the SDK guide to build/wire the frontend themselves rather than emitting it, and release via `managed/DEPLOYMENT.md`.

Each Wix call uses the universal call shape (`SETUP.md` §1) with `$TOKEN`/`$SITE_ID` obtained per `<TYPE_DIR>/AUTHENTICATION.md`. The skill runs non-interactively except for the one imagery question (and asking the project type if it can't be resolved).

> **Don't smoke-test the frontend locally unless the user asks to verify.** The deliverable is the built-and-released site (managed) or the SDK guide (backend-only) — not a local test report. By **default do not** start a dev server (`wix dev` / `astro dev` / `npm run dev`) to curl pages, drive the cart / booking / login flow, or launch a headless browser: correctness comes from following the recipes, real errors surface at `wix build` / `wix release`, and a headless run can't complete an interactive login or a real payment anyway — so these loops routinely burn minutes of wall for little signal (this is distinct from, and in addition to, the "release once at the very end" rule — that one only bans extra *build+release* cycles, not dev-server testing). **Only** spin up a dev server and smoke-test when the user's prompt **explicitly asks to verify / test / confirm it works** — and then keep it to a single lightweight pass (pages compile and render), not a full purchase/booking/login drive. The one post-release check in `<TYPE_DIR>/DEPLOYMENT.md` is the sanctioned verification.

## Path resolution

Compute `<SKILL_ROOT>` from this file (`<SKILL_ROOT>/SKILL.md` — strip `/SKILL.md`); hold the absolute path in scratch. Then resolve the project type to its folder and hold it too:

> **`<TYPE_DIR>` = `<SKILL_ROOT>/references/<projectType>/`** — one of `managed/`, `self-managed/`, `stripe/`.

| What | Path |
|---|---|
| Vertical index (intent matching + per-vertical site spec) | `<SKILL_ROOT>/references/CAPABILITIES.md` |
| Discovery (infer capabilities + brand + intent) | `<SKILL_ROOT>/references/DISCOVERY.md` |
| Setup (install apps) | `<SKILL_ROOT>/references/SETUP.md` |
| Seed (create backend content) | `<SKILL_ROOT>/references/SEED.md` |
| SDK-integration handoff (emitted, or applied by create/connect) | `<SKILL_ROOT>/references/SDK_HANDOFF.md` |
| Image generation (opt-in; agnostic) | `<SKILL_ROOT>/references/IMAGE_GENERATION.md` |
| Feedback — relay the user's headless-experience feedback to Wix (opt-in; user-approved) | `<SKILL_ROOT>/references/FEEDBACK.md` |
| **Authentication** — obtain `$TOKEN`/`$SITE_ID`/`clientId` (project-type-specific) | `<TYPE_DIR>/AUTHENTICATION.md` |
| **Deployment** — finalize the live site (project-type-specific) | `<TYPE_DIR>/DEPLOYMENT.md` |
| Managed **create** flow (scaffold a new project) | `<SKILL_ROOT>/references/managed/CREATE.md` |
| Managed **connect** flow (wire an existing project) | `<SKILL_ROOT>/references/managed/CONNECT.md` |
| Frontend-axis references (how a frontend wires to Wix) | `<SKILL_ROOT>/references/astro.md`, `non-astro.md` |

**Start a run by opening `DISCOVERY.md`.** The flow files (`CAPABILITIES`, `DISCOVERY`, `SETUP`, `SEED`, `SDK_HANDOFF`, `IMAGE_GENERATION`) are project-type-agnostic; the per-type specifics live under `<TYPE_DIR>/` (`AUTHENTICATION.md`, `DEPLOYMENT.md`, and — managed only — `CREATE.md`/`CONNECT.md`).

## Where the *how* comes from

This skill has **no skill upstream** — the *how* is read from the **live Wix docs** at `dev.wix.com/docs`. **Read-priority: a page this skill links is read by `curl`-ing its `.md` twin directly (first priority — don't re-discover a curated link with search); the Wix MCP doc/search tools are second priority, for finding pages the skill doesn't link or as a fallback if a fetch fails.** (Append `.md` to any docs URL for raw markdown; menu pages list child links, content pages carry the schema.)

**Doc discovery is the shared fallback for both tracks — never the first move.** Each track's *primary* source is its pinned material (below); when that doesn't cover what you need, fall back to `references/DOC_DISCOVERY.md` — a semantic doc-search + schema lookup that works with or without the Wix MCP.

- **Seed** reads each capability's create flow from its **inline recipe** — a **self-contained local `inline-recipes/setup-*.md`** (mapped per capability in `SEED.md` § "What to seed per capability") that inlines the calls and **supersedes** the REST doc pages, so read it and seed from it alone. Only a capability with **no** inline recipe (e.g. `coupons`) falls back to doc discovery (`DOC_DISCOVERY.md`).
- **Handoff** links the **SDK docs** for each capability's API shape, and supplies the runtime package set from the inlined map in `SDK_HANDOFF.md` (the SDK `.md` pages don't expose `@wix/*` import strings to navigation, so packages are mapped, not navigated).

Setup carries its app-install call (and the appDefId constants) inline in `SETUP.md`; `CAPABILITIES.md` is the vertical index that lets Discovery match intent **and** declares, per built vertical, the *Required site features* + *Implementation checklist* that Seed enables (backend-backed features) and the Handoff carries into the guide (so the host builds a complete site, not a bare data dump). This skill carries the *what* (which capabilities, how much content, what a finished site includes) and reads the *how* off the docs.
