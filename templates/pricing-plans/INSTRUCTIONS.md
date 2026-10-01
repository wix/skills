# Pricing Plans — playbook

The plans machinery ships as files — plan reads (grid, by slug, by id), the hosted purchase
redirect, the purchase control, the plan-holders-only gate, typed end-to-end. **The presentation
is yours**: you design and implement the plan card, the pricing grid, and the plan detail surface
on the shipped hooks/DTOs, plus the home page and the brand. You never write purchase or access
logic; you never skip designing.

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
| `wix/pricing-plans/types.ts` | the DTOs (`PlanSummary`, `PlanDetail`, `PlanFee`) — contracts inlined below |
| `wix/pricing-plans/plans.ts` | `fetchPlans`, `fetchPlanBySlug`, `fetchPlansByIds`, `fetchPlanById` — the transport; the rules and DTO mappers are in `plans-core.ts` beside it (shared with the REST layer). A plan without a numeric price is malformed and never returned |
| `wix/pricing-plans/purchase.ts` | `purchasePlan` — the hosted-checkout redirect session; its body lives in `purchase-core.ts` (shared with the REST layer) |
| `wix/pricing-plans/plan-access.ts` | `hasActiveOrderFor(planIds, call?)` — does the CURRENT MEMBER hold an ACTIVE order for one of the plans (Member List Orders, member-only); the rule is in `plan-access-core.ts` beside it (shared with the REST layer). Needs the `members` vertical's session — see "Gated content" |
| `wix/pricing-plans/plans-store.ts` · `plan-purchase-store.ts` · `plan-access-store.ts` | the listing, purchase, and access state machines, framework-free (`createPlansStore()`, `createPlanPurchaseStore()`, `createPlanAccessStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/pricing-plans/usePlans.ts` | React binding of `plans-store.ts`: the plans listing — contract below |
| `hooks/pricing-plans/usePlanPurchase.ts` | React binding of `plan-purchase-store.ts`: the purchase action — contract below |
| `hooks/pricing-plans/usePlanAccess.ts` | React binding of `plan-access-store.ts`: `{ hasAccess, loading, error }` for a set of plans, fed the members session — contract below |
| `components/pricing-plans/SubscribeButton.tsx` | the purchase control for one plan — rendered only when `buyable`, label from the DTO ("Get this plan" free / "Subscribe"), "Redirecting…" in flight, the failure inline — **wire as-is** on every card, the detail page, a home strip (`<SubscribeButton plan={p} />`) |
| `components/pricing-plans/RequirePlan.tsx` | the gate for plan-holders-only content — neutral while unsettled, the way in for a visitor (login with `returnTo`), the way to `/plans` for a member without the plan, the content only on an ACTIVE order — **wire as-is** around gated content, with the members session as a prop (`client:only="react"` on Astro) |
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
  its cadence and validity (`duration`, when set), every fee right under the price, perks, the CTA;
  a free plan reads "Free" with no cadence; a recommended tier may be highlighted, never invented;
  loading (`plans === null`), empty, and error states look different.
- **Plan page:** name, price, cadence, fees, the CTA in the first screen at 390px wide too; fees
  sit between the price and the CTA (they are part of what checkout charges) and are never hidden;
  perks and terms after the CTA, never between the price and the action; a plan without an image
  renders no empty image box; the image is 16:9 — `imgAttrs(plan.imageUrl, sizes, PLAN_IMAGE_RATIO)`
  in a 16:9 band, never a square crop.
- **CTA:** the shipped `SubscribeButton` on every purchase surface — it disappears for a plan that
  isn't buyable (`assignedText` or nothing), and a free plan's label is not "Subscribe".
- **Copy:** nothing the merchant didn't supply — no invented savings, guarantees, or member counts;
  no Wix IDs or technical words in visible text.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

```ts
// PlanSummary (cards) — display-ready:
// { id, slug, name, description, pricingVariantId,
//   price /* "€29.00" | "Free" */, free,
//   billing /* the cadence only: "per month" | "every 3 months" | "one-time" | "" (free) */,
//   duration /* how long the plan stays valid: "6 months" | "1 year" | null = until canceled */,
//   fees /* [{ name: "Setup fee", amount: "€25.00" }] — charged with the first payment; [] when none */,
//   freeTrialDays: number|null, perks: string[], buyable, imageUrl /* 16:9; "" when none */ }
// PlanDetail adds: termsAndConditions (plain text; "" when not set).
// billing and duration are independent: "per month" + "6 months" (a 6-cycle plan), "one-time" +
// "1 month" (paid once, valid a month), "per month" + null (until canceled).
// A plan the API returns without a numeric price is malformed: it is dropped from every list
// (one console.warn) and null by slug/id — never rendered as "Free" with a live CTA.

// fetchPlans({ limit?, locale? }), fetchPlansByIds(ids, { locale? }), fetchPlanBySlug(slug, { locale? }),
// fetchPlanById(id, { locale? }) — `locale` (BCP 47) pins the money strings when the brief names a
// market; default = the runtime's locale (the server's under Astro SSR).

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

// usePlanAccess(planIds, session /* the members vertical's useMember(): { loggedIn, loading } */,
//               { initialAccess?, call? }?) →
// { hasAccess /* an ACTIVE order for one of planIds; false until proven */,
//   loading /* session or read unsettled — neutral state, never the fallback */, error }
// <RequirePlan planIds={[…]} session={useMember()} loginHref? plansHref? fallback? initialAccess? call?>
//   …gated content… </RequirePlan> wraps it: neutral while loading, login prompt for a visitor,
//   "See plans" for a member without the plan, the error inline, children only with access.
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
  //     with billing beside it (nothing beside "Free") and `valid ${duration}` when not null, one
  //     line per fee right under the price (`+ ${fee.amount} ${fee.name}`), `${freeTrialDays}-day
  //     free trial` when not null, every perk, a link to `/plans/${p.slug}`, and <SubscribeButton plan={p} assignedText={null} />
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
  // …you implement the render, laid out for the brand: price + billing (+ `valid ${duration}`),
  // one line per fee, the trial line, the perks, <SubscribeButton plan={plan} /> right under the
  // price block (its label for a paid plan may carry the price: `Subscribe · ${plan.price}` as
  // children), then termsAndConditions pre-wrap. Image via
  // <img {...imgAttrs(plan.imageUrl, "(min-width: 768px) 50vw, 100vw", PLAN_IMAGE_RATIO)} /> only when
  // plan.imageUrl is non-empty (PLAN_IMAGE_RATIO from wix/pricing-plans/plans-core — the DTO image
  // is 16:9) — a bounded band on phones (`max-h-[40vh]`), not a full-screen hero, not a square.
}
```

```tsx
// src/components/pricing-plans/MembersOnly.tsx — YOU build it, only when the brief gates content
// behind a plan AND the `members` vertical is deployed beside this one (it owns the session).
// Mount it client:only="react" (the session is a browser cookie) around the gated content.
import RequirePlan from "./RequirePlan";
import { useMember } from "../../hooks/members/useMember"; // the members vertical
import type { ReactNode } from "react";

