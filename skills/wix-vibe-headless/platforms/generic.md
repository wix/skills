# Wix Managed Headless — build instructions (any stack)

You are building a **Wix Managed** headless site. The business to build, and your Wix client id
and metasite id, are given in your initial prompt. Read **"What this skill is"** and **"Hard
rules"** first — they change how you read everything else — then follow the steps.

## What this skill is (read this first)

`wix-vibe-headless` is a **client-only REST connector** to a live Wix site over the public
`WIX_CLIENT_ID` (a visitor-facing credential, safe in the browser) — **no `@wix/sdk`, no backend,
no build step**. Its docs (`SKILL.md` and each `references/<vertical>/INSTRUCTIONS.md`) are written
for **one specific host — Base44** (Vite + react-router, `.jsx`, shadcn tokens in `index.css`, files
pre-copied into `src/` by a `deploy.cjs`). **You are almost certainly on a different stack** (Next.js,
TanStack Start, Remix, plain Vite, …), so don't read those docs literally — read them for the **three
real assets** and translate the Base44-isms (table below):

1. **`references/shared/app/rest/wix-client.js` + `references/<vertical>/app/rest/wix-*.js`** — the
   REST transport + per-vertical data layer. **Copy these ~verbatim** (rule 2). They are the source
   of truth for every request/response **shape**, the token lifecycle, fieldsets, and paging.
2. **`references/<vertical>/app/{components,pages,hooks}` + the field snippets in `INSTRUCTIONS.md`** —
   a **reference UI + the data contract**. **Regenerate the UI in your framework**; what you actually
   take from here is the **field shapes** and the **route patterns** (e.g. `/product/:slug`).
3. **`references/<vertical>/seed/seed-*.js`** — build-time seeding **functions**. **Reuse the
   functions**; wrap them in *your* platform's exec/connector (STEP 4).

## Hard rules (do not skip)

1. **Never convert the project's framework, bundler, dev server, or ports.** If the template is
   Next.js, build Next.js (App Router: `app/<route>/page.tsx`); if TanStack Start, add `src/routes/*`;
   if Vite + react-router, use that. **Generate the Wix files *into* the existing stack — do NOT
   migrate the project to Vite.** (Converting the framework is the single biggest source of wasted
   time here: orphaned dev servers, port whack-a-mole, broken previews.)
2. **Copy the `rest/` layer ~verbatim.** It's plain `fetch`, framework-agnostic, and already guards
   `window`/`localStorage` for SSR. If your project is TypeScript, rename `.js → .ts` and add types —
   but **do not change the request/response shapes, endpoints, or token logic**. That's the hard-won
   part.
3. **Everything else you GENERATE in your stack's idiom** — your router, your file extensions
   (`.tsx`), your design tokens. Any browser-only code (cart provider, the manage banner, anything
   reading `localStorage`/`window`) must be **SSR-safe**: gate it with a client-only / hydration
   guard so it doesn't run during server render or static prerender. For the dev-only manage banner,
   use a **portable dev check** — `import.meta.env?.DEV` is Vite-only; fall back to
   `process.env.NODE_ENV !== "production"`.
4. **Read-only over the owner's content.** Render live Wix data or an honest empty state — never
   mock, invent, or provision content on the client.

## How to read `SKILL.md` + `INSTRUCTIONS.md` — translate the Base44-isms

| The doc says… | For you it means… |
|---|---|
| "the client is already deployed into `src/`" / run `deploy.cjs` | there is **no copy step** — you **generate** these files into your project |
| "don't `read_file` the shipped source" | **do** read the `rest/` files — they are your source of truth for shapes |
| "shipped as real files, copy-as-is `.jsx`" | **regenerate** as your framework's components (`.tsx`, your router) |
| `@/` import alias, `import.meta.env.DEV` | use **your** stack's import paths + a **portable** dev check |
| theme via base44 `src/index.css` / shadcn tokens | map the same intent to **your** design system's tokens |
| react-router routes like `/product/:slug` | keep the **route pattern**; implement it in **your** router |
| `preview_screenshot` / `exec_tool` / base44 connector | use **your** platform's equivalents (STEP 4 for seeding) |

Everything in `SKILL.md`'s **"shared model"** (auth = one public client id, money fields are objects →
render `formattedValue`, visitor token = cart identity, member login swaps the token set) **is
universal — follow it as-is.**

## STEP 1 — Install the Wix skills locally

Install three skills — they land under `.agents/skills/`:
- **`wix-vibe-headless`** — the client build guide (STEP 3), read through the lens above.
- **`wix-headless`** — use it **only** as a seeding/admin recipe reference (`references/SEED.md`,
  `references/inline-recipes/`, for STEP 4). **Ignore everything else** — in particular its
  `@wix/cli` / "managed project" auth (`references/managed/`). That is **not** how auth works here.
- **`wix-docs`** — a **fallback**: how to search + read the Wix API reference for anything the
  seeding recipes don't cover.

```bash
CI=1 npx skills@latest add wix/skills/skills/wix-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-vibe-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-docs --yes
```

**Only if the CLI actually errors** (not on a guess), fall back to curl + gzip:
```bash
for s in headless vibe-headless docs; do
  mkdir -p ".agents/skills/wix-$s"
  curl -s "https://www.wix.com/skills/$s.tgz" | tar xz -C ".agents/skills/wix-$s" --strip-components=1
done
```

