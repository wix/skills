# Discovery

Infer as much as possible from the user's opening message; ask only what's genuinely unknown. Target: **~1:30 of discovery** including user think-time.

## Step 0 — Infer Vertical(s) and Business Context

The user's opening message typically names what they want: *"build me a skincare store"*, *"I want to sell handmade jewelry"*, *"create a coffee shop website"*.

From the opening message, extract:
- **Vertical(s)** — which packs to load. See the routing table in `SKILL.md` § "When This Skill Triggers".
- **Business / product context** — feeds into brand-name suggestions, vibe options, product templates, image prompts.

If the opening message is too vague to infer a vertical (e.g., *"build me a site"*, *"I want to go online"*), ask **one conversational clarifier** (NOT an `AskUserQuestion`): *"What do you want your site to do — sell things, publish content, take bookings?"* One sentence. Only ask if you genuinely cannot infer.

**Do not ask the user what features they want.** Features are determined by the inferred vertical(s). The user reviews and adjusts the plan at Step 3.

---

## Step 1 — Brand Name

Use `AskUserQuestion` with a single-select question.

Generate **3–4 brand name suggestions** relevant to the business context, plus a "Type my own" option:

> *"What should we call your brand?"*

Options: [3–4 generated names], Type my own.

Guidelines for generated names:
- Short (1–3 words), memorable, relevant to the business context
- Mix styles: one punchy/modern, one descriptive, one abstract/evocative
- Avoid generic filler (*"Pro Store"*, *"Best Shop"*)

If the user picks *"Type my own"*, follow up conversationally: *"Sure — what should I call it?"*

If the user already named the brand in the opening message, skip this step.

### Background actions on Q1 answer

Immediately after the brand name is confirmed (before Q2), emit **one concurrent batch** containing both the scaffold dispatch AND prefetch reads of the shared contract docs. These reads cost nothing during Q2 + plan review wait time but save ~1 min of post-approval latency that prior runs spent reading these docs serially.

1. **Scaffold dispatch.** Derive the project slug from the brand, validate it, then run `bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<Brand>"` as a background shell. The script handles the npm-create invocation + slug pre-flight (regex `^[a-z0-9]{3,20}$`); the orchestrator handles slug derivation from the human-readable brand.

   **Slug derivation (apply to brand before invoking the script):**
   1. Lowercase
   2. Strip every char that isn't `[a-z0-9]` (drop hyphens, spaces, punctuation, accents — the Wix CLI rejects them)
   3. Truncate to 20 chars
   4. If the result is shorter than 3 chars, ask the user explicitly for a slug (`AskUserQuestion`)

   Examples: `"Acme-Co" → "acmeco"`; `"Sole Society" → "solesociety"`; `"E&E Co." → "eeco"`; `"AB" → ask the user`.

   The Wix CLI requires `[a-z0-9]{3,20}` — hyphens, underscores, uppercase, and other punctuation are rejected.

   **Pre-flight validation (orchestrator-side, before invoking the script).** Both must pass; if either fails, regenerate the slug or re-prompt the user — do NOT rely solely on the script's pre-flight (it'll exit non-zero, but that costs a round-trip):
   - `slug` matches `^[a-z0-9]{3,20}$`
   - `brand` is non-empty after trimming whitespace

   **The scaffold call (background shell, with timing capture):**

   ```bash
   STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   bash "<SKILL_ROOT>/scripts/scaffold.sh" "<slug>" "<brand>"
   ENDED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
   ```

   - Substitute `<brand>` with the user's confirmed brand (preserve original case; quotes are passed by the shell). Substitute `<slug>` with the validated slug.
   - The script pins `--site-template-id` to the pure-headless blank template (`212b41cb-0da6-4401-9c72-7c579e6477a2`). Vibe-compatible templates trigger an interactive prompt that blocks non-TTY runs — the template ID is intentionally hardcoded inside the script.
   - Append timing to `.wix/run.json.phases[]` as `{ phase: "scaffold", seconds: <duration>, started: $STARTED_AT, ended: $ENDED_AT }`.

   **Strict-then-recover:**
   1. Script exit 2 (slug or brand validation failed) → orchestrator-side bug; the orchestrator should have caught this in pre-flight. Fix the slug derivation and retry.
   2. Auth error from npm/Wix CLI → surface `"Run \`npx @wix/cli login\` and retry."` and stop.
   3. `invalid template` error → the template ID inside `scaffold.sh` is stale. Look up the current ID via `<prefix>SearchWixCLIDocumentation` query `create headless template`, edit the script's `TEMPLATE_ID` constant, retry once, log to `.wix/run.json.commandDrift[]` so the script can be tightened.
   4. Other errors → surface stderr to the user.

   Launch with background.

