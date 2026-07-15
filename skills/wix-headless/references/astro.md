# Astro — the pinned docs to read *before* connecting an Astro frontend to Wix

Astro is the **documented default** frontend for Wix-managed headless — pick it unless the user names another framework (then read `non-astro.md` instead). This file is to *wiring an Astro frontend to the Wix backend* what `SEED.md` is to seeding: the pointer to *how* it connects — an **index of doc pages**, each with a one-line "what it settles" note, **followed by a Caveats section** carrying the things the docs don't say. It holds **no config blobs, page skeletons, design tokens, or payloads** — the model designs and writes the whole frontend; this file only says *how to connect it* and *what to watch out for*.

**Auto-auth is the whole point.** On managed-Astro you create **no client** — no `createClient`, no `OAuthStrategy`, no `clientId`, no token handling in app code. You `import { x } from "@wix/<pkg>"` and call methods; `@wix/astro` + the session middleware authenticate every call automatically (§2, §3). The manual OAuth client survives **only** off this path — self-managed or non-Astro frontends (`non-astro.md`).

**Hard constraint up front: Astro 5 only.** `headless link` does **not** support Astro 6 — check the project's Astro major before linking an existing project (Caveat A1).

**How to use it.** Before scaffolding, wiring, or releasing, look the task up here and read its pinned pages top-to-bottom until you can act — read-then-act, never invent a URL or a config from memory. If a task has no entry, navigate from the doc index in §4.

**URL form & how to read it.** Each pinned link is the **`.md` twin** of a docs article (the article URL with `.md` appended). A page pinned here is **already curated — read it directly; don't re-discover it with search.** The two read paths take **different URL forms** — don't mix them:

