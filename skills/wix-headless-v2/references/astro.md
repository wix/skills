# Astro — the pinned docs to read *before* connecting an Astro frontend to Wix

Astro is the **documented default** frontend for Wix-managed headless — pick it unless the user names another framework (then read `non-astro.md` instead). This file is to *wiring an Astro frontend to the Wix backend* what `SEED_RECIPES.md` is to seeding: an **index of doc pages**, each with a one-line "what it settles" note, **followed by a Caveats section** carrying the things the docs don't say. It holds **no config blobs, page skeletons, design tokens, or payloads** — the model designs and writes the whole frontend; this file only says *how to connect it* and *what to watch out for*.

**Auto-auth is the whole point.** On managed-Astro you create **no client** — no `createClient`, no `OAuthStrategy`, no `clientId`, no token handling in app code. You `import { x } from "@wix/<pkg>"` and call methods; `@wix/astro` + the session middleware authenticate every call automatically (§2, §3). The manual OAuth client survives **only** off this path — self-managed or non-Astro frontends (`non-astro.md`).

**Hard constraint up front: Astro 5 only.** `headless link` does **not** support Astro 6 — check the project's Astro major before linking an existing project (Caveat A1).

**How to use it.** Before scaffolding, wiring, or releasing, look the task up here and read its pinned pages top-to-bottom until you can act — read-then-act, never invent a URL or a config from memory. If a task has no entry, navigate from the doc index in §4.

**URL form & how to read it.** Each pinned link is the **`.md` twin** of a docs article (the article URL with `.md` appended). A page pinned here is **already curated — read it directly; don't re-discover it with search.** The two read paths take **different URL forms** — don't mix them:

