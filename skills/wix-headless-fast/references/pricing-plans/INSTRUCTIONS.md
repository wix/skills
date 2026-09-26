# Pricing Plans — playbook

The plans machinery ships as files — plan reads (grid + by-slug), the hosted purchase redirect,
the purchase control, typed end-to-end. **The presentation is yours**: you design and implement
the plan card, the pricing grid, and the plan detail surface on the shipped hooks/DTOs, plus the
home page and the brand. You never write purchase logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro` and `styles/global.css`. Files you
**create** (skeletons below): your pricing grid and plan detail islands, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(plan.imageUrl, "50vw")} alt={plan.name} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath |
| `wix/pricing-plans/types.ts` | the DTOs (`PlanSummary`, `PlanDetail`) — contracts inlined below |
| `wix/pricing-plans/plans.ts` | `fetchPlans`, `fetchPlanBySlug` — the transport; the rules and DTO mappers are in `plans-core.ts` beside it (shared with the REST layer) |
| `wix/pricing-plans/purchase.ts` | `purchasePlan` — the hosted-checkout redirect session; its body lives in `purchase-core.ts` (shared with the REST layer) |
| `wix/pricing-plans/plans-store.ts` · `plan-purchase-store.ts` | the listing and purchase state machines, framework-free (`createPlansStore()`, `createPlanPurchaseStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/pricing-plans/usePlans.ts` | React binding of `plans-store.ts`: the plans listing — contract below |
| `hooks/pricing-plans/usePlanPurchase.ts` | React binding of `plan-purchase-store.ts`: the purchase action — contract below |
| `components/pricing-plans/SubscribeButton.tsx` | the purchase control for one plan — rendered only when `buyable`, label from the DTO ("Get this plan" free / "Subscribe"), "Redirecting…" in flight, the failure inline — **wire as-is** on every card, the detail page, a home strip (`<SubscribeButton plan={p} />`) |
| `components/pricing-plans/PlansView.tsx` (+ `PlanCard`) · `PlanDetailView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them (skeletons below) |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import). If another vertical is also deployed, its layout won — add a Plans nav link there |
| `pages/plans.astro` | SSR pricing grid — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/plans/[slug].astro` | SSR plan detail, a real 404 on a bad slug — **keep the frontmatter** (plain `<title>`/`<meta>` from the DTO: Pricing Plans has no owner-editable SEO item type); swap the island import |

## What you build — the design job

1. **The plan card + pricing grid** — your tier card (name, price + billing cadence, trial
   badge, perks list, the shipped `SubscribeButton`) and grid rhythm (a highlighted recommended
   tier is a classic), with skeletons while loading and an honest empty state — on `usePlans`.
2. **The plan detail surface** — the full pitch: price block, perks, terms & conditions
   (plain text — render pre-wrap), the shipped `SubscribeButton` (the plan itself arrives as an
   SSR-fetched DTO prop).
3. **The home page** — hero, a featured-plans strip (fetch in frontmatter → your components),
   brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### What a complete pricing site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
plans before designing (how many tiers, free/recurring/one-time mix, trials, perks, images).

- **Pricing page:** every public plan as a card in the first screen on desktop — name, price with
  its cadence, perks, the CTA; a free plan reads "Free" with no cadence; a recommended tier may be
  highlighted, never invented; loading (`plans === null`), empty, and error states look different.
- **Plan page:** name, price, cadence, the CTA in the first screen at 390px wide too; perks and
  terms after the CTA, never between the price and the action; a plan without an image renders no
  empty image box.
- **CTA:** the shipped `SubscribeButton` on every purchase surface — it disappears for a plan that
  isn't buyable (`assignedText` or nothing), and a free plan's label is not "Subscribe".
- **Copy:** nothing the merchant didn't supply — no invented savings, guarantees, or member counts;
  no Wix IDs or technical words in visible text.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

```ts
// PlanSummary (cards) — display-ready:
// { id, slug, name, description, price /* "€29.00" | "Free" */, free,
//   billing /* "per month" | "every 3 months" | "one-time" | "per month × 6" | "" (free) */,
//   freeTrialDays: number|null, perks: string[], buyable, imageUrl /* "" when none */ }
// PlanDetail adds: termsAndConditions (plain text; "" when not set).

// usePlans({ initialPlans? }) →
// { plans: PlanSummary[]|null /* null = loading → skeletons; [] after a failed load, with error */, error }

