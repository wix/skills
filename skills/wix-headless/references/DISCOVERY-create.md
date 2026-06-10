# Discovery — create operation

Reached when `operation === "create"` (a create-a-new-site prompt in an empty CWD — the skill writes the site). Shared Wave-0 field resolution + CLI-auth pre-flight live in `DISCOVERY.md`; this file is the create interview → plan → approval. Run FLOW is owned by `PLAN-create.md`.

Create has two framework branches (Wave 0 resolved which). The default is **`frontendBuild: wix`** (astro — the rest of this file). The minority **`frontendBuild: own`** (a framework SPA — the prompt named `vite`/`react`/`vue`/`svelte`) runs the interview + Designer but skips the astro-only steps — see § "Framework-SPA variant" at the end.

---

## Step 0 — Infer vertical(s) + business context

The opening message usually names what they want (*"build me a skincare store"*, *"a coffee shop website"*). Extract:
- **Vertical(s)** — which packs to load (routing table: `SKILL.md` § "When This Skill Triggers").
- **Business / product context** — feeds brand-name suggestions, vibe options, product templates, image prompts.

If too vague to infer a vertical (*"build me a site"*), ask **one conversational clarifier** (NOT `AskUserQuestion`): *"What do you want your site to do — sell things, publish content, take bookings?"* Only if you genuinely cannot infer. **Do not ask what features they want** — features follow from the vertical; the user adjusts at the plan.

---

## Step 1 — Brand name

`AskUserQuestion`, single-select. Generate **3–4 names** relevant to the business + a "Type my own" option:

> *"What should we call your brand?"*

Names: short (1–3 words), memorable, mixed styles (one punchy/modern, one descriptive, one abstract); avoid generic filler. If they pick "Type my own", follow up conversationally. **If the brand is already named in the opening message, skip this step.**

### After Q1 — read the loaded packs + prepare scaffold inputs

The scaffold is **not** dispatched here — it fires post-approval (`BUILD-astro.md` run-step 0) so the funnel presents the plan without waiting. This section only prepares inputs.

**(a) Read every pack in the resolved set, at once.** The resolved set is SKILL.md § "When this skill triggers" (third column) — e.g. a `stores` run reads `stores.md`, `cms.md`, `ecom.md`, `gift-cards.md`. `Read <SKILL_ROOT>/references/verticals/<pack>.md` for each (individual files — `Read` on the dir is `EISDIR`). Don't read the top-level pack alone then issue a second batch for its `requires:`. These preload `routes:`/`apps:`/`requires:`/`disabled` for the Step 3 plan.

**(b) Scaffold inputs** — the command (dispatched later):

```bash
bash <SKILL_ROOT>/scripts/scaffold.sh <folder-name> "<brand>" --frontend astro 2> <tempfile>
```

`<frontend>` is `astro` (the only scaffolded frontend; connect/own never reach here). **Folder-name derivation** from the brand: lowercase → whitespace/punctuation runs to `-` → drop every char not `[a-z0-9-]` → trim/collapse hyphens. Must satisfy `^[a-z0-9][a-z0-9-]*$` + npm package-name validation; if the result is empty, ask the user (`AskUserQuestion`) for a folder name.

- `<brand>` (original case) is sent as `--business-name` → owns the Wix project display name + URL slug. It must contain ≥1 English letter or number (CLI rejects emoji/punctuation-only — ask for a compliant brand before scaffolding).
- `<folder-name>` controls the local dir only.
- The script passes bare `--site-template` to stay on the blank starter non-interactively (without it `@wix/create-new` ≥0.0.72 prompts and aborts in the non-TTY shell).

Examples: `"Bloom & Root"` → `bloom-root` · `"ACME, Co."` → `acme-co` · `"42 Below"` → `42-below`.

---

## Step 2 — Vibe

`AskUserQuestion`, single-select. Generate **4 brand-personality options** tailored to the business + "Something else":

> *"What's the vibe for [brand name]?"*

(e.g. for jewelry: Bold & premium · Clean & modern · Warm & approachable · Something else.) If "Something else", follow up with an `AskUserQuestion` text input.

---

## Step 2.5 — Imagery preference

Capture `imagery` in scratch — it gates AI imagery (Wix AI credits) vs CSS themed blocks. Lives only in scratch; inlined into any subagent that branches on it.

