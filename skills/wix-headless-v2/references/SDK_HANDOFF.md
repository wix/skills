# SDK-integration handoff

**This is the last step — reach it only after Setup and Seed have run.** The guide below is filled from the `seeded` map (created IDs), which exists only because Seed executed; if you're here without having installed the apps and seeded content, go back and do that first. The guide *describes* the backend the earlier steps built.

The skill **returns this document** describing how to call Wix from the frontend, then **exits**. The host agent — which owns the frontend, the framework, and the build — does the wiring. We describe what to use and **link to the live Wix SDK docs for the API shapes**; the host decides where they go.

> **Link to the docs for API shapes; don't inline examples.** The Wix SDK docs are versioned and complete; hand-written snippets under-specify the hard parts (rich-content rendering, package versions, types) and lead the host to build against a wrong shape. The handoff supplies what the docs can't: the **seeded IDs**, the **`clientId` source**, and the **package set**. The package set is the **inlined map in §3** — the SDK doc `.md` pages don't surface the `@wix/*` import string to navigation, so the map is the source of truth for *which* packages; the linked module pages remain the source of truth for *how* to call them (current API shape + version).
>
> **The linked docs are the source of truth for current API shapes and versions — read them for the integration. Existing code (in this or any other project) is not a substitute: it may target a different SDK version and silently mislead.**

Emit the document as the skill's final message (a Markdown block the host can act on or save). Fill it from the run's `verticals[]`, the `seeded` map, the OAuth app's public `clientId`, and — for each loaded capability — its **Required site features** and **Implementation checklist** from `references/CAPABILITIES.md` (§6). Include **only** the loaded capabilities. The guide isn't just "here are the IDs and packages"; it's the spec for a *complete* site, so the host builds real features (author, comments, dates…) rather than a bare data dump.

## What the document contains

### 1 · Packages to install
The always-on package is **`@wix/sdk`** (provides `createClient` + `OAuthStrategy`). Add the union of the loaded capabilities' runtime packages from the **map in §3**. **Runtime packages only** (no scaffold/build deps). For install details and current versions, link: <https://dev.wix.com/docs/sdk/articles/work-with-the-sdk/install-sdk-packages.md>.

### 2 · Client setup (and the clientId source)
With a **manual client** the frontend authenticates as an **anonymous visitor** via `OAuthStrategy`, with `clientId` = the OAuth app's **public client id**. This is the model for **host-owned** frontends (this guide is emitted) and the skill's **non-Astro** path (`references/non-astro.md`). **Managed-Astro is the exception** — it auto-authenticates with **no client at all** (`references/astro.md`); skip this section's `clientId` wiring there. Two facts hold whenever a client *is* used: the `clientId` is **not secret** (it's the public OAuth id), and the **`client_secret` never reaches the frontend.** Two type-independent steps:

