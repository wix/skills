# Discovery

Capture brand + vibe + imagery + the per-vertical intent inferred from the user's prompt, present a slim plan, get approval, write `.wix/site.json`, then chain into Setup.

Infer as much as possible from the user's opening message; ask only what's genuinely unknown. Target: **~1:30 of discovery** including user think-time, **≤ 80 s** excluding it.

> **Background work starts in Discovery; synchronization happens later.** Discovery dispatches `scripts/scaffold.sh` as a backgrounded shell as soon as Q1 returns, then continues with Q2/Q3 + plan composition while it runs. SETUP.md `wait`s on the captured `scaffold_handle` (Step 1) and later dispatches `npm install` as its own background handle (Step 4c). After Q2 (vibe captured) and the in-scratch aesthetic-direction craft, Discovery also dispatches the **Designer** subagent as `designer_handle` (Step 2.6 below) — its wall absorbs into Q3 + plan + approval + Setup + first half of Seed instead of being serialized into Wave 3. SEED.md Step 2 waits on `designer_handle` rather than dispatching it.

## Wave 0 — Mode detection (BEFORE any user-facing question)

Frontend mode is the single axis every downstream phase branches on. Detect it from the working directory **first** — before the CLI-auth pre-flight, before Q1 — so the rest of Discovery (and the background dispatches it fires) know which path to take. The detection is a file-existence check; cost is ~1 ms.

```
Inspect CWD:

1. CWD is empty (or doesn't exist) → SCAFFOLD MODE.
2. CWD contains `wix.config.json` AND Astro structure (`src/`, `astro.config.mjs`)
   → resume a prior wix-headless run. See SKILL.md § "When NOT to use this skill"
     ("continue or start fresh?" — out of pivot scope).
3. CWD contains `wix.config.json` AND a non-Astro frontend (e.g. `index.html` at
   root, `*.jsx`/`*.tsx`/`*.vue` files) → INTEGRATE MODE, already `init`'d.
     Jump to SETUP.md § "Existing project flow" § E2 (skip init).
4. CWD contains source files (`index.html`, `*.jsx`, `*.tsx`, `*.vue`,
   `package.json` from a non-Wix template, etc.) AND no `wix.config.json`
   → INTEGRATE MODE.
```

Capture the resolved value in session scratch as `frontend`:

| Scenario | `frontend` value | Wave 0 next |
|---|---|---|
| Scaffold mode, default | `astro` (provisional — Q1 may refine to `react-vite`) | Continue to Pre-flight below |
| Scaffold mode, prompt names Vite/React-only/SPA | `react-vite` (post-Q1 keyword scan, see § "After Q1") | Continue to Pre-flight below |
| Integrate mode (cases 3 & 4 above) | `user-provided` | Skip Q1/Q2/Q3 — see § "Integrate-mode short flow" below |

> **No `AskUserQuestion` for mode detection.** Per pivot decision #2 in PLAN-beta-frontend-pluggability.md, mode is detected, never asked. If the working directory is ambiguous, default to `user-provided` and let the parse-and-approve flow recover (the user can redirect conversationally).

`frontend` flows into three places:
- `scaffold.sh --frontend <value>` — Step 1 background dispatch (skipped entirely when `user-provided`; see § "Integrate-mode short flow").
- `init-site-json.mjs --frontend <value>` — "After Approval" § 2 (records it in the slim site.json snapshot).
- Orchestrator session scratch — every downstream branch reads the scratch value, not the file: SETUP routing (track selection), the frontend-track project-prep script (`seed-utilities.sh --template <astro|react-vite>`), and the SEED Layout-import bridge. (Business-track steps — app install, seeders — never read it.)

## Integrate-mode short flow (when `frontend === "user-provided"`)

Skip the standard Q1/Q2/Q3 interview. The user already designed the site — Discovery's job is to detect what's there and get a one-shot approval, not to interview the user about brand and vibe.