// usePlanPurchase() →
// { purchase(planId, { thankYouPageUrl?, postFlowUrl? }?): Promise<void>,
//     // resolves as the browser navigates to the Wix-hosted checkout;
//     // rejects with a visitor-facing message — surface it
//   purchasingId,   // plan id in flight (null when idle) — key the CTA spinner off it
//   error }
// <SubscribeButton plan={p} options? children? className? assignedText? /> wraps it: you only
// place it; it decides whether to render, what to say, and shows its own error.
```

### The islands you create — skeletons

The pages ship; the islands they mount are yours. Each island is a thin view over a hook. Hooks
first, branches after (an early return above a hook changes hook order between renders and React
throws). `client:load` islands render on the server too — render every state totally; nothing in
a render path may throw. The class names are the Astro/React spelling of layout rules that hold on
every stack; on a stack where the components don't deploy, keep the rule and write it in your CSS.

```tsx
// src/components/pricing-plans/PricingGrid.tsx — YOU build it; pages/plans.astro mounts it
// (swap its island import from PlansView to this).
import { usePlans } from "../../hooks/pricing-plans/usePlans";
import SubscribeButton from "./SubscribeButton";
import type { PlanSummary } from "../../wix/pricing-plans/types";

export default function PricingGrid(props: { initialPlans?: PlanSummary[] /* SSR prop — pass straight to usePlans; omitted in a SPA */ }) {
  const { plans, error } = usePlans(props);
  // …you implement the render:
  //   • error → a short inline message
  //   • plans === null → skeleton cards; [] → your honest empty state
  //   • else YOUR grid of YOUR cards (PlanSummary contract above): name, price on its own line
  //     with billing beside it (nothing beside "Free"), `${freeTrialDays}-day free trial` when not
  //     null, every perk, a link to `/plans/${p.slug}`, and <SubscribeButton plan={p} assignedText={null} />
  //     as the card's LAST ROW — the card root a flex column, the control pinned to the bottom
  //     (mt-auto) so CTAs share one baseline across the row; never a button inside the card's <a>.
  //   • the name WRAPS (`min-w-0`, `break-words`) — no truncation.
}
```

```tsx
// src/components/pricing-plans/PlanPitch.tsx — YOU build it; pages/plans/[slug].astro mounts it
// with the server-fetched plan (swap its island import from PlanDetailView to this).
import SubscribeButton from "./SubscribeButton";
import type { PlanDetail } from "../../wix/pricing-plans/types";

