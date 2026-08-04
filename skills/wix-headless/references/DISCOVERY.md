# Discovery — infer, don't interview

The run starts here. **Infer** the Wix capability set, the brand, and per-capability intent from the user's words (and, optionally, the project on disk). Inference is just the first step — its output **drives Setup (install apps) and Seed (create content)**, which are the actual work; flow straight through into them. The host already has the user's buy-in to add Wix, so resolve everything from what's given and keep moving; when something isn't specified, use the defaults below.

Discovery is pure inference — it needs **no authentication** and is **agnostic to the project type**. The token and metasite id are obtained later, at Setup, via the provided authentication mechanism.

## 1 · Resolve the capability set

> **Targeting an existing site with an ambiguous brief? Read the site — don't guess.** When the
> run points at a site that already exists (connect/iterate, a funnel-created site) and an
> elevated credential is already available, one documented call returns the site's context —
> installed apps by name (including the Stores catalog version), status, URL,
> locale/currency/timezone, and CMS collections — as an agent-ready markdown report:
>
> ```bash
> curl -sS -X POST 'https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown' \
>   -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
>   -d "{\"siteId\": \"$SITE_ID\"}"
> ```
>
> Docs: <https://dev.wix.com/docs/api-reference/tools/dynamic-site-context/get-dynamic-context-markdown.md>
> (a JSON variant lives at the same path without `/markdown`). With an API key, send it raw as
> the `Authorization` header value, no `Bearer` prefix.
>
> The installed business apps map to the vertical set and seed `verticals[]` directly (CMS
> collections present → cms); inference below then only fills what the site can't answer
> (brand, per-capability intent). Several verticals installed → prioritize by the user's words
> and by which holds real (non-sample) content. Nothing relevant installed → **ask the user one
> short question** ("what do you offer — products, appointments, posts, events?") rather than
> defaulting to a store. This is the one case where Discovery may use the authentication
> mechanism early; with no credential at hand yet, skip it and infer from the words as below.

Read the **user intent** (+ optional project signals: `package.json` name, README, visible copy) against the vertical index in `references/CAPABILITIES.md` — each entry there carries the intent signals that point to it. Pick every vertical that genuinely fits → `verticals[]`. Multiple signals → multiple capabilities. On ambiguity, prefer the more specific vertical; if nothing dynamic is named, fall to the **forms** floor (a contact form). **Never return an empty set.**

Resolve to the skill's operational set — **stores · blog · cms · forms · events · bookings · pricing-plans · restaurants · portfolio** (`CAPABILITIES.md` § "Built verticals"). If intent points squarely at a vertical outside that set, note it plainly as not-yet-wired (per the index) and resolve the rest; don't force an unrelated capability in its place.

## 2 · Infer brand

A short brand object for seeded-content naming: `{ name, description, vibe? }`. Source from the intent text and any project signals (the package name, a README title/tagline, headline copy). If nothing is available, derive a neutral name from the project directory. This is only used to make seeded content read naturally — keep it light.

## 3 · Derive per-capability intent

For each capability, build its `intent.<cap>` block — the inputs the seed step translates into REST calls. Use sensible brand-appropriate defaults when the user didn't specify counts:

| Capability | `intent.<cap>` shape | Defaults when unspecified |
|---|---|---|
| stores | `{ productCount, categoriesNamed: [] }` | `productCount: 3`, `categoriesNamed: []` (no categories) |
| blog | `{ postCount, topics: [] }` | `postCount: 3`, topics derived from `brand.description` |
| cms | `{ collections: [{ name, purpose, itemCount, fields? }] }` | one collection inferred from intent, `itemCount: 5` |
| forms | `{ forms: [{ purpose, fields: [...] }] }` | one `contact` form: name, email, message |
| events | `{ eventCount, titles: [] }` | `eventCount: 2`, titles brand-derived, future dates |
| bookings | `{ serviceCount, servicesNamed: [] }` | `serviceCount: 2`, brand-derived service names |
| pricing-plans | `{ planCount, tiersNamed: [] }` | `planCount: 2` (e.g. Basic / Pro), monthly billing |
| restaurants | `{ menuName, sections: [{ name, itemCount }], ordering?, reservations?, experiences?: [{ name }] }` | one menu, 2 sections, `itemCount: 3` each; add-ons only when the brief names them. **`experiences[]`** = special dining occasions guests reserve (wine/cheese pairing, chef's table) — a restaurant *reservation that is an experience*, **not** the `bookings` vertical (see `CAPABILITIES.md`). |
| portfolio | `{ collections: [{ name }], projectCount }` | one brand-derived collection, `projectCount: 3` |

Counts are deliberately small (the seed shows the shape, not a full catalog).

## 4 · Imagery (opt-in)

Decide whether to generate AI images for seeded content (and, when building a frontend, for page surfaces). **Default: text-only** — seed without imagery; the user can add images later.

- If the prompt **signals imagery** ("with photos", "product photos", "AI images", "hero image"), opt in automatically.
- Otherwise **ask one question** — text-only (default) vs AI-generated images, noting it costs ~1 Wix AI credit per image. Default to off on no answer.

**If image generation is opted in, open `IMAGE_GENERATION.md` now.** It covers cost, the per-run cap, the themed-block fallback, and the generate→import→attach flow — everything the Seed and frontend-build steps need. Opening it here makes it available for the rest of the run without passing state forward.

## 5 · Hold the contract, proceed

Hold in scratch: `verticals[]`, `brand`, and `intent.<cap>` per capability. The metasite id (`SITE_ID`) and the token are obtained at Setup via the provided authentication mechanism. Then **continue to `SETUP.md`** and install the apps — this is the start of the actual work, not a separate decision. A brief plain-prose line stating what will be set up is fine.
