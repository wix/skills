# SDK-integration handoff

**This is the last step — reach it only after Setup and Seed have run.** The guide below is filled from the `seeded` map (created IDs), which exists only because Seed executed; if you're here without having installed the apps and seeded content, go back and do that first. The guide *describes* the backend the earlier steps built.

The skill **returns this document** describing how to call Wix from the frontend, then **exits**. The host agent — which owns the frontend, the framework, and the build — does the wiring. We describe what to use and **link to the live Wix SDK docs for the API shapes**; the host decides where they go.

> **Link to the docs for API shapes; don't inline examples.** The Wix SDK docs are versioned and complete; hand-written snippets under-specify the hard parts (rich-content rendering, package versions, types) and lead the host to build against a wrong shape. The handoff supplies what the docs can't: the **seeded IDs**, the **`clientId` source**, and the **package set**. The package set is the **inlined map in §3** — the SDK doc `.md` pages don't surface the `@wix/*` import string to navigation, so the map is the source of truth for *which* packages; the linked module pages remain the source of truth for *how* to call them (current API shape + version).
>
> **The linked docs are the source of truth for current API shapes and versions — read them for the integration. Existing code (in this or any other project) is not a substitute: it may target a different SDK version and silently mislead.**

Emit the document as the skill's final message (a Markdown block the host can act on or save). Fill it from the run's `verticals[]`, the `seeded` map, `WIX_WIX_CLIENT_ID`, and — for each loaded capability — its **Required site features** and **Implementation checklist** from `references/CAPABILITIES.md` (§6). Include **only** the loaded capabilities. The guide isn't just "here are the IDs and packages"; it's the spec for a *complete* site, so the host builds real features (author, comments, dates…) rather than a bare data dump.

## What the document contains

### 1 · Packages to install
The always-on package is **`@wix/sdk`** (provides `createClient` + `OAuthStrategy`). Add the union of the loaded capabilities' runtime packages from the **map in §3**. **Runtime packages only** (no scaffold/build deps). For install details and current versions, link: <https://dev.wix.com/docs/sdk/articles/work-with-the-sdk/install-sdk-packages.md>.

