# Discovery — infer, don't interview

The run starts here. **Infer** the Wix capability set, the brand, and per-capability intent from the user's words (and, optionally, the project on disk). Inference is just the first step — its output **drives Setup (install apps) and Seed (create content)**, which are the actual work; flow straight through into them. The host already has the user's buy-in to add Wix, so resolve everything from what's given and keep moving; when something isn't specified, use the defaults below.

Discovery is pure inference — it needs **no authentication** and is **agnostic to the project type**. The token and metasite id are obtained later, at Setup, via the provided authentication mechanism.

## 1 · Resolve the capability set

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
| restaurants | `{ menuName, sections: [{ name, itemCount }] }` | one menu, 2 sections, `itemCount: 3` each |
| portfolio | `{ collections: [{ name }], projectCount }` | one brand-derived collection, `projectCount: 3` |

Counts are deliberately small (the seed shows the shape, not a full catalog).

## 4 · Imagery (opt-in)

Resolve an `imagery` flag — whether to generate AI images for seeded content (and, when building a frontend, for page surfaces). **Default OFF** (text-only): seed with no imagery; the user can add images later.

- If the prompt **signals imagery** ("with photos", "product photos", "AI images", "hero image"), set `imagery: on`.
- Otherwise **ask one question** — text-only (default) vs AI-generated images, noting it costs ~1 Wix AI credit per image. Default to off on no answer.

**Bound the *cost*, not just the on/off decision.** `imagery: on` authorizes the *feature*, not unlimited *volume* — a single "imagery throughout" phrase can otherwise fan out to dozens of images (≈1 Wix AI credit each) with the spend never surfaced. So when imagery resolves on:

- **Surface the projected cost** in the brief pre-work line (§5): state the plan in credits — *"~N images ≈ N Wix AI credits"* — so the spend is visible even when nobody asked about volume. Always safe, no interactivity.
- **Apply a per-run image cap** (`imageCap`, default **~12**). Generate up to the cap; for surfaces/entities beyond it, render the **themed-block fallback** instead of generating (see below). Log what was capped so it's not silently dropped.
- **Confirm only when interactive *and* over the cap** — never a mandatory "always ask" gate. A non-interactive run honors the cap and fills the rest with themed blocks; it never stalls.

**Themed-block fallback (the not-generating path).** Whenever an image is *not* generated — imagery off, over the cap, declined, or a generation failure — a **frontend** image slot renders a **styled `div` that follows the site's own design tokens** (palette, radius, spacing, maybe a label or gradient), *not* an empty slot or a broken `<img>`. The layout stays intentional and on-brand at **zero credits**, and it's deterministic/headless-safe. (This applies to page surfaces; a *seeded entity* with no image simply stays text-only — `SEED.md` § "Entity images".)

When `imagery` is on, `SEED.md` attaches images to seeded entities and `IMAGE_GENERATION.md` is used for any page images a frontend build calls for (including the cap + themed-block mechanics). Hold `imageCap` alongside `imagery` in scratch. This flag is project-type-agnostic.

## 5 · Hold the contract, proceed

Hold in scratch: `verticals[]`, `brand`, `intent.<cap>` per capability, and `imagery`. The metasite id (`SITE_ID`) and the token are obtained at Setup via the provided authentication mechanism. Then **continue to `SETUP.md`** and install the apps — this is the start of the actual work, not a separate decision. A brief plain-prose line stating what will be set up is fine.