**Skip rule.** If the opening prompt mentioned imagery (*"with photos"*, *"product photos"*, *"AI imagery"*, …), skip the Q3 `AskUserQuestion` and default `imagery: "ai-generated"` (re-asking feels redundant). The credit estimate + balance fetch still run for the plan's Imagery line.

### 2.5.1 — Credit estimate

```
estimatedCredits =
    1 (hero) + 2 (section decoratives) + (cms loaded ? 2 : 0)   // astro decorative term
  + (stores loaded ? stores.productCount : 0)   // default 3 when unknown
  + (blog loaded   ? blog.postCount      : 0)   // default 6 when unknown
  // forms, gift-cards, and any disabled pack contribute 0
```

The integer total is what we show. Reuse the `productCount=3` / `postCount=6` defaults from "After Approval" § 1. Example — astro coffee shop (stores + cms + blog, productCount 3, postCount 6): `1 + 2 + 2 + 3 + 6 = 14`. (The `own` decorative term differs — see § "Framework-SPA variant".)

### 2.5.2 — Fetch the AI-credit balance

`npx @wix/cli@latest token` **without** `--site` mints an **account-scoped** token; POST it to the balance endpoint:

```bash
ACCOUNT_TOKEN=$(npx @wix/cli@latest token)   # NO --site — account-scoped
curl -sS -X POST \
  -H "Authorization: Bearer $ACCOUNT_TOKEN" -H "Content-Type: application/json" -d '{}' \
  "https://manage.wix.com/credit-transactions/v1/credit-transactions/get-account-balance"
```

Hold `balance = response.periodicCredits.balance` and `cap = response.periodicCredits.cap`. **Fallbacks → set `balance = null` and proceed** (the estimate is unaffected; only the Q3 "Current balance" tail goes silent): `wix token` fails → surface it (a `wix login` problem); POST 401/403 → re-mint the account-scoped token once and retry (the site-scoped "never re-mint" rule does not apply — distinct cache); other 4xx / network error → log + `null`.

> **Don't share the token.** The account-scoped token is account-level reads only; every site-operating call uses `npx @wix/cli@latest token --site "$SITE_ID"` (`references/shared/AUTHENTICATION.md`). The two are mutually rejected.

### 2.5.3 — Ask Q3

`AskUserQuestion`, two single-select options; interpolate `<estimatedCredits>` + balance:

> *"How should we handle imagery?"*

- **Themed blocks (Recommended)** — *"Polished CSS-only design. ~6 min build. Uses 0 Wix AI credits."*
- **AI-generated imagery** — *"Bespoke images per product and section. ~10 min build. Uses ~\<estimatedCredits\> Wix AI credits (1 image = 1 credit). Current balance: \<balance\> / \<cap\>."*

