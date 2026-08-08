# Wix Managed Headless — build instructions (any stack)

You are building a **Wix Managed** headless site — the business, your `WIX_CLIENT_ID`, and metasite
id are in your prompt. This skill is **client-only REST** over the public `WIX_CLIENT_ID`
(visitor-facing, safe in the browser) — no `@wix/sdk`, no backend, no build step.

## What you've got in the skill

The docs were authored for **one host stack** (Vite + react-router, `.jsx`, files pre-copied into
`src/`) — you may be on another, so **adapt these assets to your stack; don't copy the host's setup.**
Everything is under `.agents/skills/wix-vibe-headless/references/`.

**Shared transport — both files, used by every vertical (`shared/app/rest/`):**

| file | what's in it |
|---|---|
| `wix-client.js` | The transport. Exchanges `WIX_CLIENT_ID` for an anonymous **visitor token**, persists + refreshes it (that token *is* the cart/session identity), and exposes `wixApiRequest(path, {method, body, query})`. Also the member-session swap — `setSessionTokens` / `clearSession` / `isMember`. Plain `fetch`; already SSR-guards `window`/`localStorage`; maps 402 + error bodies. **Use ~verbatim.** |
| `wix-config.js` | The one place you set `WIX_CLIENT_ID` + `WIX_METASITE_ID`. |

**Every `references/<vertical>/` holds the same four things:**

- `app/rest/wix-*.js` — the vertical's **data layer**: named calls carrying the exact request/response
  **shapes**, fieldsets, and paging. **Use ~verbatim** (TS → rename `.js → .ts` + add types); never
  change the shapes.
- `app/{components,pages,hooks,context}/…` — a **reference UI** (+ hooks/providers). **Regenerate it
  in your framework** (your router, `.tsx`, your design tokens); keep the field shapes and route
  patterns (e.g. `/product/:slug`).
- `seed/seed-*.js` — build-time **seeding functions**; **reuse them** to create content (step 3).
- `INSTRUCTIONS.md` (build guide + field-shape snippets) and `seed/SEED.md` (how to run the seed module).

**The nine verticals — data layer (`app/rest/`) + seed module (`seed/`):**

| vertical | `app/rest/` data layer | seed module |
|---|---|---|
| storefront | `wix-store-catalog.js`, `wix-store-cart.js` — products & variants; server cart + checkout redirect | `seed-store.js` |
| bookings | `wix-bookings-services.js`, `wix-bookings-checkout.js` — services/categories/slots; booking + checkout | `seed-bookings.js` |
| blog | `wix-blog.js` — posts (list + by-slug), categories, tags | `seed-blog.js` |
| events | `wix-events-browse.js`, `wix-events-registration.js` — events & categories; RSVP / ticketing + checkout | `seed-events.js` |
| portfolio | `wix-portfolio.js` — collections, projects, galleries | `seed-portfolio.js` |
| restaurants | `wix-restaurants-menu.js`, `-ordering.js`, `-reservations.js` — menu; online ordering; table reservations | `seed-restaurants.js` |
| cms | `wix-cms.js` — Wix Data collections: list / detail / filter + form CRUD | `seed-cms.js` |
| pricing-plans | `wix-pricing-plans.js` — plans list + subscribe/checkout | `seed-pricing-plans.js` |
| members | `wix-members-auth.js` — custom login/signup (email+password, social, SSO), session, account | *(none — members sign up at runtime; nothing to seed)* |

Anything in the docs about the **host's own setup** — copying files into `src/`, its `@/` alias, its
`import.meta.env` flags, a theming file, its build/exec/connector tooling — is that host's, not a
rule: **adapt it to your stack or ignore it.** The `SKILL.md` **"shared model"** (public-client-id
auth, money = objects → render `formattedValue`, visitor token = cart identity, member login swaps
the token set) is **universal — follow it as-is**.

## The flow — install → build client → seed → done

Run **build the client** (step 2) and **seed** (step 3) in parallel; parallelize independent work within each.

### 1 · Install the skills

Two skills, into `.agents/skills/`: **`wix-vibe-headless`** (this build guide + the seed modules —
self-contained) and **`wix-docs`** (fallback to search/read the Wix API reference).

```bash
CI=1 npx skills@latest add wix/skills/skills/wix-vibe-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-docs --yes
```

### 2 · Build the client

Read `SKILL.md` + each target `references/<vertical>/INSTRUCTIONS.md` (through **"What you've got"**
above). Use the `rest/` layer as-is, regenerate the UI for your framework, and set `WIX_CLIENT_ID` +
`WIX_METASITE_ID` in `wix-config`. If the brief doesn't say which Wix solution(s) to build, **ask the
user** one short question (what do they offer?), or let step 3's site read settle it.

### 3 · Seed the content

**⛔ NO CLEANUP — EVER.** Strictly **additive**: never delete, reset, or overwrite anything on the
user's live site — not even apparent sample/demo content. If something looks wrong, leave it and tell
the user.

**Auth** (the public client id won't do): if your platform has a **built-in Wix connector**, use it
(it holds the credential). Otherwise take a **Wix API key** into your secrets manager (never hardcode
or commit) — create one at **[account API keys → Add key](https://manage.wix.com/account/api-keys/addkey)**
([how-to](https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/generate-an-api-key)) —
and send it **raw as `Authorization` (no `Bearer`)** with a **`wix-site-id`** header (`wix-account-id`
only for account-level APIs — one, not both):

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
  -H 'Authorization: <API_KEY>' -H 'wix-site-id: <METASITE_ID>' \
  -H 'Content-Type: application/json' -d '{"query":{"cursorPaging":{"limit":10}}}'
```

**Once you have that admin credential**, you can read the site to see which apps are actually
installed — build and seed only those, never guessed ones:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: <admin token or raw API key>' -H 'Content-Type: application/json' \
  -d '{"siteId": "<metasite id from your prompt>"}'
```

Then seed by reusing the functions in `references/<vertical>/seed/seed-*.js` (they encode the Wix API
sequences, incl. app-install + provisioning-race handling); use `wix-docs` for anything they don't
cover. Content queries return `REQUIRED_APP_NOT_INSTALLED` until the app is installed + seeded
(expected; the seed modules install it first). Image seeding = two Wix Media calls
(`generate-upload-url` → `PUT` the bytes) before attaching.

### 4 · Done

Mount the dev-only manage banner (regenerate `WixManageBanner` for your stack — set `WIX_METASITE_ID`,
above the header, SSR-safe, portable dev-gate, **never in production**), then tell the user to open
`https://manage.wix.com/dashboard/{metaSiteId}` to finish setup in Wix (payments, content).