2. **Prefetch shared contracts** — siblings in the same concurrent batch (resolve `<SKILL_ROOT>` per SKILL.md § "Path resolution"):
   - `Read <SKILL_ROOT>/references/shared/RETURN_CONTRACT.md`
   - `Read <SKILL_ROOT>/references/shared/IMAGE_GENERATION.md`
   - `Read <SKILL_ROOT>/references/shared/MCP_PREFIX.md`

3. **Prefetch loaded pack files** — siblings in the same message:
   - `Read <SKILL_ROOT>/references/verticals/<pack>.md` for each loaded pack

Then continue to Q2. The scaffold runs during Q2 + plan review (~30–60s, usually finishes before approval); the reads resolve near-instantly and pre-load the docs the orchestrator needs at Step 3 and Step 7, eliminating mid-flow read churn.

**Do NOT also prefetch these docs after plan approval.** Reading them between plan approval and Step 3 adds ~1 min of user-visible wait with zero overlap to useful work.

---

## Step 2 — Vibe

Use `AskUserQuestion` with a single-select question. Generate **4 brand personality options** tailored to the inferred business context, plus "Something else":

> *"What's the vibe for [brand name]?"*

Example options for a jewelry store:
- **Bold & premium** — luxury feel, dark tones, sharp typography
- **Clean & modern** — minimal, lots of whitespace, crisp lines
- **Warm & approachable** — friendly, inviting, earthy tones
- **Something else** — let me describe it

If the user picks "Something else", follow up with `AskUserQuestion` using a text input.

### Craft the aesthetic direction (in session scratch)

Based on vertical + brand personality + audience, craft a **2–3 sentence aesthetic direction** like a designer would. Decide — don't ask more questions.

Example:
> *"For Bloom & Root, I'm going with an organic editorial aesthetic — think Kinfolk magazine meets a botanical garden. Warm cream backgrounds, deep forest green accents, Playfair Display for headings paired with Source Sans 3 for body text. Subtle leaf-pattern overlays and generous whitespace to let the products breathe."*

> **Do NOT print this aesthetic direction as a standalone message.** Hold it in session scratch and weave it into the plan (Step 3) as the opening **Design Direction** section. Printing it above the plan detaches the most emotionally important content from the rest. Keep Q2 → plan presentation tight.

---

## Step 3 — Present the Plan

Present the plan as formatted markdown. After presenting, use `AskUserQuestion` for approval.

> **Do NOT show implementation details.** Users do not want to read about scaffolding, `npm install`, `env pull`, MCP calls, phase agents, designer handoffs, sidecars, or build/preview steps. They care about their site. The TaskList conveys progress; the plan conveys outcome. Never open with SDK packages or CMS collection fields.

The plan is composed from the loaded vertical packs. Each pack contributes: apps, packages, pages, CMS collections, features blurbs. The skill assembles; the packs supply.

### Plan structure (in order)

The plan has TWO halves: a short **decision card** (Sections A + B — what the user actually weighs in on) and a longer **technical scope** block (Sections C + D + E — what comes "for free" from the loaded packs). The user reads A and B carefully; C–E are reference material they skim or skip.

> **Sections C, D, E are markdown tables.** Each section below leads with the exact header skeleton — copy it verbatim. Do NOT type column headers from memory: that's the root cause of every plan-format regression.

**Section A: Design Direction** — Lead with this. Open with the aesthetic paragraph crafted in Step 2, then a compact detail block:
- Aesthetic tone (e.g., "organic editorial")
- Color palette (2–3 dominant colors with hex codes)
- Typography pairing (display + body)
- Mood and key visual elements
- Page color strategy: Uniform Light / Uniform Dark / Defined Hybrid

**Section B: Features** — 1–2 line descriptions of user-facing functionality from each pack. Bullet list is correct here. Explain what the user's visitors will be able to do. Tag CMS-powered features with **(CMS-based)** so the user knows which content they can edit from the dashboard.