- **`curl` the pinned link — first priority. Fetch it as-is (keep the `.md`)** for raw markdown.
- **MCP doc tools — second priority** (discovery of a page this file doesn't pin, or a fallback if a fetch fails). **Pass the URL *without* the `.md` suffix:** `ReadFullDocsArticle` for the guide/article pages here; `SearchWixCLIDocumentation` / `SearchWixHeadlessDocumentation` / `SearchWixSDKDocumentation` to reach an unpinned command or method page.
- **No MCP, or a shape not pinned anywhere → doc discovery** (`DOC_DISCOVERY.md`): a `curl` semantic search (`document_type: SDK`/`WIX_HEADLESS`) plus structured schema lookup, then read the hit's `.md?apiView=SDK`.

---

## 1 — Get the project onto Wix (scaffold / link / connect)

Pick the row that matches the operation, then read it before running anything.

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/wix-cli/command-reference/project-creation/create-headless.md> | **`create`** — `npm create @wix/new@latest -- headless`. The flags (`--folder-name`, `--business-name`, `--site-template`, `--skip-install`, `--skip-git`, `--no-publish`) and the **required `--` separator**. `--site-template` accepts `commerce\|scheduler\|registration\|blank`, but **we don't adopt the business templates** — the model designs, so scaffold `blank` and let config come from Wix, not template pages. |
| <https://dev.wix.com/docs/go-headless/get-started/quick-starts/wix-managed-headless/quick-start-from-an-existing-astro-project.md> | **`connect`** (user brought an Astro project) — `npm create @wix/new@latest -- headless link`. The end-to-end "link an Astro project I already have" flow. |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-creation/create-headless-link.md> | **`headless link` reference** — link flags and **exactly what it mutates in `astro.config.mjs`** (the integration list, `output: 'server'`, the image domain, the prod fetch adapter). Read alongside Caveat A2 — the docs' list is incomplete. |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-creation/create-init.md> | **`init`** — connect existing code in place without scaffolding (the lower-level connect primitive). |
| <https://dev.wix.com/docs/go-headless/get-started/quick-starts/wix-managed-headless/quick-start-with-the-wix-cli.md> | The end-to-end orientation for a fresh managed project, start to finish — read once for the shape of the whole flow. |

## 2 — The integration & auth (the keystone)

This is what makes managed-Astro different from every other path: authentication is automatic.

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/about-the-astro-integration.md> | **The keystone.** Auto-auth via the private app as OAuth handler, visitor sessions, member login, extensions, elevation. This is the "no client" anchor — read it first for §2/§3. |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/handle-member-login-using-wix-s-astro-integration.md> | **Member login** — the built-in `/api/auth/login` + `/api/auth/logout` routes and the `returnUrl` param. Use these instead of hand-rolling login. **For the full frontend contract (login = sign-up, gate in SSR/backend route, current member via `@wix/members`, no client, no elevate, pricing-plans dependency) → Read `inline-recipes/how-to-code-members-astro.md`** (local — Read it, don't curl). **Only if the brief explicitly asks for a custom/branded login form or custom sign-up fields → Read `inline-recipes/how-to-code-members-custom-login.md`** instead (a client-driven `OAuthStrategy` flow — on Astro that means an explicit client in a backend route, outside auto-auth; pick by intent, not project type). |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/elevate-api-call-permissions.md> | **Elevation.** A privileged read at runtime goes in a **backend HTTP endpoint** (`src/pages/api/*.ts`, `export const GET: APIRoute`) that wraps `auth.elevate()`, called from the frontend via `fetch('/api/…')`. This is the documented shape — prefer it over inline-frontmatter elevation. |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/fix-403-errors-for-api-calls.md> | **Fix 403** — the identity-vs-permission troubleshooting page; read when a call 403s to tell "wrong identity" from "needs elevation." |

## 3 — Frontend data access (SDK, no client)

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/sdk/articles/set-up-a-client/about-the-wix-client.md> | **Confirms managed-Astro is on the "don't need a client" list** — the client/`OAuthStrategy` is for self-managed only. Read it to be sure you should *not* be constructing a client here. |
| <https://dev.wix.com/docs/api-reference/articles/sdk-setup-and-usage/develop-with-the-sdk.md> | **Develop with the SDK** — calling SDK methods across SSR / islands / backend endpoints, and where elevation fits. |

One line on what reaches the frontend: **visitor-scoped reads work out of the box** with no wiring. **Admin-only data is seeded at build time** (see `SEED.md`) — don't reach for runtime elevation unless the data genuinely can't be seeded ahead of time.

## 4 — CLI, project structure, dev loop, release

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md> | What the CLI is and why the structure is Astro-based; auto-auth + session middleware framing. |
| <https://dev.wix.com/docs/wix-cli/guides/project-structure/project-structure.md> | **On-disk layout** — `.wix/`, `.astro/`, `astro.config.mjs`, `.env.local`, `wix.config.json`, `src/`. What's generated and not to be hand-edited. (Field-name note: `wix.config.json` carries `appId` + `siteId`/`projectId` — read defensively.) |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-commands/dev.md> | **`wix dev`** — local dev server with hot reload. |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-commands/build.md> | **`wix build`** — build before release/preview. |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-commands/release.md> | **`wix release`** — publishes the **frontend build output** to Wix hosting and registers the origin OOTB. **Release once, at the end** (`managed/CREATE.md` §5 / `CONNECT.md` §5) — not mid-flow. Re-release **only** when the build output itself changed. **Seeded backend content and entity images are fetched at runtime, not baked into the build** — a re-release does **not** refresh them, so never re-release to "clear a cache" for a backend data/image change (that's a red herring; a backend image not showing is an attach-shape bug — `SEED.md` § "Entity images"). Only if a genuine *frontend* republish shows stale build output does running `wix release` again help. |

Prefer the documented `wix …` / `npm run dev\|build\|release` forms (the scaffold rewrites `package.json` to route them through `wix`). Deploy mechanics — origin registration, retries — live in `managed/DEPLOYMENT.md`, not here.

## 5 — Environment variables (custom vars only)

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/environment-variables/manage-environment-variables.md> | **The documented mechanism.** Declare each var in the `envField` schema in `astro.config.mjs` (`context: client\|server`, `access: public\|secret`); import from **`astro:env/client`** / **`astro:env/server`**; set with **`wix env set --key=… --value=…`**, pull with **`wix env pull`** (no `--json`). **Never edit the `WIX_CLIENT_*` vars** — the CLI manages them. |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/environment-variables/about-environment-variables-in-the-cli.md> | The four var types (client/server × public/secret) — read when choosing the right `context`/`access`. |

This is for *custom* vars only. Because there's no client on managed-Astro, app code doesn't read `WIX_CLIENT_ID` at all (don't reach for the `import.meta.env.WIX_CLIENT_ID` manual-client pattern — managed-Astro has no client, so there's nothing to read it into).

## 6 — SEO: let owners manage tags on item pages

Main pages (home, listings, about) get their SEO tags **automatically** on managed-Astro — nothing to write. **Item pages** — any parameterized detail route (`/blog/[...slug]`, a product / service / event detail, an optional category/collection route) — do **not**: they need code so the tags a site owner edits in the dashboard reach the live `<head>`. Wire this on **every managed site that renders item/detail routes** — it's what lets owners control each item's `<title>`/description/OG/canonical without touching code, and it registers the route for the sitemap + dashboard SEO editor. Skipping it leaves detail pages with a generic fallback title the owner can't fix.

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md> | **The item-page SEO contract.** The three steps every detail route needs — export `wixMetadata` (route registration), call `loadSEOTagsServiceConfig(...)`, render `<SEO.Tags>` — plus the deps (`@wix/seo` + `@wix/essentials ≥ 1.0.10`), the `WIX_APPS` sourcing rule (reference it directly in the export), per-page-type values, and how to verify. Read it before writing any `[slug]` / `[...slug]` detail page. |

The **per-vertical values** — which `WIX_APPS.*PageMetadata` accessor + `seoTags.ItemType.*` to pass — live in each capability's `inline-recipes/how-to-code-*.md` (blog, store, bookings, events each name theirs).

## 7 — Caveats (the gaps the docs don't mention)

The heart of the file: tribal knowledge the docs won't surface. These are **guidance the model must follow when it writes the frontend** — not things this skill writes for it.

| Caveat | What it says |
|---|---|
| **A1 — Astro 5 only** | `headless link` does **not** support Astro 6. Before linking an existing Astro project, check its Astro major; on 6 it fails. Fresh scaffolds are fine (they pin a supported Astro). |
| **A2 — `astro.config.mjs` always carries `wixPages()` + `checkOrigin: false`** | A working config must **always** include `@wix/astro-pages` (`wixPages()`) alongside `wix()`/`react()`, **and** set `security: { checkOrigin: false }`. Neither is in the docs; both are **unconditional** (no "when to add" logic). `wixPages()` injects the `/_wix/pages.json` page manifest + the `wix:astro:pages` virtual module the Wix platform consumes — omit it and `/_wix/pages.json` 404s. `checkOrigin: false` disables Astro 5's CSRF origin check, which false-positives on legitimate same-site POSTs behind Wix hosting; it's a safe no-op when there are no server POSTs. If you touch `astro.config.mjs`, keep both. |
| **A3 — Guard every SSR SDK call** | Wrap every Wix SDK call in `.astro` frontmatter in `try/catch` — an unguarded throw truncates the response mid-stream (white screen). Memoize repeated SSR probes at module scope to coalesce duplicate calls within a request. |
| **A4 — Islands reading browser-only state must be `client:only="react"`** | An island that reads browser-only state (cart badge via `sessionStorage`, availability/booking widgets) must be `client:only="react"`, not `client:load` — otherwise SSR renders a zero/empty state and hydration flashes it to the real value. |
| **A5 — No HTML comments in `.astro` frontmatter** | `.astro` frontmatter is TypeScript — use `//`, never `<!-- -->`, or the build fails. |
| **A6 — Wix media + rich text** | **Resolve `wix:image://` URIs — never hand-build the CDN URL.** SDK media fields (product/blog/CMS images) come back as internal identifiers like `wix:image://v1/<hash>/<file>#originWidth=…`, **not** ready URLs. Convert them with the SDK media module — `import { media } from '@wix/sdk'`, then `media.getScaledToFillImageUrl(uri, w, h, {})` (**returns the URL string directly — do NOT append `.url`; the 4th `options` arg is required, pass `{}`**), or `media.getImageUrl(uri).url` for the original (**that** one returns a `{ url }` object). The two shapes differ — mixing them (`getScaledToFillImageUrl(...).url`) resolves every image to `undefined`. Manually building a `static.wixstatic.com/.../v1/fit/...` URL gets the format wrong and the image **403s** (or silently fails to load). Only `wix:image://` values need this — an already-absolute `https://` URL (e.g. an Unsplash placeholder) passes straight through. Docs: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>. Then **constrain** Wix image URLs (`aspect-ratio` + `object-fit: cover`) or they render at intrinsic size and overflow the layout. **Rich text:** the ban is on dumping *raw* HTML/Ricos into a text node — when you bind a rich-text field into a layout slot (a card excerpt, a `textContent` string), use its `.plain` variant. This is **not** a "render plain text" rule: a **blog post body is `richContent` (Ricos) and must render formatted** — via `@wix/ricos`, or by converting Ricos → sanitized HTML and rendering with `set:html` (SDK_HANDOFF §3/§6 require full formatted content, not flattened text). Plain `.plain` is for short bound fields; formatted Ricos is for the post body. |
| **A7 — `clientId` is off-path here** | In managed-Astro there is no client, so `appId`-as-`clientId` only matters on the self-managed / non-Astro path (see `non-astro.md`). Don't construct one here. |
| **A8 — Member auth uses the built-in routes, never an `OAuthStrategy` client** | Render account/gated UI **behind a login check resolved server-side** — in SSR frontmatter (guarded `try/catch`, A3) or a `src/pages/api/*.ts` route — and bounce anonymous visitors with `/api/auth/login?returnUrl=…` (the same shape blog comments already use). **Do not build an `OAuthStrategy` login handshake on Astro** — that's the non-Astro path and it 500s under auto-auth. Read the current member with **`@wix/members` `getCurrentMember`** (not the dev-preview `@wix/site-members`). Full contract: `inline-recipes/how-to-code-members-astro.md`. |
| **A9 — `sharp` is dev-only and never used here — pre-empt it, never build or diagnose it** | `sharp` is **not** a declared dependency: it's an *optional* transitive dep of Astro (`astro.optionalDependencies.sharp`, absent from your `package.json`) that powers only Astro's **local, build-time** image optimization (`astro:assets` / `<Image>`). This headless flow serves **remote Wix Media URLs** (`static.wixstatic.com`) through plain `<img>` — it **never** calls `<Image>`, so sharp is invoked at neither build nor runtime; it is pure dev-time dead weight here. Its postinstall can try to **build from source via node-gyp, fail, and abort the whole `npm install`, leaving `node_modules/` empty.** **Pre-empt this — don't react to it: always run `npm install --ignore-scripts`** (skips sharp's failing native build; the Wix CLI/SDK packages carry no postinstall that this breaks). **Do not** reach for **`--no-optional`** (deprecated / a silent no-op in npm 7+, so sharp still builds and aborts) or **`--omit=optional`** (sharp still resolves and builds). A missing or failed `sharp` is **expected and irrelevant** to a site that serves remote image URLs: **never** retry the install, switch node versions, add `node-addon-api`, or spend *any* time diagnosing a sharp error — one `--ignore-scripts` install, then move straight on. |

> **Seeding token (cross-link, not duplicated):** build-time seeding still mints a REST token via the Wix CLI — that token is **byte-identical on every re-mint**, so mint once and reuse. The full token mechanism lives in `managed/AUTHENTICATION.md`; don't restate it here.