export default function PlanPitch({ plan }: { plan: PlanDetail }) {
  // …you implement the render, laid out for the brand: price + billing, the trial line, the
  // perks, <SubscribeButton plan={plan} /> right under the price (its label for a paid plan may
  // carry the price: `Subscribe · ${plan.price}` as children), then termsAndConditions pre-wrap.
  // Image via <img {...imgAttrs(plan.imageUrl, "(min-width: 768px) 50vw, 100vw")} /> only when
  // plan.imageUrl is non-empty — a bounded band on phones (`max-h-[40vh]`), not a full-screen hero.
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/pricing-plans/plans-store.ts`, `plan-purchase-store.ts`
— so you never rewrite them: create a store per surface, `subscribe`, render from `getState()`,
call its actions. Their `*State` interfaces are the render contract; read those. What you write is
the rendering — grid, card, plan page, the CTA — and for that read first:

1. `components/pricing-plans/SubscribeButton.tsx` — the purchase control as working code: the
   `buyable` gate and what shows instead, the free/paid label, the in-flight label, the inline
   error; the reference views place it as the last row of a card and under the price on the page.

Under `references/pricing-plans/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   other vertical's layout instead if both are deployed).
2. Write your islands under `src/components/pricing-plans/` per the skeletons (new names — don't
   overwrite the references), swap the island imports in `pages/plans.astro` and
   `pages/plans/[slug].astro`. Both islands: `client:load` with the SSR DTO props. Author your
   surfaces in as few messages as possible — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference file listed above before writing any surface.

`deploy.mjs pricing-plans --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts`
(the visitor client, configured with the public client id), `media.ts`, `money.ts`, and
`wix/pricing-plans/` — `plans.ts`, `purchase.ts`, `types.ts`, the `*-core.ts` rules, and the two
stores `plans-store.ts`, `plan-purchase-store.ts`. None of it is React. The hooks and components
don't ship on this stack; the stores replace the hooks, and you write the components in your
framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createPlansStore({ initialPlans? })` per listing (`start()`
  when mounted, `stop()` when unmounted), `createPlanPurchaseStore()` per purchase surface
  (`purchase(planId, options?)` navigates the document itself). State in, actions out — exactly
  the hooks' contracts above;
- your CTA to the `SubscribeButton.tsx` contract: rendered only when `buyable`, the DTO's label,
  disabled with "Redirecting…" while `purchasingId === plan.id`, `error` inline.

Routes `/plans`, `/plans/:slug` (via `fetchPlanBySlug`, null → your 404); dev server on 4321; a
static build goes through `npx @wix/cli@latest release` with `site.outputDirectory` pointing at the
build folder, an SSR build is hosted by you. Page title and meta description from the DTO's `name`
and `description` — plans carry no `seoData`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference file listed above before writing any surface.

`deploy.mjs pricing-plans --stack static --out site` put the REST layer in `site/js/wix/` (browser
ESM, the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `fetchPlans`, `fetchPlanBySlug` from
`./js/wix/plans.js`; `purchasePlan` from `./js/wix/purchase.js`. The state machines ship too:
`createPlansStore` from `./js/wix/plans-store.js` (the grid — `start()` once the page is up,
render from `getState()` in `subscribe`) and `createPlanPurchaseStore` from
`./js/wix/plan-purchase-store.js` (one per surface; its `purchase(planId)` sets `purchasingId`,
then navigates the document to the hosted checkout, or records `error`). No components ship — you
write the rendering in plain JS: one render function per surface that reads `getState()`, called
from `subscribe`, with the CTA calling `purchase`. Pages are `plans.html` and `plan.html?slug=…`
(Wix static hosting serves files, not directories — name the file and link to it); the plan page
reads the slug, `fetchPlanBySlug`, renders its not-found state on null, and sets `document.title`
and the meta description from the DTO's `name`/`description`. The visitor token persists in
`localStorage` on its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference file listed above before writing any surface.

Run `deploy.mjs pricing-plans --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the
server:** port `js/wix/plans.ts` and `plans-core.ts` to your language — the same two functions
returning the same DTO shapes as dicts (one POST with the literal body in the file), one anonymous
visitor token per process for these public reads (mint and refresh per `client.ts`) — and render
the grid and the plan page in your templates to the contracts above, so plan names and prices are
in the HTML; title and meta description from the DTO. **Purchasing in the browser:** the CTA on
`./js/wix/plan-purchase-store.js` (pass the plan id rendered into the page), exactly as the static
wiring above — the redirect session is created by the visitor's own token from the page, so the
server never handles per-visitor tokens. Routes stay `/plans`, `/plans/<slug>`. Add your public
https origin to the OAuth app's allowed domains before the hosted checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the reads, run at build time with one anonymous token; the generator emits `/plans` and one page
per slug from `fetchPlans()` (at most 100 public plans — one call). Run `deploy.mjs pricing-plans
--stack static --out <build dir>` so `js/wix/` is inside the output the pages import from, point
`site.outputDirectory` at that folder, `wix release`. Pages sit at different depths (`/`,
`/plans/…`): give the templates one base path to `js/wix/` (a template variable, or root-relative
`/js/wix/…`), never a relative `./js/wix/` — it breaks one level down. The frozen page is the
first paint; the CTA still runs client-side through `createPlanPurchaseStore()`. Close with the
live URL, the rebuild + release command, and one line for the owner: dashboard edits to plans
reach the site when that command runs; purchasing is live regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/plans` → your grid (`usePlans()` fetches client-side
when no `initialPlans` is passed); `/plans/:slug` → fetch with `fetchPlanBySlug(slug)`
client-side, then your detail surface (null → your not-found state). Deploy wrote the public
client id into `wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Purchase only through the shipped exports** — `SubscribeButton` / `usePlanPurchase` /
  `purchasePlan` own the hosted redirect session. Never hand-build a checkout URL, never call
  `orders.createOnlineOrder` (member-only, and it leaves payment unhandled), never mark
  anything paid.
- **Purchasing is members-only, and that's fine as-is**: the hosted flow handles member
  login/signup, the order form, and payment, then returns to your site. Don't build a login
  gate in front of the CTA.
- **No success theater.** Returning from checkout is NOT a success signal — `postFlowUrl` is
  hit on abandon too. Success arrives only at a `thankYouPageUrl` you pass, as
  `?planOrderId=<GUID>`; if you build a thank-you page, read that param — never fake a
  confirmation off the mere return.
- **Prices are display-only.** `price`/`billing` come pre-formatted; never compute a charge,
  discount, or proration — Wix settles price, tax, and schedule at the hosted checkout.
- **The CTA is the shipped `SubscribeButton`** — it alone decides to render (`buyable`) and what
  to say; a card never rebuilds that decision.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. No parallel theme files, no hardcoded palette values. Where they don't (`lib`, `static`, a
  port): style with whatever your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock plans, prices, or perks.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Out of scope (don't improvise these)

Member-gated surfaces — a "my plans" page, the member's orders (`orders.memberListOrders`),
cancel/pause flows, and booking a covered bookings service with a membership — require a
logged-in member session this skill doesn't ship yet. Subscribers manage their plan through
Wix's emails and hosted member flows. If the user asks for a member area, route to
`wix-headless` (members recipes) rather than shipping code that returns nothing for visitors.
Anything elevated (creating or editing plans) runs server-side per `references/shared/CUSTOM_OPERATIONS.md`.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`).

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Plans (purchases are a tab of this page) | `pricing-plans` |
| Create a plan | `pricing-plans/new` |
| Record a manual order | `pricing-plans/new-order` |
| Settings | `pricing-plans/settings` |

Editing a plan is reached from the list (no id path). Taking real payments needs a premium plan + a
connected payment method — mention it.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-pricing-plans.mjs` from the project
root. Seed a tier ladder that exercises the UI (a free tier, a monthly, a yearly or
one-time; 3–4 perks each).