**Skip features from packs with `disabled: true`** (today: only `gift-cards`). Its surfaces are inactive by default — they light up only when the user enables the matching Wix app from the dashboard. The plan must not promise a feature that isn't active out of the box. The code still ships (the `/gift-cards` page file is created plus the nav/home contributions) so activation is instant once the user opts in — but the plan stays silent until then. Packs without `disabled: true` (including transitive ones like ecom) contribute their features normally.

→ **Verify B:** No bullet derives from a `disabled: true` pack. Today: no "Gift cards" bullet, no "(when enabled)" / "(auto)" markers anywhere in B.

> **Visual separator before the technical scope.** After Section B, emit a `---` rule and a single line: *"Technical scope below — auto-decided from the features above. Skim if you want; not required reading."* This signals to the user that the decision is essentially made and the rest is reference material. Without the cue, users feel obligated to read every table cell before approving and stall the build for tens of minutes.

---

**Section C: Pages.** Emit exactly this header, then one row per loaded pack's `routes:` entry:

```
| Page | Route | Source |
|------|-------|--------|
```

> **STOP if you typed anything else.** `| Route | Purpose |` (drops Source), `| Page | Route |` (no Source), bullet list `- **Cart** (/cart)`, or Source merged into Route (`/cart (Stores)`) — each is a known regression. **Three columns, exact names, in that order.** Re-read the skeleton above before typing rows; do not type column headers from memory.

**Compose rows from each loaded pack's `routes:` array.** Do not hardcode rows; do not omit declared rows; do not invent rows. For every loaded pack (top-level OR transitive via `requires:`), iterate its `routes:` array.

**Skip rule.** Skip every route from any pack with `disabled: true`. Today that's only `gift-cards` — its `/gift-cards` row does NOT appear in the plan. The page file still ships so the runtime probe lights up the surface the moment the user enables the Wix Gift Card app from the dashboard, but the plan must not promise a surface the user did not ask for. Surfacing it with a `Source: "Wix Stores (auto)"` marker has been tried and rejected — users push back ("Giftcard shouldn't appear unless the user asked for it").

Each surviving entry → one table row:

```
Page name (Page cell):
  - Use the entry's `name:` field if present (override).
  - Else derive from the route path:
      "/"               → "Home"
      "/<seg>/[slug]"   → title-case(seg, singular) + " Detail"
      otherwise         → title-case the last static segment, replacing
                          "-" with space  ("/thank-you" → "Thank You")

Route cell:
  - The entry's `route:` value verbatim (e.g. "/cart" — or the literal
    string "Hosted by Wix" for Wix-hosted endpoints with no path).

Source cell:
  - For top-level packs with non-empty `apps:`, use apps[0].name
    (e.g. "Wix Stores", "Wix Blog").
  - For transitive packs (loaded via another pack's `requires:`),
    walk up the requires chain to the top-level puller and use ITS
    apps[0].name. So ecom's "/cart" shows Source: "Wix Stores"
    (because stores requires ecom and the user opted into "selling
    things", not into "an ecommerce SDK").
  - For the `cms` pack, use the literal "CMS (builtin)".
  - No suffixes (no "(auto)", no "(passive)", etc.) — disabled packs
    don't contribute rows at all.
```

**Order rows by user-facing flow:** CMS pages first (Home, About, FAQ), then catalog/content pages, then transactional pages (cart, thank-you, checkout). Within a pack, preserve declaration order from the pack's `routes:` array.

→ **Verify C:** Header is exactly `| Page | Route | Source |`. Row count = sum of `routes:` entries across all loaded packs that are NOT `disabled: true`. Every Route is either a `/`-prefixed path matching the slugified Page name OR the literal `Hosted by Wix`. No "(auto)"/"(passive)" suffixes anywhere. No "Gift Cards" row when gift-cards loads transitively.

---

**Section D: CMS Collections.** Emit exactly this header, then one row per `cmsCollections:` entry from each loaded pack:

```
| Collection | Key Fields |
|------------|------------|
```

> **STOP if you typed `Fields` instead of `Key Fields`.** Re-read the skeleton above.

Iterate `cmsCollections:` from each loaded pack and emit one row per collection (collections from the `cms` pack always appear; other packs may declare their own).

→ **Verify D:** Header is exactly `| Collection | Key Fields |`.

---

**Section E: Apps & SDK Packages.** Last. Reference table for developer-minded users. Emit exactly this header, then **one row per loaded pack** (NOT one row per package):

