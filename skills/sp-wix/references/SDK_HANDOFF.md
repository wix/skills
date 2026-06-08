# SDK-integration handoff

**This is the last step — reach it only after Setup and Seed have run.** The guide below is filled from the `seeded` map (created IDs), which exists only because Seed executed; if you're here without having installed the apps and seeded content, go back and do that first. The guide *describes* the backend the earlier steps built.

The skill **returns this document** describing how to call Wix from the frontend, then **exits**. The host agent — which owns the frontend, the framework, and the build — does the wiring. We describe what to use and **link to the live Wix SDK docs for the API shapes**; the host decides where they go.

> **Link to the docs; do not inline API examples.** The Wix SDK docs are versioned and complete; hand-written snippets under-specify the hard parts (rich-content rendering, package versions, types) and lead the host to build against a wrong or stale shape. The handoff's job is to point at the *right* doc page and supply the three things the docs can't know: the **seeded IDs**, the **`clientId` source**, and the **package set**. Let the host read the current API from the docs.
>
> **The linked docs are the source of truth for current API shapes and versions — read them for the integration. Existing code (in this or any other project) is not a substitute: it may target a different SDK version and silently mislead.**

Emit the document as the skill's final message (a Markdown block the host can act on or save). Fill it from the run's `verticals[]`, the `seeded` map, and `WIX_WIX_CLIENT_ID`. Include **only** the loaded capabilities.

## What the document contains

### 1 · Packages to install
The union of the loaded capabilities' SDK packages (`references/CAPABILITIES.md`) plus the always-on `@wix/sdk` — **runtime packages only** (no scaffold/build deps). For install details and current versions, link: <https://dev.wix.com/docs/sdk/articles/work-with-the-sdk/install-sdk-packages.md>.

### 2 · Client setup (and the clientId source)
The frontend authenticates as an **anonymous visitor** via `OAuthStrategy`, with `clientId` = the **`WIX_WIX_CLIENT_ID`** value. The `clientId` is **not secret** (it's the public OAuth id) — the host exposes it to client code via its framework's public-env convention (`NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, …). The **`client_secret` never reaches the frontend.** For the current `createClient` + auth-strategy shape, link:
- <https://dev.wix.com/docs/sdk/articles/set-up-a-client.md>
- <https://dev.wix.com/docs/sdk/articles/set-up-a-client/authorization-strategies.md>

### 3 · Per-capability API docs (link, don't snippet)
For each loaded capability, give the package and its SDK doc page:

| Capability | Package(s) | SDK docs |
|---|---|---|
| stores | `@wix/stores` (+ `@wix/ecom`, `@wix/redirects` for cart/checkout) | <https://dev.wix.com/docs/sdk/business-solutions/stores.md> · cart: <https://dev.wix.com/docs/sdk/business-solutions/ecom.md> |
| blog | `@wix/blog` (+ `@wix/ricos` to render rich post content) | <https://dev.wix.com/docs/sdk/business-solutions/blog.md> — for rendering `richContent`, follow the blog docs to the current `@wix/ricos` viewer API + version (don't pin blind) |
| cms | `@wix/data` | <https://dev.wix.com/docs/sdk/business-solutions/data.md> |
| forms | `@wix/forms` | not a standalone business-solutions page — find the forms/submissions module from the menu (<https://dev.wix.com/docs/sdk/business-solutions.md>) or via `SearchWixSDKDocumentation` |

### 4 · Seeded IDs (what the host binds to)
From the `seeded` map — the IDs only this run knows:
- **stores:** `productIds`, product `slug`s, `categoryIds`
- **blog:** `postIds`, post `slug`s
- **cms:** `collectionId` + field keys per collection
- **forms:** `formId` + each form's field **`target`** keys (frontend input `name` = `target`)

### 5 · Integration notes (headless-auth specifics the per-module docs won't frame)
- The visitor token has **no per-user identity** → seeded **CMS collections are public/shared** across all visitors (not per-user, not cross-device). Per-user storage needs member auth.
- Frontend CMS access is **read**; visitor writes go through **Forms** submissions.

## How to navigate the Wix docs

> - Append `.md` to any URL under `https://dev.wix.com/docs/` to get its markdown version.
> - Pages are either content pages (article/reference text) or menu pages (a list of links to child pages).
> - To get a menu page, truncate any URL to a parent path and append `.md` (e.g. `https://dev.wix.com/docs/sdk.md`, `https://dev.wix.com/docs/sdk/business-solutions.md`).
> - Top-level index of all portals: <https://dev.wix.com/docs/llms.txt>
> - Full concatenated docs: <https://dev.wix.com/docs/llms-full.txt>
> - Or use the `SearchWixSDKDocumentation` tool for a targeted lookup.

## One required step remains: register the deployed origin

The guide describes the backend, but the frontend's visitor calls will be **rejected from the live site until its origin is registered on the OAuth app** (the step `init` does for hosted sites; here the deployed URL is only known after deploy). So after deployment, register the origin per `references/REGISTER_ORIGIN.md` — once per URL. If deployment is out of this agent flow, tell the user plainly that this step is required before the frontend can call Wix (`REGISTER_ORIGIN.md` has the wording).

## After emitting the document

Once the guide is emitted and the deployed origin is registered (or the user has been flagged), the skill's work is done. Close with a short plain-prose summary of what was set up (apps installed, content seeded per capability, origin registered or pending). What happens with the guide — installing packages, wiring components, choosing a framework — is the host's to decide.
