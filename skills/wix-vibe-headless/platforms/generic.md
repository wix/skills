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
| `wix-client.js` | The transport: exchanges `WIX_CLIENT_ID` for an anonymous **visitor token**, persists + refreshes it (that token *is* the cart/session identity), and exposes `wixApiRequest(path, {method, body, query})` — plus the member-session swap (`setSessionTokens` / `clearSession` / `isMember`). Plain `fetch`; SSR-guards `window`/`localStorage`; maps 402 + error bodies. |
| `wix-config.js` | Holds `WIX_CLIENT_ID` + `WIX_METASITE_ID` — the only values to fill in. |

**Every `references/<vertical>/` holds the same four things:**

- `app/rest/wix-*.js` — the vertical's **data layer**: named calls carrying the exact request/response
  **shapes**, fieldsets, and paging.
- `app/{components,pages,hooks,context}/…` — a **reference UI** (+ hooks/providers) built on that data
  layer; the field shapes and route patterns it uses (e.g. `/product/:slug`) are the data contract.
- `seed/seed-*.js` — build-time **seeding functions** that create content.
- `INSTRUCTIONS.md` — the vertical's build guide + field-shape snippets; `seed/SEED.md` — how the seed
  module is run.

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

Pull the whole client reference into context in two reads — **this is basically your prompt: it's all
the client code you need.** Build the client from it in your own stack's idiom (your router, file
extensions, design tokens), and set `WIX_CLIENT_ID` + `WIX_METASITE_ID` in `wix-config`.

```bash
V=<vertical>   # the vertical you're building

# utils — transport + data layer (plain fetch, already SSR-guarded; use ~as-is)
find .agents/skills/wix-vibe-headless/references/shared/app/rest \
     .agents/skills/wix-vibe-headless/references/$V/app/rest \
     -type f -name '*.js' -exec tail -n +1 {} +

# components/pages — a reference UI (rebuild for your framework; keep the field shapes + route patterns)
find .agents/skills/wix-vibe-headless/references/$V/app \
     -type f \( -name '*.jsx' -o -name '*.js' \) -not -path '*/rest/*' -exec tail -n +1 {} +
```

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

Pull the seed code into context — **this is your seeding prompt: it's all the code you need.** Run
these functions (adapting the exec + auth to your platform) to create the content:

```bash
V=<vertical>
find .agents/skills/wix-vibe-headless/references/$V/seed -name '*.js' -exec tail -n +1 {} +
```

They encode the Wix API sequences (incl. app-install + provisioning-race handling); use `wix-docs`
for anything they don't cover. Content queries return `REQUIRED_APP_NOT_INSTALLED` until the app is
installed + seeded (expected; the seed modules install it first). Image seeding = two Wix Media calls
(`generate-upload-url` → `PUT` the bytes) before attaching.

### 4 · Done

Mount the dev-only manage banner (regenerate `WixManageBanner` for your stack — it reads
`WIX_METASITE_ID` from `wix-config`, already set in step 2, and self-hides while it's still the
placeholder; mount above the header, SSR-safe, portable dev-gate, **never in production**), then tell
the user to open `https://manage.wix.com/dashboard/{metaSiteId}` to finish setup in Wix (payments,
content).
