# Wix Managed Headless — build instructions (any stack)

You are building a **Wix Managed** headless site — the business, your `WIX_CLIENT_ID`, and metasite
id are in your prompt. Read **"What this skill is"** + **"Hard rules"** first (they change how you
read everything else), then the steps.

## What this skill is (read first)

`wix-vibe-headless` is a **client-only REST connector** to a live Wix site over the public
`WIX_CLIENT_ID` (visitor-facing, safe in the browser) — **no `@wix/sdk`, no backend, no build step**.
Its docs (`SKILL.md`, each `references/<vertical>/INSTRUCTIONS.md`) are written for **one specific
host stack** — Vite + react-router, `.jsx`, shadcn tokens in `index.css`, files pre-copied into
`src/` by a `deploy.cjs`. **You may well be on a different stack**, so don't read them literally —
read them for the **three real assets**, and translate the host-stack assumptions (table below):

1. **`shared/app/rest/wix-client.js` + `<vertical>/app/rest/wix-*.js`** — REST transport + data layer.
   **Copy ~verbatim** (rule 2); the source of truth for every request/response **shape**, the token
   lifecycle, fieldsets, and paging.
2. **`<vertical>/app/{components,pages,hooks}` + the field snippets in `INSTRUCTIONS.md`** — a
   reference UI + data contract. **Regenerate the UI in your framework**; what you take is the **field
   shapes** and **route patterns** (e.g. `/product/:slug`).
3. **`<vertical>/seed/seed-*.js`** — build-time seeding **functions**. **Reuse them**; wrap in your
   platform's exec/connector (STEP 4).

(All paths are under `.agents/skills/wix-vibe-headless/references/`.)

## Hard rules (do not skip)

1. **Never convert the project's framework, bundler, dev server, or ports** — generate the Wix files
   *into* the existing stack (Next.js → `app/<route>/page.tsx`; a file-based SSR router →
   `src/routes/*`; Vite + react-router → as-is). Switching the project to a different bundler is the
   #1 time-sink here: orphaned dev servers, port whack-a-mole, broken previews.
2. **Copy the `rest/` layer ~verbatim** — plain `fetch`, framework-agnostic, already SSR-guards
   `window`/`localStorage`. TypeScript project? rename `.js → .ts` + add types — but **never change
   the shapes, endpoints, or token logic** (the hard-won part).
3. **Generate everything else in your idiom** — your router, `.tsx`, your design tokens. Browser-only
   code (cart provider, manage banner, anything touching `localStorage`/`window`) must be **SSR-safe**
   (client-only / hydration guard). Dev-gate the banner portably: `import.meta.env?.DEV` is Vite-only
   → fall back to `process.env.NODE_ENV !== "production"`.
4. **Read-only over the owner's content** — live Wix data or an honest empty state; never mock,
   invent, or provision on the client.

## How to read `SKILL.md` + `INSTRUCTIONS.md` — translate the host-stack assumptions

| The doc says… | For you it means… |
|---|---|
| "already deployed into `src/`" / run `deploy.cjs` | there is **no copy step** — you **generate** these files |
| "don't `read_file` the shipped source" | **do** read the `rest/` files — your source of truth for shapes |
| "copy-as-is `.jsx`" | **regenerate** as your framework's components (`.tsx`, your router) |
| `@/` alias, `import.meta.env.DEV` | use **your** import paths + a **portable** dev check |
| theme via the host's `index.css` / shadcn tokens | map the intent to **your** design tokens |
| react-router `/product/:slug` | keep the **route pattern**; implement it in **your** router |
| host-specific tools (screenshot / exec / a pre-wired connector) | use **your** platform's equivalents (STEP 4) |

`SKILL.md`'s **"shared model"** (public-client-id auth, money = objects → render `formattedValue`,
visitor token = cart identity, member login swaps the token set) is **universal — follow as-is.**

## STEP 1 — Install the Wix skills locally

Install two (land under `.agents/skills/`):
- **`wix-vibe-headless`** — the client build guide (STEP 3) **and** the seeding modules (STEP 4),
  read via the lens above. **This skill is self-contained — everything you need is here.**
- **`wix-docs`** — **fallback** to search/read the Wix API reference for anything the seed modules
  don't cover.

```bash
CI=1 npx skills@latest add wix/skills/skills/wix-vibe-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-docs --yes
```

**Only if the CLI errors** (not on a guess), fall back to curl + gzip:
```bash
for s in vibe-headless docs; do
  mkdir -p ".agents/skills/wix-$s"
  curl -s "https://www.wix.com/skills/$s.tgz" | tar xz -C ".agents/skills/wix-$s" --strip-components=1
done
```

Read them from files as you go (web fetches truncate large docs).

## STEP 2 (optional) — Brief vague? Ask, or read the site

