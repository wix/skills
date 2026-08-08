# Wix Managed Headless — build instructions (any stack)

You are building a **Wix Managed** headless site — the business, your `WIX_CLIENT_ID`, and metasite
id are in your prompt. This skill is **client-only REST** over the public `WIX_CLIENT_ID`
(visitor-facing, safe in the browser) — no `@wix/sdk`, no backend, no build step.

## What you've got in the skill

Its docs (`SKILL.md`, each `references/<vertical>/INSTRUCTIONS.md`) were authored for **one host
stack** (Vite + react-router, `.jsx`, files pre-copied into `src/`). You may be on another — so take
the **three assets** and adapt them; don't copy the host's setup:

1. **`rest/` layer** — `shared/app/rest/wix-client.js` + `<vertical>/app/rest/wix-*.js`: the transport
   + data layer, and the source of truth for every request/response **shape**, the token lifecycle,
   fieldsets, and paging. **Use ~verbatim** (plain `fetch`, already SSR-guarded; TS → rename `.js →
   .ts` + add types) — don't change the shapes.
2. **UI + data contract** — `<vertical>/app/{components,pages,hooks}` + the field snippets in
   `INSTRUCTIONS.md`: a **reference** UI. **Regenerate it in your framework** (your router, `.tsx`,
   your design tokens); keep the field shapes and route patterns (e.g. `/product/:slug`).
3. **seed functions** — `<vertical>/seed/seed-*.js`: **reuse them** to create content (step 4).

Anything in the docs about the **host's own setup** — copying files into `src/`, its `@/` alias, its
`import.meta.env` flags, a theming file, its build/exec/connector tooling — is that host's, not a
rule: adapt it to your stack or ignore it. The **"shared model"** in `SKILL.md` (public-client-id
auth, money = objects → render `formattedValue`, visitor token = cart identity, member login swaps
the token set) is **universal — follow it as-is**.

(All paths are under `.agents/skills/wix-vibe-headless/references/`.)

## Hard rules

1. **Never convert the project's framework, bundler, dev server, or ports** — generate the Wix files
   *into* the existing stack. Switching the project to another bundler is the #1 time-sink here:
   orphaned dev servers, port whack-a-mole, broken previews.
2. **`rest/` layer ~verbatim; regenerate everything else in your idiom.** Browser-only code (cart,
   manage banner, anything using `localStorage`/`window`) must be **SSR-safe**; dev-gate the banner
   portably (`import.meta.env?.DEV` is Vite-only → fall back to `process.env.NODE_ENV !== "production"`).
3. **Read-only over the owner's content** — render live Wix data or an honest empty state; never
   mock, invent, or provision.

## The flow — install → build client → seed → done

Run **build client** (step 3) and **seed** (step 4) in parallel; parallelize independent work within each.

### 1 · Install the skills

Two skills, into `.agents/skills/`: **`wix-vibe-headless`** (this build guide + the seed modules —
self-contained) and **`wix-docs`** (fallback to search/read the Wix API reference).

```bash
CI=1 npx skills@latest add wix/skills/skills/wix-vibe-headless --yes
CI=1 npx skills@latest add wix/skills/skills/wix-docs --yes
```

Only if the CLI errors (not on a guess), fall back to curl + gzip:
```bash
for s in vibe-headless docs; do
  mkdir -p ".agents/skills/wix-$s"
  curl -s "https://www.wix.com/skills/$s.tgz" | tar xz -C ".agents/skills/wix-$s" --strip-components=1
done
```

### 2 · (optional) Not sure what to build?

Only if the brief is vague. **Ask** one short question, or — with an admin credential (step 4) —
**read the site**:

```bash
curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
  -H 'Authorization: Bearer <admin token>' -H 'Content-Type: application/json' \
  -d '{"siteId": "<metasite id from your prompt>"}'
```

Returns the installed apps, status, locale, CMS collections
([docs](https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md);
API key → send it raw, no `Bearer`). Build for the **installed** apps — never guessed ones.

### 3 · Build the client

Read `SKILL.md` + each target `references/<vertical>/INSTRUCTIONS.md` (through **"What you've got"**
above). Use the `rest/` layer as-is, regenerate the UI for your framework, and set `WIX_CLIENT_ID` +
`WIX_METASITE_ID` in `wix-config`.

### 4 · Seed the content

**⛔ NO CLEANUP — EVER.** Strictly **additive**: never delete, reset, or overwrite anything on the
user's live site — not even apparent sample/demo content. If something looks wrong, leave it and tell
the user.

Reuse the functions in `references/<vertical>/seed/seed-*.js` (they encode the Wix API sequences,
incl. app-install + provisioning-race handling); use `wix-docs` for anything they don't cover.

**Auth** (the public client id won't do): if your platform has a **built-in Wix connector**, use it
(it holds the credential). Otherwise take a **Wix API key** into your secrets manager (never hardcode
or commit) — create one at **[account API keys → Add key](https://manage.wix.com/account/api-keys/addkey)**
([how-to](https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/generate-an-api-key)) —
and send it **raw as `Authorization` (no `Bearer`)** with a **`wix-site-id`** header
(`wix-account-id` only for account-level APIs — one, not both):

```bash
curl -X POST 'https://www.wixapis.com/stores/v3/products/query' \
  -H 'Authorization: <API_KEY>' -H 'wix-site-id: <METASITE_ID>' \
  -H 'Content-Type: application/json' -d '{"query":{"cursorPaging":{"limit":10}}}'
```

Content queries return `REQUIRED_APP_NOT_INSTALLED` until the app is installed + seeded (expected; the
seed modules install it first). Image seeding = two Wix Media calls (`generate-upload-url` → `PUT` the
bytes) before attaching.

### 5 · Done

Mount the dev-only manage banner (regenerate `WixManageBanner` for your stack — set `WIX_METASITE_ID`,
above the header, SSR-safe, portable dev-gate, **never in production**), then tell the user to open
`https://manage.wix.com/dashboard/{metaSiteId}` to finish setup in Wix (payments, content).