1. **Run the Pre-flight CLI-auth check** (next section). Integrate mode still needs a logged-in CLI for app installs + release.
2. **Parse the existing project** (light, time-boxed — cap at the top 5 source files by size). Pull:
   - Brand inferences: `<title>` tag, `<meta name="description">`, dominant colors from CSS, the H1 on `index.html`.
   - App signals: scan for the markers documented in `SETUP.md § Step E2` — `<form>` tags → forms; price tags / cart buttons → stores; article listings → blog; etc.
3. **Present a one-paragraph summary** in plain prose:
   > *"I see <N> HTML files in <project-dir>. The page looks like a <inferred type> for <inferred brand>. I'll install the matching Wix apps (<list>) and wire SDK calls into your existing source. The site stays exactly as you designed it; only behavior gets added. Continue?"*
4. **Approval via `AskUserQuestion`** — options: **Yes, connect it** / **Adjust apps**. If the user wants to adjust, handle conversationally (drop an app, add one, etc.) and re-present. The conversational adjust loop is the integrate-mode equivalent of "swap brand, change vibe" — keep it brief.
5. On approval, **skip the post-Q1 `scaffold.sh` dispatch** and the Step 2.6 Designer dispatch. Jump directly to "After Approval" § 2 to write `.wix/site.json` (with `frontend: "user-provided"`), then hand off to `SETUP.md § Existing project flow` (E1 init or E2 onward depending on whether `wix.config.json` is already present).

The Pages plan table, the Imagery line, the aesthetic-direction paragraph, the `designer_handle` dispatch, the `npm install` package set — **none of them apply** in integrate mode. The skill defers to the user's design.

---

## Pre-flight — Verify CLI auth (BEFORE any user-facing question)

The first Wix touch in this phase is the background `scaffold.sh` dispatched after Q1 — `npm create @wix/new@latest headless` creates a business + project against the user's Wix account, so it requires an active CLI session. Without one, the scaffold fails in the background and the failure doesn't surface until SETUP.md Step 1 — **after** Q1, Q2, Q2.5, Q3, plan, and approval. That's a ~5-minute interview the user has to redo. Run the auth check foreground here so a logged-out user sees the login prompt before any `AskUserQuestion`.

```bash
npx @wix/cli whoami >/dev/null 2>&1
```