Only when the business description is missing/unclear. Don't guess the Wix Business Solution (stores,
bookings, blog, events, portfolio, restaurants, CMS, pricing plans, members): **ask** one short
question, or — with an admin credential (STEP 4; the public client id won't do) — **read the site**:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"siteId": "<metasite id from your prompt>"}'
```

Returns installed apps (by name), status, URL, locale, CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md);
with an API key send it raw, no `Bearer`). Build for the **installed** apps — never guessed ones; the
same set drives STEP 4's seeding.

## STEP 3 — Build the client (generate into your stack)

Read `wix-vibe-headless/SKILL.md` + each target `references/<vertical>/INSTRUCTIONS.md` **through the
lens above**, and set `WIX_CLIENT_ID` + `WIX_METASITE_ID` in `wix-config`. Map the reference UI to
your stack — **never convert the project**:

| your stack | routes go in | dev-gate | SSR / verify notes |
|---|---|---|---|
| **Next.js (App Router)** | `app/<route>/page.tsx`; `"use client"` on cart + banner | `process.env.NODE_ENV !== "production"` | build in Next — don't switch bundlers. If the in-tool preview can't reach your dev server, verify by curling the served module URLs + checking for transform errors instead of a screenshot. |
| **File-based SSR router** (TanStack Start, Remix, …) | `src/routes/*` | `import.meta.env?.DEV` or your bundler's equivalent | wrap client-only bits in a `ClientOnly` / `useHydrated` guard; copying `.js` `rest/` files into a TS project → set `allowJs` + `jsx` in `tsconfig.json` (or rename to `.ts`). |
| **Vite + react-router (SPA)** | `src/pages/*` in `<Routes>` | `import.meta.env.DEV` | closest to the reference; the `rest/` files drop in directly. |

## STEP 4 — Seed and manage the business (parallel with STEP 3)

**⛔ NO CLEANUP — EVER.** Seeding is strictly **additive**: never delete, reset, or overwrite
anything on the user's live site — **not even apparent sample/demo content**. Ignore any
cleanup/reset step you come across. If something looks wrong, leave it and tell the user.

Seed by **reusing the functions** in `references/<vertical>/seed/seed-*.js` — they encode the correct
Wix API sequences (incl. app-install + provisioning-race handling). For anything they don't cover, use
`wix-docs` to read the relevant API reference.

**Auth (elevated — the public client id won't do), in order:**
1. **Platform has a built-in Wix integration / connector? Use it** — call Wix through it; it owns the
   credential, so you never touch a raw key. Look for a Wix connection in your platform's connector /
   secrets manager and call through its gateway.
2. **Otherwise, take a Wix API key into your secret / env manager** — ask the user, store it there
   (**never hardcode or commit**). Create one:
   **[account API keys → Add key](https://manage.wix.com/account/api-keys/addkey)** (how-to:
   [Generate an API key](https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/generate-an-api-key)).
   A key call is like a token call, but `Authorization` is the **raw key (no `Bearer`)** plus a
   **`wix-site-id`** header (site-level; `wix-account-id` only for account-level APIs — one, not both;
   site-level keys must be made from the **site owner's** account):
   ```bash
   curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
     -H 'Authorization: <API_KEY>' -H 'wix-site-id: <METASITE_ID>' \
     -H 'Content-Type: application/json' -d '{"query":{"cursorPaging":{"limit":10}}}'
   ```
   The seed modules take a token via `ctx`; to run them with a key, swap their
   `Authorization: Bearer <token>` for the raw-key + `wix-site-id` shape above.

Do **not** reach for the Wix CLI (`@wix/cli`) or a device-login — auth is the connector or the API key.

**Notes:** client content queries return `REQUIRED_APP_NOT_INSTALLED` until STEP 4 installs + seeds
the app (expected; the seed modules install it first). Image seeding = two Wix Media calls
(`generate-upload-url` → `PUT` the bytes) before you attach the file to a product/post/etc.

## Later admin requests

Same as STEP 4: reuse the skill's `references/<vertical>/seed/` modules and patterns; fall back to
`wix-docs` for anything they don't cover.

## STEP 5 — When done

1. **Add the dev-only manage banner** (required): regenerate `WixManageBanner` for your stack
   (reference: `references/<vertical>/app/components/WixManageBanner.jsx`) — set `WIX_METASITE_ID`,
   mount it in the Layout's fixed top region above the header, dev-gate it **portably** (rule 3), and
   guard its `localStorage` read for SSR. **Never** render it in production.
2. **Ask the user to open** `https://manage.wix.com/dashboard/{metaSiteId}` to finish setup in Wix
   (payments, content). Mention dev builds show a slim dismissible banner to that same dashboard
   (never in production).
