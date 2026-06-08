# Discovery — infer, don't interview

The run starts here. **Infer** the Wix capability set, the brand, and per-capability intent from the user's words (and, optionally, the project on disk). Inference is just the first step — its output **drives Setup (install apps) and Seed (create content)**, which are the actual work; flow straight through into them. The host already has the user's buy-in to add Wix, so resolve everything from what's given and keep moving; when something isn't specified, use the defaults below.

## 0 · Pre-flight

Confirm the project has Wix connected: the `.env` carries `WIX_WIX_CLIENT_ID` / `WIX_WIX_CLIENT_SECRET` / `WIX_WIX_METASITE_ID` (or the plain `WIX_*` fallback). The cleanest check is to mint the token (`references/AUTHENTICATION.md` § "Minting the token"):

- **Mint succeeds** → continue.
- **Mint fails / creds absent** → Wix isn't connected in this project. **Stop with a clear error** ("Wix is not connected to this Stripe project — run `stripe projects add wix/*` first").

Hold `WIX_WIX_METASITE_ID` as `SITE_ID` in scratch.

## 1 · Resolve the capability set

Map the **user intent** (+ optional project signals: `package.json` name, README, visible copy) to `verticals[]` using `references/CAPABILITIES.md` § "Intent → capability resolution". Multiple signals → multiple capabilities. On ambiguity, pick the first matching row top-to-bottom; if nothing dynamic is named, fall to the **forms** floor (a contact form). Never return an empty set.

## 2 · Infer brand

A short brand object for seeded-content naming: `{ name, description, vibe? }`. Source from the intent text and any project signals (the package name, a README title/tagline, headline copy). If nothing is available, derive a neutral name from the project directory. This is only used to make seeded content read naturally — keep it light.

## 3 · Derive per-capability intent

For each capability, build its `intent.<cap>` block — the inputs the seed step translates into recipe calls. Use sensible brand-appropriate defaults when the user didn't specify counts:

| Capability | `intent.<cap>` shape | Defaults when unspecified |
|---|---|---|
| stores | `{ productCount, categoriesNamed: [] }` | `productCount: 3`, `categoriesNamed: []` (no categories) |
| blog | `{ postCount, topics: [] }` | `postCount: 3`, topics derived from `brand.description` |
| cms | `{ collections: [{ name, purpose, itemCount, fields? }] }` | one collection inferred from intent, `itemCount: 5` |
| forms | `{ forms: [{ purpose, fields: [...] }] }` | one `contact` form: name, email, message |

Counts are deliberately small (text-only seed; the host's app shows the shape, not a full catalog). Don't invent imagery — seed is text-only.

## 4 · Hold the contract, proceed

Hold in scratch: `SITE_ID`, `verticals[]`, `brand`, `intent.<cap>` per capability. Nothing is written to disk (there is no `wix.config.json` here). Then **continue to `SETUP.md`** and install the apps — this is the start of the actual work, not a separate decision. A brief plain-prose line stating what will be set up is fine.