- Exit 0 → continue to Step 0.
- Exit non-zero → **run `npx @wix/cli login` yourself with `run_in_background: true`** (do NOT instruct the user to run it). The exact shape:

  | Step | Action | Anti-pattern |
  |---|---|---|
  | 1 | `Bash` tool, command = `npx @wix/cli login`, `run_in_background: true`. **No shell `&`, no `mktemp` redirect, no chaining.** | `TMPFILE=$(mktemp …) && npx @wix/cli login > "$TMPFILE" 2>&1 &` — stacks shell `&` on harness `run_in_background`, splits wix-login output from the harness task file. |
  | 2 | The tool reply gives you the harness output-file path in `<bash-stdout>`. **`Read` that path** (or use `TaskOutput`). | Reading any other file. The harness path IS the right file. |
  | 3 | Parse line 1 of the file: `{"event":"awaiting_user","userCode":"…","verificationUri":"…"}`. (Node may emit a `TimeoutNaNWarning` on lines 3-5; ignore.) | Trying to re-invoke wix-login "to do it properly" after seeing the event. The event means it's working — surface and wait. |
  | 4 | Surface to user in one plain-prose message: *"Open `<verificationUri>` in your browser and enter the code `<userCode>` — I'll continue once you've completed the login."* | `AskUserQuestion`. The URL + code are text the user needs to copy, not a multiple-choice answer. |
  | 5 | Wait for the harness `task-notification` with `<status>completed</status>`. Run `whoami` once on completion to confirm. Then proceed to Step 0. | Polling `whoami` in a sleep loop while waiting. The notification is the only signal. |

  Do **not** punt to the user with *"Run `npx @wix/cli login` and retry"* and stop — that breaks the flow (the harness backgrounds the user-issued command, you don't know which output file to read, and the user has to manually prompt you to read it; ~60 s + interrupt of recovery wall). Full reference: [`shared/AUTHENTICATION.md`](shared/AUTHENTICATION.md#wix-login-from-a-non-interactive-agent).

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

### After Q1 — read loaded pack files AND dispatch background scaffold

Once the brand is confirmed, two things happen **in the same concurrent batch**:

**(a) Read every pack in the resolved set.** All `Read` calls as siblings in the same message. The full resolved set lives in SKILL.md § "When this skill triggers" (third column). For example, a `stores` run reads four files in one shot: `stores.md`, `cms.md`, `ecom.md`, `gift-cards.md`. Do **not** read the top-level pack alone, then discover its `requires:` and issue a second batch — that costs ~10 s of latency per run and is the most common discovery-phase regression.

- `Read <SKILL_ROOT>/references/verticals/<pack>.md` for each pack in the resolved set (resolve `<SKILL_ROOT>` per SKILL.md § "Path resolution")
- **Read individual `.md` files**, never the `verticals/` directory itself — `Read` against a directory returns `EISDIR` and forces a retry round-trip.

These reads resolve near-instantly and pre-load the `routes:`, `apps:`, `requires:`, and `disabled` fields needed to compose the Pages table at Step 3.

**(b) Dispatch the background scaffold.** A single backgrounded `Bash` invocation in the same batch:

```bash
bash <SKILL_ROOT>/scripts/scaffold.sh <slug> "<brand>" --frontend <frontend> 2> <tempfile>
```

`<frontend>` is the value captured in Wave 0:
- `astro` — current Beta default. Use this unless the user's opening prompt explicitly named Vite / React-only / SPA.
- `react-vite` — apply this keyword scan **once** before dispatching: if the opening message contains the case-insensitive substrings `"vite"`, `"react spa"`, `"react-only"`, or `"react only"`, set `frontend = "react-vite"`. Otherwise stay on `astro`. **Note:** `scaffold.sh` exits 4 on `react-vite` today (template not yet staged); when that happens, surface the error and fall back to `astro` for the same session — do not loop.

(Integrate mode never reaches this step — the Wave 0 short flow short-circuits before Q1.)

Capture the background handle as `scaffold_handle` and the path to `<tempfile>` (used by SETUP.md Step 1 if scaffold fails). The orchestrator does **not** block on this — Q2 + Q2.5 + plan composition continue immediately while scaffold runs. The wall-time win (pulling scaffold into Q&A think-time) is the reason Setup's foreground critical path stays under 25 s.

> **`npm install` is dispatched separately.** It does NOT chain behind scaffold here. SETUP.md Step 4c dispatches `npm install` as its own background handle (`npm_handle`), once scaffold is verified complete and we're `cd`'d into the project. Seed runs concurrent with the npm install tail; SEED.md Step 4 waits on `npm_handle` before merging results. Chaining the install behind scaffold here would force Seed to block on the install tail — splitting them is what lets Seed start the moment scaffold returns.

**Slug derivation:** lowercase the brand, then **STRIP every character not matching `[a-z0-9]` — do NOT replace them with hyphens or underscores**. Truncate to 20 chars. The `scaffold.sh` pre-flight enforces `^[a-z0-9]{3,20}$` and rejects anything else with exit 2; a rejected slug forces a redispatch and re-runs the ~30 s scaffold (the indie-bookshop-class regression).

   - Substitute `<brand>` with the user's confirmed brand (preserve original case; quotes are passed by the shell). Substitute `<slug>` with the validated slug.
   - The script passes bare `--site-template` so non-interactive scaffolding stays on the blank starter. Keep the new-site flow there unless the skill is explicitly redesigned around another scaffold.
   - Append timing to `.wix/run.json.phases[]` as `{ phase: "scaffold", seconds: <duration>, started: $STARTED_AT, ended: $ENDED_AT }`.

Correct (strip-and-concatenate):
- `"Bloom & Root"` → `"bloomroot"` (not `"bloom-and-root"`, not `"bloom-root"`)
- `"Page & Ember"` → `"pageember"` (not `"page-ember"`, not `"page-and-ember"`)
- `"ACME, Co."` → `"acmeco"`
- `"42 Below"` → `"42below"`
- `"Single-Origin Roasters"` → `"singleoriginroasters"` (cap at 20 → `"singleoriginroaster"` if truncation needed)

**Wrong** (kebab-case / snake-case): any slug containing `-`, `_`, or any other separator. The transformation is **strip**, not **replace** — there are no separators in a valid slug.

> **One concurrent batch.** Pack reads + bg scaffold dispatch go in the same message — two operations, fired as siblings. Adjacent narration ("Now reading packs:", "Dispatching scaffold:") closes the batch and serializes the dispatches across multiple turns.

Then continue to Q2.

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

---

## Step 2.5 — Imagery preference

Before crafting the aesthetic direction and presenting the plan, capture the user's imagery preference. Hold this `imagery` flag in orchestrator session scratch — it gates whether downstream phases generate AI imagery (Wix AI credits) or rely on CSS-only themed blocks. The flag is **not** persisted to `.wix/site.json`; the orchestrator inlines it into the prompts of any subagent that needs to branch on it (Image Phase 1 dispatch, Image Phase 2 gate).

**Skip rule.** If the user's opening prompt explicitly mentioned imagery — phrases like *"with photos"*, *"with images"*, *"AI imagery"*, *"product photos"*, *"with pictures"* — skip the Q3 `AskUserQuestion` call and default `imagery` to `"ai-generated"`. Re-asking would feel redundant ("you already said you wanted images"). The credit estimate (§ 2.5.1) and balance fetch (§ 2.5.2) still run so the captured intent has the right numbers for the plan's Imagery line — only the `AskUserQuestion` itself is skipped.

### 2.5.1 — Compute the credit estimate

In session scratch, compute `<estimatedCredits>` from the loaded packs and the per-vertical intent inferences (see "After Approval" § 1 for the inference rules — `productCount` defaults to 3, `postCount` defaults to 6).

```
estimatedCredits =
    1                                          // hero / home decorative
  + 2                                          // additional section decoratives
  + (cms loaded         ? 2                              : 0)   // /about + /faq hero images
  + (stores loaded      ? stores.productCount            : 0)   // default 3 when unknown
  + (blog loaded        ? blog.postCount                 : 0)   // default 6 when unknown
  + (forms loaded       ? 0                              : 0)   // forms never trigger imagery
  + (gift-cards loaded  ? 0                              : 0)   // disabled pack — skip
```

Packs with `disabled: true` contribute 0 regardless. The integer total is what we show. **Reuse** the `productCount=3` and `postCount=6` defaults from "After Approval" § 1 — do not invent new numbers.

Worked examples:
- Skincare (stores + cms, productCount=3, no blog): `1 + 2 + 2 + 3 + 0 + 0 + 0 = 8`.
- Coffee shop (stores + cms + blog, productCount=3, postCount=6): `1 + 2 + 2 + 3 + 6 + 0 + 0 = 14`.

### 2.5.2 — Fetch the AI-credit balance

`npx @wix/cli token` **without** `--site` mints an **account-scoped** token. With that token, the balance endpoint at `POST https://manage.wix.com/credit-transactions/v1/credit-transactions/get-account-balance` returns the current periodic credit balance + cap.

```bash
ACCOUNT_TOKEN=$(npx @wix/cli token)   # NO --site — mints account-scoped
curl -sS -X POST \
  -H "Authorization: Bearer $ACCOUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://manage.wix.com/credit-transactions/v1/credit-transactions/get-account-balance"
```

Successful response (HTTP 200):
```json
{
  "periodicCredits": { "balance": 250, "cap": 250 },
  "creditBalanceBreakdown": [
    { "subscriptionId": "…",
      "usageRules": [{ "period": "MONTH", "balance": 250, "cap": 250, "resetDate": "…" }] }
  ]
}
```

Hold `balance = response.periodicCredits.balance` and `cap = response.periodicCredits.cap` in scratch.

**Recovery / fallback (in order):**

1. **`wix token` (no `--site`) fails** — surface the error from the CLI; that is a `wix login` problem, not a balance-lookup problem. Set `balance = null` only after the CLI failure surfaces.
2. **POST returns 401/403** — token was minted but the account endpoint rejected it. Re-mint once and retry; if still 401/403, set `balance = null` and proceed.
3. **POST returns 4xx other than 401/403** — log the response in scratch (do not crash) and set `balance = null`. This includes the 400 you'd see if you accidentally GET the endpoint instead of POST: every prior revision of this section hit that and concluded the endpoint was broken. It isn't — it's POST-only.
4. **Network error / timeout** — set `balance = null`. The credit estimate (§ 2.5.1) is unaffected; only the Q3 description's *"Current balance: …"* tail goes silent.

> **Don't share the token across calls.** The account-scoped token is for account-level reads only (balance, account metadata). Every other site-operating call in this skill uses `npx @wix/cli token --site "$SITE_ID"` — site-scoped — per `references/shared/AUTHENTICATION.md`. Mix-ups have caused `403 SITE_TOKEN_REQUIRED` on Wix-site calls and `403 ACCOUNT_TOKEN_REQUIRED` on the balance call.

> **Historical note.** Earlier revisions of this section claimed the CLI did not expose an account-scoped token primitive, and the balance lookup was disabled unconditionally. Both claims were wrong — `wix token` without `--site` is exactly that primitive. The omission was paying ~1 informational line at Q3 plus losing visibility into whether the user had credits before opting into AI imagery.

### 2.5.3 — Ask Q3

Ask **Q3** via `AskUserQuestion` with two single-select options. Interpolate `<estimatedCredits>` (from § 2.5.1) and the balance (from § 2.5.2) into the AI-generated `description:` before issuing the call.

> *"How should we handle imagery?"*

Options:
- **Themed blocks (Recommended)** — `description:` *"Polished CSS-only design. ~6 min build. Uses 0 Wix AI credits."*
- **AI-generated imagery** — `description:` *"Bespoke images per product and section. ~10 min build. Uses ~<estimatedCredits> Wix AI credits (1 image = 1 credit). Current balance: <balance> / <cap>."*

If `balance === null`, drop the trailing *"Current balance: …"* sentence entirely (do not print *"Current balance: unknown"* — silence is the contract). The AI-generated option then reads: *"Bespoke images per product and section. ~10 min build. Uses ~<estimatedCredits> Wix AI credits (1 image = 1 credit)."*

→ **Verify Q3:** Themed blocks description ends `Uses 0 Wix AI credits.`. AI-generated description contains the substring `Uses ~<estimatedCredits> Wix AI credits (1 image = 1 credit).` (with `<estimatedCredits>` replaced by the integer). When balance is known, description also ends with `Current balance: <balance> / <cap>.`. When balance is unknown, description ends with `(1 image = 1 credit).` and no balance text follows.

Capture the answer as `imagery: "themed-blocks" | "ai-generated"` in session scratch.

> **AI-imagery dispatch gate.** The captured `imagery` value is consumed downstream: `SEED.md` Step 2 gates Image Phase 1 Decorative on `imagery === "ai-generated"`, and `ORCHESTRATION.md` Step 4.5 gates Image Phase 2 Entity on the same flag. On `"themed-blocks"` (the default) neither phase is dispatched — decorative slots render as designer-emitted color blocks, products carry placeholder media from the seed recipes, and the run saves ~300–500 s of wall + ~0.5–1.5 Wix AI credits compared to running images unconditionally. **This gate is what ensures images are generated only when `imagery === "ai-generated"`; without it, images would be generated on every run regardless of the flag.** Hold the `imagery` value in orchestrator session scratch; the gate logic reads it from scratch (not from `.wix/site.json`).

The captured `imagery` value lives in orchestrator session scratch (alongside the inferred per-vertical intent — see "After Approval" § 1). It is **not** written to `.wix/site.json`; subagents that need to branch on it receive it inlined in their prompts.

---

### Craft the aesthetic direction (in session scratch)

Based on vertical + brand personality + audience, craft a **2–3 sentence aesthetic direction** like a designer would. Decide — don't ask more questions.

Example:
> *"For Bloom & Root, I'm going with an organic editorial aesthetic — think Kinfolk magazine meets a botanical garden. Warm cream backgrounds, deep forest green accents, Playfair Display for headings paired with Source Sans 3 for body text. Subtle leaf-pattern overlays and generous whitespace to let the products breathe."*

> **Do NOT print this aesthetic direction as a standalone message.** Hold it in session scratch and weave it into the plan (Step 3) as the opening **Design Direction** section. Printing it above the plan detaches the most emotionally important content from the rest. Keep Q2 → plan presentation tight.

---

## Step 2.6 — Dispatch Designer (background)

Every Designer input is now in scratch:

- **Brand**: `{ name, description }` from Q1 (description = the user's opening business context, distilled to one line).
- **Aesthetic direction, color palette, typography, mood, page color strategy**: from the craft step above.
- **Loaded verticals**: the resolved pack set from Step 1's "After Q1" batch.
- **Packs with components**: derived from the loaded verticals — every pack whose `references/<pack>/INSTRUCTIONS.md` declares a `components` scope (today: `stores`, `ecom`, `blog`, `forms` when loaded; `cms` does NOT).
- **Disabled packs**: every pack in the loaded set whose frontmatter has `disabled: true` (today: only `gift-cards`).
- **Navigation links**: computed from pack frontmatter — include `/about` and `/faq` when `cms` is loaded; do NOT include `/products` (stores splices it via `<!-- nav:links -->` in Phase 4), `/gift-cards` (disabled), or any route whose pack contributes a nav-links marker. Worked example for stores+cms+ecom+gift-cards: `[{"href":"/about","label":"About"},{"href":"/faq","label":"FAQ"}]`.

**Dispatch as a backgrounded `Agent` call.** Capture the handle as `designer_handle`. SEED.md Step 2 waits on it and runs the post-Designer bridge (merge `designTokens`, emit derived CSS, verify Layout imports) when it returns. Designer's wall (180–270 s) absorbs into Q3 + plan + approval + Setup + the first part of Seed instead of stacking onto the run's critical path.

Use the **Default tier** model per SKILL.md § "Subagent model tier" — Designer is creative work.

### Prompt template (no `.wix/site.json` dependency)

`.wix/site.json` does not exist yet at this point in Discovery (`init-site-json.mjs` runs only after user approval), so the Designer cannot read brand + verticals from it. Pass every input inline — Designer's INSTRUCTIONS.md forbids reading `site.json` and takes every input from the prompt.

```
Instruction file (absolute path): <SKILL_ROOT>/references/designer/INSTRUCTIONS.md
Scope: design-system
Project directory (absolute path): <site-root>/<slug>  (the scaffold subdir — may still be in flight; Designer self-retries the pre-write Read of Layout.astro until scaffold writes it)
site-root: <site-root> (absolute path to the eval run dir)

Brand: { "name": "<Q1 brand>", "description": "<one-line business context>" }
Aesthetic direction: <2–3 sentences from the craft step>
Color palette: <hex codes>
Typography: { "display": "<font>", "body": "<font>" }
Mood: <personality / visual elements>
Page color strategy: <Uniform Light | Uniform Dark | Defined Hybrid>
Loaded verticals: <comma-joined list — e.g. "stores,ecom,cms,gift-cards">
Packs with components: <comma-joined subset — e.g. "stores,ecom">
Disabled packs: <comma-joined subset — e.g. "gift-cards">

Navigation links: <JSON array of {href, label}>

Auth: not required for design-system (frontend-only).

Do NOT read .wix/site.json — it is not yet written and brand/verticals are inlined above.
```

> **Scaffold race.** Designer is dispatched before `scaffold.sh` is guaranteed to be complete. Designer's first work (Self-Loading reads of reference docs under `<SKILL_ROOT>/`) does not touch the scaffold and absorbs ~5–10 s of scaffold tail. Its pre-write `Read src/layouts/Layout.astro` step (designer INSTRUCTIONS.md § "2. `src/layouts/Layout.astro`") retries when the file does not yet exist — see that section for the retry contract. The orchestrator does NOT wait on `scaffold_handle` here.

---

## Step 3 — Present the Plan

Present the plan as formatted markdown. After presenting, use `AskUserQuestion` for approval.

> **Do NOT show implementation details.** Users do not want to read about scaffolding, `npm install`, `env pull`, API calls, phase agents, designer handoffs, sidecars, or build/preview steps. They care about their site. The TaskList conveys progress; the plan conveys outcome. Never open with SDK packages or CMS collection fields.

The plan is composed from the loaded vertical packs. Each pack contributes: pages and features blurbs. The skill assembles; the packs supply. **Apps, packages, and CMS collection names are implementation details** — not surfaced in the plan; the loaded verticals determine apps to install and the seeder names CMS collections at run time.

### Plan structure (in order)

The plan has TWO halves: a short **decision card** (Sections A + B — what the user actually weighs in on) and a tighter **technical scope** block (Section C + Imagery line — what comes "for free" from the loaded packs). The user reads A and B carefully; C is reference material they skim or skip.

> **Section C is a markdown table.** It leads with the exact header skeleton — copy it verbatim. Do NOT type column headers from memory: that's the root cause of every plan-format regression.

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

**Imagery line.** A single line below Section C, not a table:

```
**Imagery:** Themed blocks
```

…or `**Imagery:** AI-generated (~<estimatedCredits> Wix AI credits)` when Q3 captured `ai-generated`, with `<estimatedCredits>` replaced by the integer computed in Step 2.5 § 2.5.1. Copy the imagery value from the captured preference; the credit count is the same number shown to the user at Q3. **Do not** repeat the current balance here — it was already shown at Q3, and re-printing it in Section C clutters the reference table the user skims.

→ **Verify Imagery:** Exactly one line. If themed: value is `Themed blocks`. If AI-generated: value matches `^AI-generated \(~\d+ Wix AI credits\)$`. No second line, no table, no other commentary.

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

**Imagery:** Themed blocks

Should I proceed?
```

The Cart, Thank You, and Checkout rows show `Source: Wix Stores` — not "Wix eCommerce" — because ecom is loaded transitively via stores's `requires:` and the orchestrator walks up the chain. The user opted into "selling things", not into "an ecommerce SDK".

### Final scan (MANDATORY)

Before sending the plan, confirm each inline → Verify above (B, C, Imagery) passed. If any failed, regenerate that section and re-scan before emitting. Plans that violate multiple inline checks at once cost a full plan replay (~25 min of user time) when caught post-hoc. The inline → Verify lines exist to catch them before sending.

### Approval

Use `AskUserQuestion`: *"Ready to build?"* Options: **Yes, build it** / **Adjust something**.

If the user wants to adjust, handle it conversationally (swap brand, change vibe, add/remove a page). Re-present the plan and re-ask for approval.

---

## After Approval — capture intent in scratch and chain into Setup

On the user's "Yes, build it" approval, hold the captured intent in orchestrator session scratch, write a slim `.wix/site.json` metadata snapshot, then chain directly into Setup. Setup synchronizes on the background scaffold dispatched after Q1, kicks off `npm install` as its own background handle, and installs the apps the loaded packs declare.

### 1 · Compose the intent block in session scratch

In session scratch, build a single JSON object carrying the captured imagery flag plus per-vertical hints inferred from the user's prompt. Only include blocks for verticals that were loaded. This stays in orchestrator memory for the rest of the run — it is **not** written to disk. Seeders receive the relevant `intent.<pack>` slice inlined in their prompts (see `SEED.md` Step 2).

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

Inference guidelines for each block:
- **`imagery`** — exactly the value captured at Step 2.5. If the user picked `"ai-generated"`, still pass `"ai-generated"` here; the AI-imagery fallback messaging happens in the user-facing summary, not in the captured intent.
- **`stores.productCount`** — number of products the user implied (e.g. *"a few candles"* → 3, *"a full catalog"* → 8). When unclear, default to 3.
- **`stores.categoriesNamed`** — strings the user explicitly named (*"a section for soaps and one for candles"* → `["Soaps", "Candles"]`). Empty array if none named.
- **`cms.collections`** — one entry per CMS-driven page: at minimum `{purpose: "about"}` and `{purpose: "faq"}` for any cms-loaded run. `itemCount` only when the user implied a number (*"a 5-question FAQ"* → `itemCount: 5`).
- **`blog.postCount`** — count the user implied; default to 6 when unclear. **`topics`** are explicit-only.
- **`forms.forms`** — one per form the user described; `purpose` is one of `contact`, `signup`, `lead`, etc.; `fields` are explicit only.
- **`gift-cards.enabled`** — `true` when the user explicitly asked for gift cards; `false` (or omit the block) otherwise.

When in doubt, omit a field rather than fabricate. The downstream phases that consume this block aren't built yet — overconfident inference can't be verified until then.

### 2 · Write the slim `.wix/site.json` snapshot

```bash
mkdir -p .wix
node "<SKILL_ROOT>/scripts/init-site-json.mjs" \
    "$(pwd)" "<brand name>" "<one-line aesthetic from Q2>" "<verticals-csv>" \
    --frontend "<frontend>"
```

- `<frontend>` is the value captured in Wave 0 (`astro` / `react-vite` / `user-provided`). Always pass it explicitly so the recorded JSON is unambiguous.
- `<verticals-csv>` is the comma-joined list of all loaded packs (top-level + transitive via `requires:`). For a stores+cms run this is `"stores,ecom,cms,gift-cards"`. In integrate mode, this is the comma-joined list of apps inferred from § "Integrate-mode short flow" Step 2.
- `<one-line aesthetic from Q2>` is the short aesthetic tone phrase, not the full 2–3 sentence direction.
- The script writes a slim `.wix/site.json` containing only `{brand, frontend, verticals}` (plus `siteId` / `appId` once Setup patches them in). It refuses to overwrite an existing file. If a stale site.json is present from a prior run, surface that to the user before retrying — do NOT silently `rm` it.
- The intent block from § 1 is **not** passed to the script — it lives in orchestrator scratch and feeds seeder prompts directly.
- **Trust the script's response.** A `{"status": "ok", "path": "..."}` return is the contract — do **not** follow up with a defensive `ls` + `Read` against `.wix/site.json` to confirm. Re-reading costs ~3s and adds nothing.

### 3 · Hand off to Setup

After `init-site-json.mjs` returns `{"status": "ok"}`, open `<SKILL_ROOT>/references/SETUP.md` and follow Steps 1–5. Setup verifies the background scaffold completed, captures `siteId` + `appId` from `wix.config.json` and (optionally) patches them into `.wix/site.json`, invokes the `wix-manage` skill, runs the apps + env-pull batch, and dispatches `npm install` as its own background handle that Seed waits on at the end.

Do **not** print a "Discovery complete" message between Discovery and Setup — Discovery, Setup, Seed, and post-seed orchestration are **one continuous flow** from the user's perspective until build/release finishes.

After Seed, the orchestrator prints a short seed-progress line, then continues into `ORCHESTRATION.md` (components → pages → build) without stopping. The Designer was dispatched in Discovery Step 2.6 — its `designer_handle` is waited on at the start of `SEED.md` Step 2 (the bridge — `merge designTokens` + `emit-design-tokens.mjs` + Layout-import verify — fires there). The **release URL + perf one-liner** come from `ORCHESTRATION.md` § "Final Message" — not from Seed.

Within Discovery, the only subagent dispatched is `designer_handle` (Step 2.6); every Wix API call belongs to Setup Step 4 (apps) or Seed Step 2 (per-pack seeders + Image Phase 1).
