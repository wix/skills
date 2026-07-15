# Non-Astro — the pinned docs to read *before* wiring a non-Astro frontend to Wix

This is the framework reference for any **non-Astro** frontend — React/Vue/Svelte/Vite SPA or plain static HTML. Astro stays the default (`astro.md`); read this when the user **names a framework** or **brings a non-Astro design**. Like `astro.md`, it's an **index of doc pages** with one-line "what it settles" notes, **then a Caveats section**. It carries **no design, templates, payloads, or per-framework code** — the model designs and writes the whole frontend; this file says only *how it connects*.

**This file is framework-axis only — it is mode-agnostic.** It is read in **both** the managed and self-managed flows, so it contains **no managed-vs-self-managed branching**: no `init` vs OAuth-app, no `wix release` vs external host, no `outputDirectory`, no `wix.config.json`. Anything that differs by *who hosts* lives in the project-type files (`managed/`, `self-managed/`) — you're already reading those in a known mode. Here is only what's **identical across both flows**: a non-Astro frontend talks to Wix through a manual `OAuthStrategy` visitor client + the SDK, the same way no matter who hosts it.

**The auth rule (the cross-skill boundary).** **Astro = auto-auth, no client. Non-Astro = manual client.** Unlike Astro, you create a client — `createClient({ modules, auth: OAuthStrategy({ clientId }) })`. For non-Astro this is the **documented, correct** model (the "Create a Client with OAuth" doc scopes itself to "frameworks other than Astro"). The `clientId` is the project's **public** OAuth client id — **not** a secret. **Where that id comes from is your flow's `AUTHENTICATION.md`** (managed: the `appId` in `wix.config.json`; self-managed: the OAuth app you created) — this file just *uses* it.

**Two sub-shapes, split on build — a framework fact, not a hosting fact:** **bundler SPA** (has a build step → `npm install` + `import`) vs **static HTML** (no build → load the SDK from a CDN). The caveats below split on that.

**How to use it.** Before authenticating or wiring data, read the pinned pages top-to-bottom — read-then-act, never invent a URL or a body from memory.

**URL form & how to read it.** Each link is the **`.md` twin** of a docs article. A page pinned here is **already curated — read it directly; don't re-discover it with search.** The two read paths take **different URL forms** — don't mix them:

- **`curl` the link — first priority. Fetch it as-is (keep the `.md`)** for raw markdown.
- **MCP doc tools — second priority** (discovery of a page this file doesn't pin, or a fallback if a fetch fails). Pass the URL *without* the `.md` suffix — `ReadFullDocsArticle` for the article pages here, `SearchWixSDKDocumentation` to reach SDK methods this file doesn't pin.
- **No MCP, or a shape not pinned anywhere → doc discovery** (`DOC_DISCOVERY.md`): a `curl` semantic search (`document_type: SDK`/`WIX_HEADLESS`) plus structured schema lookup, then read the hit's `.md?apiView=SDK`.

---

## 1 — Authenticate (the heart — manual client, identical in both flows)

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/oauth/create-a-client-for-authentication-with-oauth.md> | **The model.** Install `@wix/sdk` + the domain packages, then `createClient({ modules, auth: OAuthStrategy({ clientId }) })`. clientId only, **no secret in the frontend**. Explicitly scoped to "frameworks other than Astro." Create the client **once** and reuse it. |
| <https://dev.wix.com/docs/sdk/core-modules/sdk/oauth-strategy.md> | **`OAuthStrategy` reference** — visitor sessions (automatic) vs member flows (managed/custom/external); token + session methods; confirms `clientId` only. |
| <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/visitors/handle-visitors-using-the-js-sdk.md> | **Visitors & members via the JS SDK** — visitor token sessions out of the box, and member login when the site needs it. Members are **first-class** on the non-Astro path (not deferred). |
| <https://dev.wix.com/docs/go-headless/self-managed-headless/authentication/members/wix-login-page/wix-managed-login-using-the-js-sdk.md> | **Member login (Wix login page)** — the manual `OAuthStrategy` handshake: `generateOAuthData → getAuthUrl → parseFromUrl → getMemberTokens → setTokens`, `logout`, `loggedIn()`. Login *is* sign-up (the Wix page logs in or registers); member tokens are the **same shape** as visitor tokens (`role: member`), so they reuse the visitor session machinery — login just swaps the token set. **`clientId` only (no secret); the connected site must be PUBLISHED and the `redirectUri` must be an exact-match allow-listed URI, or `getAuthUrl` fails; default to the Wix login page** over custom/external. **Full frontend contract → Read `inline-recipes/how-to-code-members-non-astro.md`** (local — Read it, don't curl). **Only if the brief explicitly asks for a custom/branded login form or custom sign-up fields → Read `inline-recipes/how-to-code-members-custom-login.md`** instead (`client.auth.register`/`login`; works on any project type — pick by intent, not project type). |
| <https://dev.wix.com/docs/sdk/articles/set-up-a-client/about-the-wix-client.md> | **Confirms non-Astro *does* need a client** — the "when you need a client vs not" list; non-Astro (managed or self-managed) is on the "needs a client" side, the mirror of Astro. |

> **clientId source is deferred.** This file uses the `clientId`; it does **not** say where it comes from. That's `{managed,self-managed}/AUTHENTICATION.md` — managed reads `appId` from `wix.config.json`; self-managed uses the OAuth app you created. Don't re-mint or re-fetch it if the flow already provides it.

## 2 — Frontend data access (identical in both flows)

All reads and writes go through the client from §1 — the SDK call shapes are framework-identical (the model adapts the idiom: React effect / Vue `onMounted` / Svelte store). For **which packages** a capability needs and the **SDK module docs** for each call shape, use `SDK_HANDOFF.md` §3 (the package map) — don't restate it here. For **what was seeded** and the IDs to bind, cross-link `SEED.md`; the frontend reads it with the visitor client.

| Page | What it settles |
|---|---|
| <https://dev.wix.com/docs/sdk/articles/work-with-the-sdk/install-sdk-packages.md> | Installing `@wix/sdk` + domain packages and their current versions (bundler path). |

## 3 — Build the frontend (framework fact, not hosting)

- **Bundler SPA** — produce the build output with the project's own `npm run build`.
- **Static HTML** — there is **no build**; the HTML *is* the deployable artifact.

This file **stops at "produce the build output."** *Where that output is deployed and how* — `outputDirectory`, publish, origin registration, the `index.html`-at-root rule — is host-specific and lives in `{managed,self-managed}/DEPLOYMENT.md`, not here.

## 4 — Caveats (framework-invariant only)

These hold regardless of who hosts. Host-specific gotchas (static `outputDirectory`, the `index.html` rename) are filed in `managed/DEPLOYMENT.md`, where you're in a known mode. (Numbering: N2/N3 were retired; the gap is intentional and the remaining IDs are kept stable so inbound references don't shift.)