Read the skills from these files as you go (fetching skill docs over the web truncates large files).

## STEP 2 (optional) — Brief doesn't say what to build? Ask, or read the site

Only when the business description is vague or missing. Don't guess which Wix Business Solution to
build (stores, bookings, blog, events, portfolio, restaurants, CMS, pricing plans, members):
**ask the user** one short question, or — with an admin-grade Wix credential (connector token or API
key, per STEP 4; the public `WIX_CLIENT_ID` is not enough) — **read the site** in one call:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"siteId": "<metasite id from your prompt>"}'
```

It returns the installed apps (by name), status, URL, locale, and CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md);
with an API key send it raw as the `Authorization` value, no `Bearer`). Build for the solutions whose
apps are installed; the same set drives STEP 4's seeding — never seed guessed ones.

## STEP 3 — Build the client (generate into your stack)

Read `.agents/skills/wix-vibe-headless/SKILL.md` and each target vertical's
`references/<vertical>/INSTRUCTIONS.md` **through the lens above**: copy the `rest/` layer verbatim,
regenerate the UI in your framework from the field snippets + route patterns, and ignore the
"already in `src/` / don't read the source / `index.css` / `@/` / `deploy.cjs`" framing (that's
Base44's copy path — you generate instead). Set `WIX_CLIENT_ID` + `WIX_METASITE_ID` in `wix-config`.

**Per-stack cheatsheet** (map the reference UI to your stack; never convert the project):

| stack (example platform) | routes go in | dev-gate | SSR / verify notes |
|---|---|---|---|
| **Next.js** (v0) | `app/<route>/page.tsx`; `"use client"` on the cart provider + banner | `process.env.NODE_ENV !== "production"` | keep the dev server on **:3000** (don't spawn Vite). If the in-tool browser rewrites `localhost` to a sandbox host, verify by curling the served module URLs + checking for transform errors instead of a screenshot. |
| **TanStack Start** (Lovable) | `src/routes/*.tsx` (e.g. `shop.tsx`, `product.$slug.tsx`) | `import.meta.env.DEV` | wrap client-only bits in a `ClientOnly` / `useHydrated` guard; if copying the `.js` `rest/` files into a TS project, set `allowJs` + `jsx` in `tsconfig.json` (or rename to `.ts`). |
| **Vite + react-router** (Base44-like) | `src/pages/*` wired in `<Routes>` | `import.meta.env.DEV` | closest to the shipped reference; the `rest/` files drop in directly. |

## STEP 4 — Seed and manage the business (run in parallel with STEP 3)

**⛔ Never delete or clean up anything on the user's site — seeding is additive only.** Ignore any
cleanup/reset step in the `wix-headless` seed recipes: it's a live user-owned business. If a cleanup
truly seems needed, ask the user first.

Seed real content by **reusing the functions** in `references/<vertical>/seed/seed-*.js` (they encode
the correct Wix API sequences, incl. app-install + provisioning-race handling), following the
`wix-headless` skill's `references/SEED.md` for anything they don't cover, and `wix-docs` beyond that.

**Auth for admin/seed calls** — the public client id is **not** enough. Get an elevated credential
one of these ways, and store it in your platform's **connector / secrets (env) manager** — never
hardcode or commit it:
- **Your platform has a Wix connector** → connect it and call through its gateway. *(Lovable, e.g.:
  gateway `https://connector-gateway.lovable.dev/wix`, with `LOVABLE_API_KEY` + `X-Connection-Api-Key`.)*
- **Base44** → the connector is pre-wired; run seed modules via its exec tool.
- **Otherwise** → ask the user for a **Wix API key** and authenticate each REST call with it (the
  `wix-docs` skill covers Wix API-key auth — send it raw as `Authorization`, no `Bearer`).

Do **not** install/run the Wix CLI (`@wix/cli`), device-login, or follow `wix-headless`'s
`references/managed/AUTHENTICATION.md` — that managed-project flow does not apply here.

**Notes:** the client's product/content queries return `REQUIRED_APP_NOT_INSTALLED` until the app is
installed + seeded — that's expected and resolves once STEP 4 lands (the seed modules install the app
first). **Image seeding** is two Wix Media calls — `generate-upload-url` then a `PUT` of the bytes —
before you attach the returned file to a product/post/etc.

Run STEP 3 and STEP 4 in parallel where possible, and parallelize independent work within each.

## Later admin requests

Work the same way as STEP 4: check `wix-headless`'s inline recipes
(`.agents/skills/wix-headless/references/inline-recipes/`) first, fall back to `wix-docs`.

## STEP 5 — When done

1. **Add the dev-only manage banner** (required): regenerate `WixManageBanner` for your stack from the
   reference (`references/<vertical>/app/components/WixManageBanner.jsx`) — set `WIX_METASITE_ID`, mount
   it in your Layout's fixed top region above the header, gate it to dev with a **portable** check
   (see rule 3), and guard its `localStorage` read for SSR. It must **never** render in production.
2. **Ask the user to open** `https://manage.wix.com/dashboard/{metaSiteId}` (substitute the metasite id
   from your prompt) to finish setup in Wix — connect a payment provider, manage content, etc. Mention
   the dev builds show a slim dismissible banner linking to that same dashboard (never in production).