export default function MembersOnly({ planIds, children }: { planIds: string[]; children: ReactNode }) {
  const session = useMember(); // hooks first — RequirePlan takes the session as a prop
  return <RequirePlan planIds={planIds} session={session}>{children}</RequirePlan>;
  // planIds: the ids of the plans that unlock this content — from the seed output or a
  // fetchPlans() in frontmatter (slug → id); never a guess. A React SPA over a manual client also
  // passes `call` (plan-access.ts explains) — the shared seam holds a visitor token there.
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
2. `components/pricing-plans/RequirePlan.tsx` — the gate as working code (only when the brief gates
   content): the four states and what each shows, and how the members session feeds the store.

Under `templates/pricing-plans/app/`.

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
`wix/pricing-plans/` — `plans.ts`, `purchase.ts`, `plan-access.ts`, `types.ts`, the `*-core.ts`
rules, and the stores `plans-store.ts`, `plan-purchase-store.ts`, `plan-access-store.ts`. None of
it is React. The hooks and components
don't ship on this stack; the stores replace the hooks, and you write the components in your
framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createPlansStore({ initialPlans? })` per listing (`start()`
  when mounted, `stop()` when unmounted), `createPlanPurchaseStore()` per purchase surface
  (`purchase(planId, options?)` navigates the document itself). State in, actions out — exactly
  the hooks' contracts above;
- your CTA to the `SubscribeButton.tsx` contract: rendered only when `buyable`, the DTO's label,
  disabled with "Redirecting…" while `purchasingId === plan.id`, `error` inline;
- gated content (members deployed too): `createPlanAccessStore({ planIds, call })` per gated
  surface, `check(session)` with the members store's `{ loggedIn, loading }` whenever it changes,
  render the four states of `RequirePlan.tsx`. `call` binds Member List Orders to the member's
  client (the shared client is a visitor here — plan-access.ts explains).

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
above, so the contracts on this page hold unchanged: `fetchPlans`, `fetchPlanBySlug`,
`fetchPlansByIds`, `fetchPlanById` from `./js/wix/plans.js`; `purchasePlan` from
`./js/wix/purchase.js`; `hasActiveOrderFor` from `./js/wix/plan-access.js`. The state machines ship
too: `createPlansStore` from `./js/wix/plans-store.js` (the grid — `start()` once the page is up,
render from `getState()` in `subscribe`), `createPlanPurchaseStore` from
`./js/wix/plan-purchase-store.js` (one per surface; its `purchase(planId)` sets `purchasingId`,
then navigates the document to the hosted checkout, or records `error`), and `createPlanAccessStore`
from `./js/wix/plan-access-store.js` (gated content, members deployed too: `check({ loggedIn:
loggedInHint(), loading: false })` with `loggedInHint` from `./js/wix/auth.js` — the token
`client.js` holds is the member's after its login, so `plan-access.js` needs no `call`). No components ship — you
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
- **Prices are display-only.** `price`/`billing`/`duration`/`fees` come pre-formatted; never
  compute a charge, a total with fees, a discount, or proration — Wix settles price, fees, tax, and
  schedule at the hosted checkout. Fees are shown with the price, never summed into it, never hidden.
- **Access is the shipped gate.** `RequirePlan` / `usePlanAccess` / `hasActiveOrderFor` decide
  access — an ACTIVE order for one of the plans, read for the logged-in member only. Never infer it
  from `loggedIn` alone, from a return URL, or from anything stored client-side.
- **The CTA is the shipped `SubscribeButton`** — it alone decides to render (`buyable`) and what
  to say; a card never rebuilds that decision.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. No parallel theme files, no hardcoded palette values. Where they don't (`lib`, `static`, a
  port): style with whatever your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock plans, prices, or perks.
- **Call every hook before any conditional return.** Hooks first, branches after.

## Why the purchase is `paidPlansCheckout`, not an eCom checkout

The shipped purchase creates a Pricing-Plans-native redirect session (`paidPlansCheckout: { planId }`):
one call, the plan's own hosted checkout (member login/signup, order form, payment), a success-only
`thankYouPageUrl` carrying `?planOrderId`, no eCom dependency. Wix's headless components take the
other road — an eCom checkout with one PLAN line item (`catalogItemId: plan.id`, `planOptions:
{ pricingVariantId }`) redirected through `ecomCheckout` — which is the right path only when a plan
must share one checkout with products (a cart holding a membership and a T-shirt). Both end on a
Wix-hosted checkout with coupons, notes, and login handled there. The DTO carries
`pricingVariantId` so the eCom path is reachable without touching the DTO if a brief needs it;
building it means `@wix/ecom` `checkout.createCheckout` plus a redirect session with
`ecomCheckout: { checkoutId }` — a new function beside `purchase.ts`, not a change to it.

## Gated content — requires the `members` vertical

A plan-holders-only surface (an article, a video, a members' schedule) is `RequirePlan` around the
content, with the session from the `members` vertical deployed beside this one: its custom login
writes the member tokens where the shared SDK seam reads them (the `wixSession` cookie on managed
Astro), so `hasActiveOrderFor` runs as the member with no extra wiring there. Without `members`
there is no session and nothing to gate on — don't ship a gate that returns nothing for everyone.
The plans that unlock content are ids (`planIds`), from the seed output or a slug lookup. Beyond the
gate stays out of scope: a "my plans" page, cancel/pause flows, booking a covered bookings service
with a membership — subscribers manage their plan through Wix's emails and hosted member flows.
Anything elevated (creating or editing plans) runs server-side per `templates/shared/CUSTOM_OPERATIONS.md`.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`).

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Plans (purchases are a tab of this page) | `pricing-plans` |
| Create a plan | `pricing-plans/new` |
| Record a manual order | `pricing-plans/new-order` |
| Settings | `pricing-plans/settings` |
| Accept payments — connect a payment method | `wix-cashier/payments` |
| Upgrade the plan — online payments need premium | full URL: `https://www.wix.com/upgrade/website?metaSiteId={siteId}` |

Editing a plan is reached from the list (no id path). Taking real payments needs a connected payment
method **and** a premium plan. Until both are done, a visitor who reaches hosted checkout sees **"We can't accept online payments. Contact us for help with your order."**
Hand both links above in the close; don't treat it as a code failure.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-pricing-plans.mjs` from the project
root. Seed a tier ladder that exercises the UI (a free tier, a monthly with `freeTrialDays`, a
yearly or one-time — with a `setupFee` when the brief names one; 3–4 perks each).