| Caveat | What it says |
|---|---|
| **N1 — No Wix scaffolder for a new non-Astro site** | There is **no** Wix command to scaffold a fresh React/Vue/static site — the non-Astro flow is connect-only. To *create* from scratch, the model runs the framework's **own** `npm create …` (e.g. `npm create vite@latest`), then the flow connects it. **Never infer a framework the user didn't name.** |
| **N4 — No-bundler sites load the SDK from a CDN** | With **no bundler** (static HTML), import the SDK in a `<script type="module">` from `https://esm.sh/@wix/sdk@1` (plus the domain packages the same way) — there's no `npm install` step to bundle it. With a bundler, use normal `npm install` + `import`. |
| **N5 — Client-only ⇒ no elevation ⇒ public-read** | A pure SPA/static frontend runs with a **visitor** token and **no server**, so there is no `auth.elevate`. CMS collections it reads must be **public-read**; anything member-scoped needs member auth. True regardless of who hosts. (Contrast Astro, which can elevate in a backend `/api` endpoint.) |
| **N6 — `clientId` is public; inline it** | The OAuth `clientId` is public, not a secret — it's fine to inline it directly in client code/bundle; there's no runtime secret to protect and no env-var indirection required. (Where the value comes from is still the flow's `AUTHENTICATION.md`.) |
| **N7 — Resolve `wix:image://` URIs with the SDK, never by hand** | SDK media fields (product/blog/CMS images) come back as internal identifiers like `wix:image://v1/<hash>/<file>#originWidth=…`, **not** ready URLs. Convert them with the SDK media module — `import { media } from '@wix/sdk'`, then `media.getScaledToFillImageUrl(uri, w, h, {})` (**returns the URL string directly — do NOT append `.url`; the 4th `options` arg is required, pass `{}`**), or `media.getImageUrl(uri).url` for the original (**that** one returns a `{ url }` object). The two shapes differ — mixing them (`getScaledToFillImageUrl(...).url`) resolves every image to `undefined`. Hand-building a `static.wixstatic.com/.../v1/fit/...` URL gets the format wrong and the image **403s** (or silently fails to load). Only `wix:image://` values need this — an already-absolute `https://` URL (e.g. an Unsplash placeholder) passes straight through. Docs: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>. |
| **N8 — Member login is a manual `OAuthStrategy` round-trip on the same client** | Login (which *is* sign-up), logout and "am I a member?" run on the visitor client from §1 — don't build a second client. Drive the handshake yourself: `generateOAuthData → getAuthUrl → parseFromUrl → getMemberTokens → setTokens`, `logout`, `loggedIn()`; **persist and renew** member tokens exactly like visitor tokens (`renewToken`, re-hydrate with `setTokens` on boot). Preconditions that bite: **`clientId` only**, **site PUBLISHED**, **`redirectUri` allow-listed exact-match**, **default to the Wix login page**. Read the current member with **`@wix/members` `getCurrentMember`** (not the dev-preview `@wix/site-members`). **No `auth.elevate`** — a member reads their own data under the member token, and a serverless SPA has no elevation anyway (N5). Full contract: `inline-recipes/how-to-code-members-non-astro.md`. |