### 2 · Client setup (and the clientId source)
The frontend authenticates as an **anonymous visitor** via `OAuthStrategy`, with `clientId` = the **`WIX_WIX_CLIENT_ID`** value. The `clientId` is **not secret** (it's the public OAuth id) — the host exposes it to client code via its framework's public-env convention (`NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, …). The **`client_secret` never reaches the frontend.** For the current `createClient` + auth-strategy shape, link:
- <https://dev.wix.com/docs/sdk/articles/set-up-a-client.md>
- <https://dev.wix.com/docs/sdk/articles/set-up-a-client/authorization-strategies.md>

> **Confirm the `clientId` reached the built bundle before deploying.** Public-env wiring fails silently — a mis-wired public var inlines as `undefined`, and then *every* visitor token call from the live site 400s with no other clue. After the production build, verify the **actual `clientId` value** is present in the built output (check that the value resolves — not merely that the variable *name* appears somewhere). Doing this pre-deploy stops it from being mistaken for an origin/CORS problem afterward.

### 3 · Per-capability packages + API docs (package from the map; link for shapes)
For each loaded capability, give the host the **package(s)** from the map below and the **SDK module doc link** — the current API shape, methods, and version live on that page; let the host read them there rather than snippeting.

| Capability | Package(s) | SDK module docs (read for the API shape) |
|---|---|---|
| stores | `@wix/stores` (+ `@wix/ecom`, `@wix/redirects` for cart/checkout) | <https://dev.wix.com/docs/sdk/business-solutions/stores.md> · cart: <https://dev.wix.com/docs/sdk/business-solutions/ecom.md> |
| blog | `@wix/blog` (+ `@wix/ricos` to render `richContent` — follow the blog page to the current viewer API, don't pin a version blind) | <https://dev.wix.com/docs/sdk/business-solutions/blog.md> |
| cms | `@wix/data` | <https://dev.wix.com/docs/sdk/business-solutions/data.md> |
| forms | `@wix/forms` | under CRM: <https://dev.wix.com/docs/sdk/business-solutions/crm.md> (forms/submissions module) |
| events | `@wix/events` | <https://dev.wix.com/docs/sdk/business-solutions/events.md> |
| bookings | `@wix/bookings` | <https://dev.wix.com/docs/sdk/business-solutions/bookings.md> |
| pricing-plans | `@wix/pricing-plans` | <https://dev.wix.com/docs/sdk/frontend-modules/pricing-plans.md> (lives under frontend-modules, not business-solutions) |

> **Why a map and not navigation:** the SDK doc `.md` pages don't expose the `@wix/*` import string to a reader (it's only in the page's interactive UI), so the package column is inlined here as the source of truth. If a package name ever drifts, reconcile it against the SDK install article (§1) — not by guessing from the module URL. The linked pages remain authoritative for the API itself.

### 4 · Seeded IDs (what the host binds to)
From the `seeded` map — the IDs only this run knows:
- **stores:** `productIds`, product `slug`s, `categoryIds`
- **blog:** `postIds`, post `slug`s
- **cms:** `collectionId` + field keys per collection
- **forms:** `formId` + each form's field **`target`** keys (frontend input `name` = `target`)
- **events:** `eventIds`, event `slug`s
- **bookings:** `serviceIds`, service `slug`s
- **pricing-plans:** `planIds`

### 5 · Integration notes (headless-auth specifics the per-module docs won't frame)
- The visitor token has **no per-user identity** → seeded **CMS collections are public/shared** across all visitors (not per-user, not cross-device). Per-user storage needs member auth.
- Frontend CMS access is **read**; visitor writes go through **Forms** submissions.

### 6 · What a complete site must include (per loaded capability)
For each loaded capability, carry its **Required site features** and **Implementation checklist** from `references/CAPABILITIES.md` into the guide — in plain product language, lightly tailored to what was seeded. **This is the build spec, not optional polish:** the host should build every *required feature* and cover every *checklist* item. For example, a blog must show the **author** (name + photo), the publish date and reading time, the cover image, the **full formatted content** (not flattened text), and let readers **comment** — a posts-list-plus-plain-text-body is incomplete. The host maps these onto its own components using the packages/docs in §3 and the seeded IDs in §4.

- State them as the *what* (product behaviour), not the *how* (no component code, no API calls) — the host owns the build.
- If a *required feature* depends on backend support that **Seed** enabled (e.g., comments), note it's available so the host wires it. If Seed could **not** enable it, say so plainly rather than implying the site is complete.

## How to navigate the Wix docs

> - Append `.md` to any URL under `https://dev.wix.com/docs/` to get its markdown version.
> - Pages are either content pages (article/reference text) or menu pages (a list of links to child pages).
> - To get a menu page, truncate any URL to a parent path and append `.md` (e.g. `https://dev.wix.com/docs/sdk.md`, `https://dev.wix.com/docs/sdk/business-solutions.md`).
> - Top-level index of all portals: <https://dev.wix.com/docs/llms.txt>
> - Full concatenated docs: <https://dev.wix.com/docs/llms-full.txt>
> - **Prefer `SearchWixSDKDocumentation` when the host exposes it.** Curling a module menu (e.g. `…/sdk/business-solutions/blog.md`) often surfaces only dashboard/extension pages, not the runtime query functions — `SearchWixSDKDocumentation "blog query posts"` returns the actual `posts.queryPosts`/`listPosts` shapes (with `?apiView=SDK` schema links) that the menu doesn't expose. Fall back to curling `.md` only when no MCP doc tool is present.

## After deploy: publish the site and register the origin

The guide describes the backend, but the frontend's visitor calls will be **rejected from the live site until its origin is registered on the OAuth app** (the step `init` does for hosted sites; here the deployed URL is only known after deploy). So after deployment, run `references/DEPLOYMENT_CHECKLIST.md` — **publish the metasite** and **register the origin** (once per URL). If deployment is out of this agent flow, tell the user plainly that the origin step is required before the frontend can call Wix (`DEPLOYMENT_CHECKLIST.md` has the wording).

## After emitting the document

Once the guide is emitted and the deployment checklist is done — site published, origin registered (or the user has been flagged) — the skill's work is done. Close with a short plain-prose summary of what was set up (apps installed, content seeded per capability, site published, origin registered or pending). What happens with the guide — installing packages, wiring components, choosing a framework — is the host's to decide.