1. **Obtain the `clientId`** via the provided authentication mechanism — **see `<TYPE_DIR>/AUTHENTICATION.md`** (each type names where the public id comes from; don't re-mint or re-fetch it if the type already provides it).
2. **Get the `clientId` into the client bundle** — this depends on **who owns the frontend**, not on the project type:
   - **The host owns the frontend** (this guide is *emitted* — backend-only: self-managed, stripe, or managed backend-only) → the host exposes the value to client code via its framework's public-env convention (`NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, …).
   - **The skill owns the frontend** (this guide is *applied* — managed create/connect) → **how the frontend authenticates is framework-specific, so follow the frontend reference, not this bullet.** On **Astro** (the default) authentication is automatic — there is **no client and no `clientId` to wire** (`references/astro.md`). On a **non-Astro** frontend you build a manual client (`references/non-astro.md`): wire the `clientId` in via the framework's public-env convention if one exists, otherwise inline the public id into the client code/bundle.

For the current `createClient` + auth-strategy shape, link:
- <https://dev.wix.com/docs/sdk/articles/set-up-a-client.md>
- <https://dev.wix.com/docs/sdk/articles/set-up-a-client/authorization-strategies.md>

> **Confirm the `clientId` reached the built bundle before deploying.** Public-env wiring fails silently — a mis-wired public var inlines as `undefined`, and then *every* visitor token call from the live site 400s with no other clue. After the production build, verify the **actual `clientId` value** is present in the built output (check that the value resolves — not merely that the variable *name* appears somewhere). Doing this pre-deploy stops it from being mistaken for an origin/CORS problem afterward.

### 3 · Per-capability packages + API docs (package from the map; link for shapes)
For each loaded capability, give the host the **package(s)** from the map below and the **SDK module doc link** — the current API shape, methods, and version live on that page; let the host read them there rather than snippeting.

| Capability | Package(s) | SDK module docs (read for the API shape) |
|---|---|---|
| stores | `@wix/stores` (+ `@wix/ecom`, `@wix/redirects` for cart/checkout) | **Read `inline-recipes/how-to-code-a-store.md`** (local — Read it, don't curl): the pinned Catalog V3 read/cart contract. |
| blog | `@wix/blog` (+ `@wix/ricos` to render `richContent`; **`@wix/comments` + `@wix/members`** when the blog has comments/members; `@wix/blog` `likes` when the site has members) | **Read `inline-recipes/how-to-code-a-blog.md`** (local — Read it, don't curl): the pinned Blog V3 read/render contract (`RICH_CONTENT` fieldset, `_id`, Ricos viewer, `getCategory` envelope vs. `getTag` direct, `wix:image://` covers, `wixMetadata` on the Astro slug page) + the **member features** (likes are `MEMBER`-native; comments read-public/write-auth keyed on `post.referenceId`) and the callout that **member post-authoring is APP-only, not a member capability**. Supplement: <https://dev.wix.com/docs/sdk/business-solutions/blog.md>. |
| cms | `@wix/data` | **Read `inline-recipes/how-to-code-cms.md`** (local — Read it, don't curl): the pinned `items.query` read contract — fields-on-the-item (not `item.data`), `_id`, public-read so no `auth.elevate`, image + Ricos rendering. |
| forms | `@wix/forms` | under CRM: <https://dev.wix.com/docs/sdk/business-solutions/crm.md> (forms/submissions module) |
| events | `@wix/events` (+ `@wix/redirects` for the ticketed hosted-checkout redirect) | **Read `inline-recipes/how-to-code-events.md`** (local — Read it, don't curl): the pinned Events V3 read contract (`wixEventsV2.queryEvents`/`getEventBySlug`, `paging.limit > 0`, `_id`) + the branch on `registration.initialType` — `TICKETING` = reserve (`ticketReservations`) → redirect to Wix's hosted checkout; `RSVP` = `rsvp.createRsvp`; all visitor-scoped, no server/elevation. |
| bookings | `@wix/bookings` (+ `@wix/auto_sdk_ecom_cart-v-2`, `@wix/redirects` for the cart/checkout that holds the seat; `@wix/forms` for the schema-driven booking form) | **Read `inline-recipes/how-to-code-bookings.md`** (local — Read it, don't curl): the pinned Services V2 read + `createBooking → ecom Cart V2 → checkout-or-place` contract. |
| pricing-plans | `@wix/pricing-plans` | <https://dev.wix.com/docs/sdk/frontend-modules/pricing-plans.md> (lives under frontend-modules, not business-solutions) |
| gift-cards | `@wix/gift-vouchers` (npm name differs from the app name) | <https://dev.wix.com/docs/api-reference/business-solutions/gift-cards/gift-card-products/introduction> — open with `?apiView=SDK` |
| portfolio | `@wix/portfolio` | <https://dev.wix.com/docs/api-reference/business-solutions/portfolio/projects/introduction> — open with `?apiView=SDK` |
| restaurants | `@wix/restaurants` | <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/introduction> — open with `?apiView=SDK` |
| donations | `@wix/donations` (+ `@wix/ecom`, `@wix/redirects` for the donation checkout) | <https://dev.wix.com/docs/api-reference/business-solutions/donations/donation-campaigns/introduction> — open with `?apiView=SDK` |

> **The last four (gift-cards, portfolio, restaurants, donations) have no `sdk/business-solutions/<x>.md` menu page** — their SDK call shapes live on the unified **api-reference** pages with the **`?apiView=SDK`** toggle. **Prefer `SearchWixSDKDocumentation`** to reach the exact methods; the api-reference link above is the fallback entry point.

> **Cross-cutting packages** (`CAPABILITIES.md` § "Cross-cutting capabilities"): these aren't per-vertical rows but get added to the package list when the run used them. If **coupons** were seeded, add `@wix/marketing`. The eCommerce checkout packages (`@wix/ecom`, `@wix/redirects`) are already folded into the stores / donations / gift-cards rows above — include them once when any purchase-flow vertical is present.

> **members (cross-cutting — add when the site has login / account / gated content, or whenever pricing-plans is loaded).** Package: **`@wix/members`** (current member / profile via `getCurrentMember` — **not** the dev-preview `@wix/site-members`); auth is the `OAuthStrategy`/session methods on **`@wix/sdk`** (already always-on). **The API shape lives in the axis recipe — Read the one that matches the frontend, not both:** **`inline-recipes/how-to-code-members-astro.md`** (Astro: built-in `/api/auth/login` + `/api/auth/logout`, gate in SSR/backend route, no client) or **`inline-recipes/how-to-code-members-non-astro.md`** (non-Astro: manual `OAuthStrategy` handshake — `generateOAuthData → getAuthUrl → getMemberTokens → setTokens`, token persistence, published-site + allow-listed-redirectUri preconditions). Those two are the **Wix-hosted login page** (the default). **Only if the brief explicitly asks for a custom/branded login form or custom sign-up fields**, Read **`inline-recipes/how-to-code-members-custom-login.md`** instead (`client.auth.register`/`login`/`processVerification` → `getMemberTokensForDirectLogin`; works on any project type — the surface is chosen by intent, not project type). Recipes are local — Read them, don't curl.

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
- **gift-cards:** `giftCardProductId`
- **portfolio:** `collectionIds`, `projectIds`, project `slug`s
- **restaurants:** `menuId`, `sectionIds`, `itemIds`
- **donations:** `campaignIds`

### 5 · Integration notes (headless-auth specifics the per-module docs won't frame)
- The visitor token has **no per-user identity** → seeded **CMS collections are public/shared** across all visitors (not per-user, not cross-device). Per-user storage needs member auth.
- Frontend CMS access is **read**; visitor writes go through **Forms** submissions.
- **Donations and gift-card purchases complete through the eCommerce cart/checkout** (`catalogReference`) — the same `@wix/ecom` / `@wix/redirects` path as stores, not a payment API of their own. For donations, `catalogReference.appId` is the Donations app id and `catalogItemId` is the `campaignId`.
- **Blog comments are member-gated — read public, write authenticated.** Querying/rendering comments is public, so list them server-side in SSR. **Submitting** needs a logged-in member, so don't gate the form behind an upfront login check (that branch is what burns deliberation): render the form always and resolve identity at submit — POST to a backend endpoint (`src/pages/api/*.ts`) that calls `createComment` with the request session; if the caller isn't a member, redirect to the built-in `/api/auth/login?returnUrl=…` (astro.md member-login row). **Do not build the comment form as a client island** — the API-endpoint + session path is the documented shape and avoids the browser-auth detour. The comments API keys off the post's **`referenceId`** (request the `REFERENCE_ID` fieldset when fetching posts): `contextId` = `resourceId` = `post.referenceId`, and `appId` = the Wix Blog appDefId (`14bcded7-0066-7c35-14d7-466cb3f09103`, the one Setup installed). Author name/photo: look up `post.memberId` via `@wix/members`.
- **Member auth (login / account / gated content) is one mechanism split on the frontend axis, and orthogonal to elevation.** Sign-up and log-in are the *same* flow (the Wix login page logs in **or** registers); log-out is its inverse. **Astro** ships built-in `/api/auth/login` + `/api/auth/logout` routes (no client, gate in SSR/backend route); **non-Astro** drives a manual `OAuthStrategy` handshake on the same visitor client. **Full details are in the axis recipe — point the host at `inline-recipes/how-to-code-members-astro.md` OR `…-non-astro.md`, whichever matches the frontend.** **Login *surface* is a second, intent-driven choice** (orthogonal to the axis): the default is the **Wix-hosted login page** (the two recipes above); switch to a **custom login page** — `inline-recipes/how-to-code-members-custom-login.md` — **only when the brief explicitly asks for a custom/branded login form or custom sign-up fields** (full name / username / address). Custom login works on any project type; **do not branch on managed-vs-self-managed** — branch on intent. Two layers stay separate: **identity** (logged-in vs not — no app install) vs **profile** (name/photo/roles — needs the **Wix Members Area app** installed, `SETUP.md`). **pricing-plans is a hard dependency**: subscribing requires a logged-in member (a logged-in member's `startOnlinePurchase` needs no `onBehalf`); for the other verticals, member login is a soft add-on for their "my …" surfaces only. **A member reading their own data (own orders/bookings/subscriptions, plan-gated content) uses the member token with NO `auth.elevate`** — elevation is the separate admin/permission axis (site-wide reads, server-side only), not something member features need.

### 6 · What a complete site must include (per loaded capability)
For each loaded capability, carry its **Required site features** and **Implementation checklist** from `references/CAPABILITIES.md` into the guide — in plain product language, lightly tailored to what was seeded. **This is the build spec, not optional polish:** the host should build every *required feature* and cover every *checklist* item. For example, a blog must show the **author** (name + photo), the publish date and reading time, the cover image, the **full formatted content** (not flattened text), and let readers **comment** — a posts-list-plus-plain-text-body is incomplete. The host maps these onto its own components using the packages/docs in §3 and the seeded IDs in §4.

- State them as the *what* (product behaviour), not the *how* (no component code, no API calls) — the host owns the build.
- If a *required feature* depends on backend support that **Seed** enabled (e.g., comments), note it's available so the host wires it. If Seed could **not** enable it, say so plainly rather than implying the site is complete.
- **When pricing-plans is loaded, `login / account / gated content` is a *required* feature, not optional polish** — a plans grid with no way to log in and subscribe is incomplete (subscribing requires a member; §5 member-auth note). Point the host at the matching `how-to-code-members-*.md` recipe. For the other verticals, a "my …" surface (my orders / my bookings / my registrations) is a member-gated *enhancement* — list it only if the run's intent calls for an account view, and flag it needs the same login mechanism.

## How to navigate the Wix docs

> - Append `.md` to any URL under `https://dev.wix.com/docs/` to get its markdown version.
> - Pages are either content pages (article/reference text) or menu pages (a list of links to child pages).
> - To get a menu page, truncate any URL to a parent path and append `.md` (e.g. `https://dev.wix.com/docs/sdk.md`, `https://dev.wix.com/docs/sdk/business-solutions.md`).
> - Top-level index of all portals: <https://dev.wix.com/docs/llms.txt>
> - Full concatenated docs: <https://dev.wix.com/docs/llms-full.txt>
> - **A pinned SDK link (the module-doc links in §3) — `curl` its `.md` directly (first priority).** It's already curated; read it as-is, don't re-discover it.
> - **`SearchWixSDKDocumentation` is second priority — for *discovering* a method §3 doesn't pin, or when a menu hides the runtime functions.** Curling a module *menu* (e.g. `…/sdk/business-solutions/blog.md`) often surfaces only dashboard/extension pages, not the runtime query functions — `SearchWixSDKDocumentation "blog query posts"` returns the actual `posts.queryPosts`/`listPosts` shapes (with `?apiView=SDK` schema links) the menu doesn't expose.

## After deploy: finalize per the project type

The guide describes the backend; how the site is published and how its origin is allowed to call Wix depend on the project type. After deployment, **finalize per `<TYPE_DIR>/DEPLOYMENT.md`** — it carries the type-specific steps (and tells you whether anything is required of the user).

## After emitting the document

Once the guide is emitted and the deployment checklist is done — site published, origin registered (or the user has been flagged) — the skill's work is done. Close with a short plain-prose summary of what was set up (apps installed, content seeded per capability, site published, origin registered or pending). What happens with the guide — installing packages, wiring components, choosing a framework — is the host's to decide.