If `balance === null`, drop the trailing *"Current balance: …"* sentence entirely (don't print "unknown" — silence is the contract). Capture `imagery: "themed-blocks" | "ai-generated"` in scratch (gates consumed by `BUILD-astro.md § "Imagery gates"`).

---

## Craft the aesthetic direction (in scratch)

From vertical + personality + audience, craft a **2–3 sentence aesthetic direction** like a designer — decide, don't ask more questions. Example: *"For Bloom & Root, an organic editorial aesthetic — Kinfolk meets a botanical garden. Warm cream backgrounds, deep forest green accents, Playfair Display + Source Sans 3, generous whitespace."* **Do NOT print it as a standalone message** — hold it in scratch and weave it into the plan's Design Direction (printing it separately detaches the most important content; keep Q2 → plan tight).

## The Designer's inputs

The Designer owns the design — it **authors `DESIGN.md`** (the tokens) and returns brand-voice strings; `emit-design-tokens.mjs` projects the token CSS + types from it. Inputs are **judgment-only**, produced here and held in scratch:
- **Brand** `{name, description}` (description = the opening business context, one line).
- **Aesthetic direction, palette, typography, mood, page color strategy** — from the craft step.

**Application inputs** (loaded packs, packs-with-components, disabled packs, nav links) are **not** passed to the Designer — they feed `compose.mjs` at the bridge (`BUILD-astro.md` § "2. Setup window"). Hold them in scratch. (Nav-links for stores+cms+ecom+gift-cards: `[{"href":"/about","label":"About"},{"href":"/faq","label":"FAQ"}]` — `/about`+`/faq` when `cms` loaded; never `/products` (stores splices it), `/gift-cards` (disabled), or any route whose pack contributes a nav marker.) The orchestrator dispatches the Designer **post-approval** (`BUILD-astro.md` run-step 0); its prompt template lives in `DESIGN_SYSTEM.md`.

---

## Step 3 — Present the plan

**Send the rendered plan as its own assistant message FIRST**, then — separately — use `AskUserQuestion` for approval. Never bundle the plan into the approval question, never replace it with a one-liner, never skip to "Ready to build?" — the user must see the rendered plan first.

**Do NOT show implementation details** (scaffolding, `npm install`, `env pull`, API calls, phase agents, designer handoffs, build steps). They care about their site. Apps, packages, and CMS collection names are implementation details — not surfaced; the loaded verticals determine apps, and the seeder names collections at run time.

The plan has two halves: a **decision card** (Sections A + B — what the user weighs in on) and a **technical scope** block (Section C + Imagery — "for free" from the loaded packs, skimmable).

**Section A — Design Direction** (lead): the aesthetic paragraph, then a compact block — aesthetic tone · palette (2–3 colors + hex) · type pairing (display + body) · mood/key visuals · page color strategy (Uniform Light / Uniform Dark / Defined Hybrid).

**Section B — Features**: 1–2 line bullets of user-facing functionality per pack; tag CMS-powered ones **(CMS-based)**. **Skip features from `disabled: true` packs** (today: `gift-cards`) — the code still ships (page + nav/home contributions) but the plan stays silent until the user enables the app. Non-disabled packs (incl. transitive ones like ecom) contribute normally.

After Section B, emit a `---` and one line: *"Technical scope below — auto-decided from the features above. Skim if you want; not required reading."*

**Section C — Pages.** Emit this header exactly, then one row per loaded pack's `routes:` entry:

```
| Page | Route | Source |
|------|-------|--------|
```

Compose rows from each loaded pack's `routes:` array (top-level + transitive via `requires:`) — don't hardcode, omit, or invent rows. **Skip every route from a `disabled: true` pack** (today `gift-cards`'s `/gift-cards` does not appear; the file still ships for instant dashboard activation). Per surviving entry:
- **Page** — the entry's `name:` if present, else derive from the path: `"/"`→`Home`; `"/<seg>/[slug]"`→title-case(seg, singular)+" Detail"; else title-case the last static segment, `-`→space (`/thank-you`→`Thank You`).
- **Route** — the `route:` value verbatim (or the literal `Hosted by Wix` for path-less Wix-hosted endpoints).
- **Source** — top-level pack with non-empty `apps:` → `apps[0].name`; transitive pack → walk up the `requires:` chain to the top-level puller's `apps[0].name` (so ecom's `/cart` shows `Wix Stores`); `cms` → literal `CMS (builtin)`. No `(auto)`/`(passive)` suffixes.

**Order rows by user-facing flow:** CMS pages first (Home, About, FAQ), then catalog/content, then transactional (cart, thank-you, checkout). Within a pack, preserve `routes:` declaration order.

**Imagery line** — one line below Section C: `**Imagery:** Themed blocks`, or `**Imagery:** AI-generated (~<estimatedCredits> Wix AI credits)` when Q3 captured `ai-generated`. Don't repeat the balance (shown at Q3).

### Example (skincare ecommerce)

```markdown
Here's my plan for **Bloom & Root**:

## Design Direction

For Bloom & Root, **clean luxury with organic warmth** — a curated boutique
where every product feels considered. Warm cream backgrounds, deep charcoal
text, rose gold accents. Cormorant Garamond headlines + DM Sans body.

- **Colors:** Warm cream (#FFF8F0), deep charcoal (#1A1A1A), rose gold (#B76E79)
- **Fonts:** Cormorant Garamond (headings) + DM Sans (body)
- **Mood:** Premium, approachable, tactile
- **Color strategy:** Uniform Light

## Features

- **Product catalog** — Browse all products with images, prices, and variants.
- **Cart & checkout** — Add to cart, review, check out via Wix's hosted checkout.
- **About (CMS-based)** — Brand story, editable from the Wix dashboard.
- **FAQ (CMS-based)** — Q&A about products, editable from the dashboard.

---

*Technical scope below — auto-decided from the features above. Skim if you want; not required reading.*

## Pages (8)

| Page           | Route             | Source        |
|----------------|-------------------|---------------|
| Home           | /                 | CMS (builtin) |
| About          | /about            | CMS (builtin) |
| FAQ            | /faq              | CMS (builtin) |
| Products       | /products         | Wix Stores    |
| Product Detail | /products/[slug]  | Wix Stores    |
| Cart           | /cart             | Wix Stores    |
| Thank You      | /thank-you        | Wix Stores    |
| Checkout       | Hosted by Wix     | Wix Stores    |

**Imagery:** Themed blocks

Should I proceed?
```

(Cart/Thank You/Checkout show `Wix Stores`, not "Wix eCommerce" — ecom is transitive via stores's `requires:`; the user opted into "selling things".)

### Approval

`AskUserQuestion`: *"Ready to build?"* — **Yes, build it** / **Adjust something**. If they adjust, handle it conversationally (swap brand, change vibe, add/remove a page), re-present the plan, re-ask.

---

## After Approval — capture intent in scratch

On "Yes, build it", hold the captured intent (brand, frontend, verticals, the per-vertical intent block) in scratch — **nothing is written to disk**. The transition into Setup is FLOW, owned by `PLAN-create.md` (which hands off to `BUILD-astro.md`).

Build a single intent JSON in scratch (only blocks for loaded verticals); seeders receive the relevant `intent.<pack>` slice inlined (`SEED.md` Step 2):

```json
{
  "imagery": "themed-blocks",
  "stores":     { "productCount": 3, "categoriesNamed": ["..."] },
  "cms":        { "collections": [{ "purpose": "about", "itemCount": 1 }] },
  "blog":       { "postCount": 6, "topics": ["..."] },
  "forms":      { "forms": [{ "purpose": "contact", "fields": ["..."] }] },
  "gift-cards": { "enabled": true }
}
```

Inference:
- **`imagery`** — exactly the Step 2.5 value.
- **`stores.productCount`** — implied count (*"a few candles"*→3, *"a full catalog"*→8); default 3. **`categoriesNamed`** — explicitly-named strings only; else `[]`.
- **`cms.collections`** — one per CMS-driven page (≥ `{purpose:"about"}` + `{purpose:"faq"}` for any cms run); `itemCount` only when a number was implied.
- **`blog.postCount`** — implied count, default 6; **`topics`** explicit-only.
- **`forms.forms`** — one per described form; `purpose` ∈ contact/signup/lead/…; `fields` explicit-only.
- **`gift-cards.enabled`** — `true` only when explicitly asked; else omit.

When in doubt, omit a field rather than fabricate. Discovery's domain work ends here — nothing on disk; `PLAN-create.md` owns the handoff.

---

## Framework-SPA variant (`frontendBuild: own`)

When Wave 0 resolved `frontend: custom`, `frontendBuild: own` (an explicit framework keyword on a create prompt): run the **vibe (Step 2)**, the **imagery question (Step 2.5)**, and the **Designer** — its `DESIGN.md` + `.wix/design-tokens.css` are framework-agnostic, so the brand look is real here too, and both image phases apply (decoratives land in the SPA hero/about via `src/decorative-images.json`; entity images PATCH Wix entities). **Skip the astro-only steps:** no `scaffold.sh`, no astro Design-Direction card / Pages table, no `compose.mjs`.

- **Infer** brand + vertical/capability (same routing as astro) + the named framework (vite+react / vue / svelte).
- **Plan** (its own message, then approve — same discipline as `DISCOVERY-connect.md` § 3): *what I'll build* (a small \<framework\> app with the brand's look — palette + type as CSS custom properties; full per-component composition is framework-default for now) + an **`Imagery:`** line + *what I'll connect* (capability → its Wix backend) + the apps. For a client-state capability, state the **shared-data caveat** up front.
- **Credit estimate decorative term** is `1 (hero) + 1 (about) = 2, fixed` (the minimal SPA emits exactly `["hero","about"]`, no `/about`+`/faq` route headers — drop the cms `+2`). Example — bakery in react+vite (cms + stores, productCount 3): `2 + 3 = 5`.
- **On approval** hold the contract in scratch (`frontend: custom`, `frontendBuild: own`) → `BUILD.md` routes on `frontendBuild: own` → `BUILD-own-build.md` (create × own: Designer + `emit-design-tokens.mjs` → scaffold the framework → `init` → generate the minimal app importing `.wix/design-tokens.css` → wire a fresh `@wix/data` module → the project's own build + release).