```
| App | SDK Packages |
|-----|--------------|
```

> **STOP if you wrote one row per package.** `| Item | Type |` with `@wix/stores | SDK`, `@wix/ecom | SDK`, … is the wrong shape. Two columns, comma-joined packages in cell two, **one row per App**, not per SDK. Re-read the skeleton above.

**Compose Section E from loaded pack frontmatter:**

```
A pack contributes a Section E row iff:
  - Its `apps:` array is non-empty (top-level user-facing app), OR
  - Its `include: true` (the cms pack — built-in, no app to install).

The "App" cell:
  - For packs with non-empty `apps:`: apps[0].name (e.g. "Wix Stores").
  - For the cms pack: the literal "CMS (builtin)".

The "SDK Packages" cell:
  - This pack's `packages:` ∪ packages from every pack in its transitive
    `requires:` chain — deduped, in declared order.
  - So when stores is loaded (and pulls in ecom + gift-cards via requires),
    the "Wix Stores" row's SDK Packages cell is the union of stores +
    ecom + gift-cards packages — typically: @wix/stores, @wix/ecom,
    @wix/redirects, @wix/site, @wix/essentials.

Packs with `apps: []` AND `include: false` (ecom, gift-cards) do
NOT get their own row. Their packages roll up under whichever loaded
top-level pack pulled them in. There is no "@wix/gift-cards" SDK on
npm; the gift-cards pack is runtime-detected via REST and contributes
zero npm packages of its own.
```

→ **Verify E:** Header is exactly `| App | SDK Packages |`. One row per loaded pack with non-empty `apps:` OR `include: true`. SDK Packages cell is comma-joined within a single cell, NOT split across rows. No "Wix Gift Cards" row when gift-cards loads transitively (no `@wix/gift-cards` SDK exists).

### Example (skincare ecommerce brand)

```markdown
Here's my plan for **Bloom & Root**:

## Design Direction

For Bloom & Root, I'm going with **clean luxury with organic warmth** —
think a curated boutique where every product feels considered. Warm cream
backgrounds paired with deep charcoal text and rose gold accents. Cormorant
Garamond headlines bring editorial gravity; DM Sans keeps the body text
tactile and approachable.

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

## CMS Collections

| Collection     | Key Fields                  |
|----------------|-----------------------------|
| About Content  | heading, body, image        |
| FAQ            | question, answer, sortOrder |

## Apps & SDK Packages

| App           | SDK Packages                                                       |
|---------------|--------------------------------------------------------------------|
| Wix Stores    | @wix/stores, @wix/ecom, @wix/redirects, @wix/site, @wix/essentials |
| CMS (builtin) | @wix/data, @wix/essentials                                         |

Should I proceed?
```

The Cart, Thank You, and Checkout rows show `Source: Wix Stores` — not "Wix eCommerce" — because ecom is loaded transitively via stores's `requires:` and the orchestrator walks up the chain. The user opted into "selling things", not into "an ecommerce SDK".

### Final scan (MANDATORY)

Before sending the plan, confirm each inline → Verify above (B, C, D, E) passed. If any failed, regenerate that section and re-scan before emitting. Plans that violate multiple inline checks at once cost a full plan replay (~25 min of user time) when caught post-hoc. The inline → Verify lines exist to catch them before sending.

### Approval

Use `AskUserQuestion`: *"Ready to build?"* Options: **Yes, build it** / **Adjust something**.

If the user wants to adjust, handle it conversationally (swap brand, change vibe, add/remove a page). Re-present the plan and re-ask for approval.

---

## After Approval

Save the project context to memory (type: `project`) so future sessions can resume:
- Brand name, vertical(s) inferred
- Apps, packages, pages from the loaded packs
- Project name + absolute project directory
- Current phase: `scaffolding`

> **Do NOT narrate the internal sub-steps.** After approval, proceed silently through setup, launch phases, etc. The user tracks progress via TaskList — that's enough. No *"Now I'll install Wix Stores via MCP"*, no *"Launching Phase 1 agents"*, no MCP / sidecar / agent-name / `.wix/` leakage.

Brief transition messages are fine when major milestones complete (e.g., *"Products seeded, designing pages now"* or the final preview URL), but never surface tool-layer mechanics.

Proceed to **Setup** (see `SETUP.md`).