- **`curl` the pinned link — first priority. Fetch it as-is (keep the `.md`)** for raw markdown.
- **MCP doc tools — second priority** (discovery of a page this file doesn't pin, or a fallback if a fetch fails). **Pass the URL *without* the `.md` suffix:** `ReadFullDocsArticle` for the guide/article pages here; `SearchWixCLIDocumentation` / `SearchWixHeadlessDocumentation` / `SearchWixSDKDocumentation` to reach an unpinned command or method page.

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
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/handle-member-login-using-wix-s-astro-integration.md> | **Member login** — the built-in `/api/auth/login` + `/api/auth/logout` routes and the `returnUrl` param. Use these instead of hand-rolling login. |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/elevate-api-call-permissions.md> | **Elevation.** A privileged read at runtime goes in a **backend HTTP endpoint** (`src/pages/api/*.ts`, `export const GET: APIRoute`) that wraps `auth.elevate()`, called from the frontend via `fetch('/api/…')`. This is the documented shape — prefer it over inline-frontmatter elevation. |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/authentication/fix-403-errors-for-api-calls.md> | **Fix 403** — the identity-vs-permission troubleshooting page; read when a call 403s to tell "wrong identity" from "needs elevation." |

## 3 — Frontend data access (SDK, no client)

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/sdk/articles/set-up-a-client/about-the-wix-client.md> | **Confirms managed-Astro is on the "don't need a client" list** — the client/`OAuthStrategy` is for self-managed only. Read it to be sure you should *not* be constructing a client here. |
| <https://dev.wix.com/docs/api-reference/articles/sdk-setup-and-usage/develop-with-the-sdk.md> | **Develop with the SDK** — calling SDK methods across SSR / islands / backend endpoints, and where elevation fits. |

One line on what reaches the frontend: **visitor-scoped reads work out of the box** with no wiring. **Admin-only data is seeded at build time** (see `SEED.md` / `SEED_RECIPES.md`) — don't reach for runtime elevation unless the data genuinely can't be seeded ahead of time.

## 4 — CLI, project structure, dev loop, release

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md> | What the CLI is and why the structure is Astro-based; auto-auth + session middleware framing. |
| <https://dev.wix.com/docs/wix-cli/guides/project-structure/project-structure.md> | **On-disk layout** — `.wix/`, `.astro/`, `astro.config.mjs`, `.env.local`, `wix.config.json`, `src/`. What's generated and not to be hand-edited. (Field-name note: `wix.config.json` carries `appId` + `siteId`/`projectId` — read defensively, see Caveat A6.) |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-commands/dev.md> | **`wix dev`** — local dev server with hot reload. |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-commands/build.md> | **`wix build`** — build before release/preview. |
| <https://dev.wix.com/docs/wix-cli/command-reference/project-commands/release.md> | **`wix release`** — publishes to Wix hosting and registers the origin OOTB. **Releasing a headless site clears its entire cache** — if a republish still shows stale content, run `wix release` again. |

Prefer the documented `wix …` / `npm run dev\|build\|release` forms (the scaffold rewrites `package.json` to route them through `wix`). Deploy mechanics — origin registration, retries — live in `managed/DEPLOYMENT.md`, not here.

## 5 — Environment variables (custom vars only)

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/environment-variables/manage-environment-variables.md> | **The documented mechanism.** Declare each var in the `envField` schema in `astro.config.mjs` (`context: client\|server`, `access: public\|secret`); import from **`astro:env/client`** / **`astro:env/server`**; set with **`wix env set --key=… --value=…`**, pull with **`wix env pull`** (no `--json`). **Never edit the `WIX_CLIENT_*` vars** — the CLI manages them. |
| <https://dev.wix.com/docs/go-headless/wix-managed-headless/project-development/environment-variables/about-environment-variables-in-the-cli.md> | The four var types (client/server × public/secret) — read when choosing the right `context`/`access`. |

This is for *custom* vars only. Because there's no client on managed-Astro, app code doesn't read `WIX_CLIENT_ID` at all (that's the v1 `import.meta.env.WIX_CLIENT_ID` pattern — drop it; it was the manual-client path).

## 6 — Caveats (the gaps the docs don't mention)

The heart of the file: tribal knowledge the docs won't surface. These are **guidance the model must follow when it writes the frontend** — not things this skill writes for it.

| Caveat | What it says |
|---|---|
| **A1 — Astro 5 only** | `headless link` does **not** support Astro 6. Before linking an existing Astro project, check its Astro major; on 6 it fails. Fresh scaffolds are fine (they pin a supported Astro). |
| **A2 — `astro.config.mjs` always carries `wixPages()` + `checkOrigin: false`** | A working config must **always** include `@wix/astro-pages` (`wixPages()`) alongside `wix()`/`react()`, **and** set `security: { checkOrigin: false }`. Neither is in the docs; both are **unconditional** (no "when to add" logic). `wixPages()` injects the `/_wix/pages.json` page manifest + the `wix:astro:pages` virtual module the Wix platform consumes — omit it and `/_wix/pages.json` 404s. `checkOrigin: false` disables Astro 5's CSRF origin check, which false-positives on legitimate same-site POSTs behind Wix hosting; it's a safe no-op when there are no server POSTs. If you touch `astro.config.mjs`, keep both. |
| **A3 — Guard every SSR SDK call** | Wrap every Wix SDK call in `.astro` frontmatter in `try/catch` — an unguarded throw truncates the response mid-stream (white screen). Memoize repeated SSR probes at module scope to coalesce duplicate calls within a request. |
| **A4 — Islands reading browser-only state must be `client:only="react"`** | An island that reads browser-only state (cart badge via `sessionStorage`, availability/booking widgets) must be `client:only="react"`, not `client:load` — otherwise SSR renders a zero/empty state and hydration flashes it to the real value. |
| **A5 — No HTML comments in `.astro` frontmatter** | `.astro` frontmatter is TypeScript — use `//`, never `<!-- -->`, or the build fails. |
| **A6 — Wix media + rich text** | Constrain Wix image URLs (`aspect-ratio` + `object-fit: cover`) or they render at intrinsic size and overflow the layout. **Rich text:** the ban is on dumping *raw* HTML/Ricos into a text node — when you bind a rich-text field into a layout slot (a card excerpt, a `textContent` string), use its `.plain` variant. This is **not** a "render plain text" rule: a **blog post body is `richContent` (Ricos) and must render formatted** — via `@wix/ricos`, or by converting Ricos → sanitized HTML and rendering with `set:html` (SDK_HANDOFF §3/§6 require full formatted content, not flattened text). Plain `.plain` is for short bound fields; formatted Ricos is for the post body. |
| **A7 — `clientId` is off-path here** | In managed-Astro there is no client, so `appId`-as-`clientId` only matters on the self-managed / non-Astro path (see `non-astro.md`). Don't construct one here. |

> **Seeding token (cross-link, not duplicated):** build-time seeding still mints a REST token via the Wix CLI — that token is **byte-identical on every re-mint**, so mint once and reuse. The full token mechanism lives in `managed/AUTHENTICATION.md`; don't restate it here.
