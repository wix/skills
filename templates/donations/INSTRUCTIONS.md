# Donations — playbook

The donations machinery ships as files — campaign reads (list + by id, with goal progress), the exact
donation → hosted-checkout sequence, the donate form, the goal progress block, the thank-you island,
typed end-to-end. **The presentation is yours**: you design and implement the campaign card and the
campaigns index, the campaign page's layout around the shipped form, the home page and the brand. You
never write checkout logic; you never skip designing.

A donation is an eCom checkout with one line that references the campaign; Wix's hosted checkout takes
the payment and the donor's details, and the eCom order is the receipt. The campaign entity carries
**no description and no slug**: the story on a campaign page is the site's own copy, and routes key by
the campaign id (`/donate/<id>`).

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the story
copy on the campaign page. Files you **create** (skeletons below): your campaigns index island (or
Astro markup), your campaign page layout, and your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes, ratio)` — every `<img>` attribute for a DTO image: `<img {...imgAttrs(c.imageUrl, "50vw", 9 / 16)} alt={c.name} />`; `imgSrc()` / `imgSrcSet()` underneath |
| `wix/donations/types.ts` | the DTOs (`CampaignSummary`, `CampaignDetail`, `GoalProgress`, `DonationOptions`, `DonationReceipt`) — contracts inlined below |
| `wix/donations/campaigns.ts` | `fetchCampaigns`, `fetchCampaign(id)`, `fetchDefaultCampaign` — the transport; the rules and DTO mappers are in `donations-core.ts` beside it (shared with the REST layer) |
| `wix/donations/donate.ts` | `donationCheckoutUrl(campaignId, input)` — the checkout line + hosted redirect session; `fetchDonationReceipt(orderId)` — the thank-you page's order read; bodies in `donations-core.ts` |
| `wix/donations/donation-store.ts` · `campaigns-store.ts` · `receipt-store.ts` | the form, listing and receipt state machines, framework-free (`createDonationStore(campaign)`, `createCampaignsStore()`, `createReceiptStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/donations/useDonation.ts` | React binding of `donation-store.ts`: the donate form's state and actions — contract below |
| `hooks/donations/useCampaigns.ts` | React binding of `campaigns-store.ts`: the listing — contract below |
| `hooks/donations/useDonationReceipt.ts` | React binding of `receipt-store.ts`: reads `?orderId=` and the order — contract below |
| `components/donations/DonateForm.tsx` | the donate form for one campaign — frequency picker only when > 1 frequency, presets with impact text, "Other amount" only when enabled (min/max messages), the cover-fee checkbox with the computed 2.9% only when asked, the note only when enabled, the live "Donate $25 Monthly" label, "Redirecting…" in flight, errors after the first attempt, the closed state as `children` — **wire as-is** (`<DonateForm client:load campaign={campaign}>closing message</DonateForm>`) |
| `components/donations/GoalProgress.tsx` | raised of target, the bar at Wix's rounded percent, donation count, time left ("3 days left" / hours on the last day / "Ended") — renders nothing without a goal; no hooks, so it renders on the server — **wire as-is** on cards, the campaign page, a home strip (`compact` for cards) |
| `components/donations/DonationReceipt.tsx` | the hosted checkout's thank-you island — reads `?orderId=`, shows the order's facts only when the order could be read, an honest thank-you otherwise, a neutral page on a direct visit — **wire as-is** (`client:only="react"`) |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — shared across verticals). Everything, shipped and yours, styles from these tokens |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot + global.css import; it takes `image` for `og:image`). If another vertical is also deployed, its layout won — add a Donate nav link there |
| `components/donations/CampaignPage.astro` | **REFERENCE** campaign surface: cover, name, `story` prop, `GoalProgress`, `DonateForm` with the closed-state message — redesign it (it is mounted by both pages below); pass the campaign's story copy through `story` |
| `pages/donate/index.astro` | SSR campaigns index — **keep the frontmatter** (one campaign → renders `CampaignPage` directly, the Wix widget's default-campaign rule); the card markup is yours |
| `pages/donate/[id].astro` | SSR campaign page, a real 404 on a missing or archived id — **keep the frontmatter** (plain `<title>`/`<meta>`/`og:image` from the DTO: Donations has no owner-editable SEO item type, so campaign pages don't appear in the Wix SEO panel or sitemap) |
| `pages/donate/thank-you.astro` | the hosted checkout's return (`?orderId=`) — **keep the route**; the shipped redirect callbacks point at it |

## What you build — the design job

1. **The campaign card + campaigns index** — your tile (cover, name, the shipped `GoalProgress compact`,
   a Donate link; a closed campaign reads "Goal reached" / "Ended", never "Donate") and grid rhythm, an
   honest empty state. The index page ships with SSR data; render it in Astro markup or swap in an
   island on `useCampaigns`.
2. **The campaign page's layout** — cover, name, the story (your copy from the brief — the API has none),
   `GoalProgress`, and the shipped `DonateForm` as the giving column; design it for the brand (a
   sticky form column, an editorial split, a full-bleed cover). Donation logic never leaves the shipped
   component and hook.
3. **The home page** — hero, a featured campaign strip (`fetchCampaigns({ limit: 1 })` in frontmatter →
   name, `GoalProgress`, CTA to `/donate/<id>`), brand story.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### What a complete donations site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins where it differs. Look at the
campaigns before designing (how many, goals or not, frequencies, presets, images).

- **Campaign page:** the Donate CTA and the amount picker in the first screen at 390px wide; the
  frequency picker only when the campaign offers more than one frequency (the form decides); the
  custom amount only when enabled; the story after the form on phones, beside it on desktop.
- **Closed campaigns** (goal reached / expired): the progress and a closing message — never a Donate
  button. `DonateForm` renders your `children` then; the card shows the state, not a CTA.
- **Goal figures only from the DTO:** raised, target, percent, count, time left come from the metrics
  API and the owner's goal. A campaign without a goal shows no progress; a goal whose raised total
  couldn't be read shows the target alone.
- **Copy:** nothing the owner didn't supply — no donor counts beyond `donationCount`, no "tax
  deductible", no urgency the owner didn't set, no Wix IDs in visible text.
- **Thank-you page:** the shipped island's rules — thanks with the order's facts when they can be
  read, thanks without them otherwise, never "paid" unless the order says so.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

```ts
// CampaignSummary (cards, strips) — display-ready:
// { id, name, status /* "collecting" | "goalReached" | "expired" */, acceptsDonations,
//   imageUrl /* "" when none */,
//   goal: GoalProgress | null /* null = no goal */ }
// GoalProgress: { raised /* "$1,250" | "" when unreadable */, target /* "$20,000" */,
//   raisedAmount, targetAmount /* numbers for bar math only */, percent /* may exceed 100 */,
//   donationCount, reached, endDate /* ISO | null */, ended, lastDay, daysLeft, hoursLeft }
// CampaignDetail adds options: { currency /* "" when unknown */, presets: [{ amount, label, impact }],
//   customAmount: { enabled, min, max, minLabel, maxLabel }, frequencies: [{ value, label }],
//   askCoverFee, feeRate /* 0.029 */, commentsEnabled, commentMaxLength /* 100 */ }

// useCampaigns({ initialCampaigns? }) →
// { campaigns: CampaignSummary[]|null /* null = loading → skeletons; [] after a failed load, with error */, error }

// useDonation(campaign, { origin?, paths? }?) →
// { frequency, presetAmount, customMode, customAmount /* text */, coverFee, note,
//   amount, fee, feeLabel, total, totalLabel, buttonLabel /* "Donate $25 Monthly" */,
//   errors, messages /* per field, visitor-facing */, showErrors /* after the first attempt */, valid,
//   submitting, error, available /* campaign.acceptsDonations */,
//   selectPreset(n), selectCustom(), setCustomAmount(text), setFrequency(f), setCoverFee(b), setNote(s),
//   donate(): Promise<void> }  // resolves as the browser navigates to the hosted checkout (or with
//                              // messages showing); rejects with a visitor-facing message — surface it
// <DonateForm campaign={c} options? children? className? buttonClassName? /> wraps it: you only place
// it; it decides what to render, what to say, and shows its own errors.

// useDonationReceipt(orderId?) → { orderId /* "" on a direct visit */, loading, receipt: DonationReceipt|null }
// DonationReceipt: { orderNumber, donorFirstName, donorLastName, amount /* formatted */, paid, campaignId }
```

### The islands you create — skeletons

The pages ship; the surfaces they render are yours. Hooks first, branches after (an early return
above a hook changes hook order between renders and React throws). `client:load` islands render on
the server too — render every state totally; nothing in a render path may throw.

```tsx
// src/components/donations/CampaignsGrid.tsx — YOU build it when the index wants client state;
// pages/donate/index.astro can mount it with the SSR campaigns instead of its Astro card markup.
import { useCampaigns } from "../../hooks/donations/useCampaigns";
import GoalProgress from "./GoalProgress";
import type { CampaignSummary } from "../../wix/donations/types";

export default function CampaignsGrid(props: { initialCampaigns?: CampaignSummary[] /* SSR prop — pass straight to useCampaigns */ }) {
  const { campaigns, error } = useCampaigns(props);
  // …you implement the render:
  //   • error → a short inline message
  //   • campaigns === null → skeleton cards; [] → your honest empty state
  //   • else YOUR grid of YOUR cards: cover via imgAttrs(c.imageUrl, "33vw", 9 / 16) only when
  //     non-empty, the name (wraps — `min-w-0 break-words`), <GoalProgress goal={c.goal} compact />,
  //     a link to `/donate/${c.id}` reading "Donate" only when c.acceptsDonations ("Goal reached" /
  //     "Ended" otherwise) as the card's LAST ROW (`mt-auto`); never a button inside the card's <a>.
}
```

```astro
// src/components/donations/CampaignPage.astro — ships as a reference; REDESIGN it in place (both
// pages mount it). Keep: <GoalProgress goal={campaign.goal} /> and
// <DonateForm client:load campaign={campaign}>{closing message}</DonateForm>. Yours: the cover
// (a bounded band on phones — `max-h-[40vh]`, not a full-screen hero), the name, the story prop
// (your copy), the arrangement (the form in the first screen at 390px).
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state machines
behind the hooks do arrive — `wix/donations/donation-store.ts`, `campaigns-store.ts`,
`receipt-store.ts` — so you never rewrite them: create a store per surface, `subscribe`, render from
`getState()`, call its actions. Their `*State` interfaces are the render contract; read those. What
you write is the rendering — grid, card, campaign page, the form, the thank-you page — and for that
read first:

1. `components/donations/DonateForm.tsx` — the form as working code: which controls appear for which
   options, the preset/custom switch, the fee line, the note counter, when messages show, the
   in-flight label, the inline error, the closed state.
2. `components/donations/GoalProgress.tsx` — the progress block's text rules (`timeLeftLabel`).
3. `components/donations/DonationReceipt.tsx` — the thank-you page's three honest states.

Under `templates/donations/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the other
   vertical's layout instead if both are deployed).
2. Redesign `components/donations/CampaignPage.astro` around the two shipped components and pass the
   campaign's story through `story`; restyle the card markup in `pages/donate/index.astro` (or mount
   your `CampaignsGrid` there with `initialCampaigns`). Author your surfaces in as few messages as
   possible — batch multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs donations --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/donations/` —
`campaigns.ts`, `donate.ts`, `types.ts`, `donations-core.ts`, and the three stores. None of it is
React. The hooks and components don't ship on this stack; the stores replace the hooks, and you write
the components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createCampaignsStore({ initialCampaigns? })` per listing
  (`start()` when mounted, `stop()` when unmounted), `createDonationStore(campaign, { paths? })` per
  campaign surface (`donate()` navigates the document itself), `createReceiptStore()` on the thank-you
  page (`start()` once mounted). State in, actions out — exactly the hooks' contracts above;
- your form to the `DonateForm.tsx` contract: the controls the options allow, `buttonLabel` on the
  CTA, disabled with "Redirecting…" while `submitting`, `messages` once `showErrors`, `error` inline,
  the closed state when `available` is false.

Routes `/donate`, `/donate/:id` (via `fetchCampaign`, null → your 404), `/donate/thank-you`; dev server
on 4321; a static build goes through `npx @wix/cli@latest release` with `site.outputDirectory` pointing
at the build folder, an SSR build is hosted by you. Page title from the DTO's `name`; the description
is your copy — campaigns carry no `seoData`.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs donations --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` — pages,
styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project root
(config, plan, seed output) is never the upload. Same function names and DTOs as the table above, so
the contracts on this page hold unchanged: `fetchCampaigns`, `fetchCampaign` from
`./js/wix/campaigns.js`; `donationCheckoutUrl`, `fetchDonationReceipt` from `./js/wix/donate.js`. The
state machines ship too: `createCampaignsStore` from `./js/wix/campaigns-store.js`,
`createDonationStore` from `./js/wix/donation-store.js`, `createReceiptStore` from
`./js/wix/receipt-store.js`. No components ship — you write the rendering in plain JS: one render
function per surface that reads `getState()`, called from `subscribe`, with the CTA calling
`donate()`. Pages are `donate.html`, `campaign.html?id=…` and `thank-you.html` (Wix static hosting
serves files, not directories — name the file and link to it); pass
`createDonationStore(campaign, { paths: { thankYou: "/thank-you.html", campaign: "/campaign.html?id=" + id } })`
so the hosted checkout returns to your files; the campaign page reads the id, `fetchCampaign`, renders
its not-found state on null, and sets `document.title` from the DTO's `name`. The visitor token
persists in `localStorage` on its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs donations --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **Reads on the server:**
port `js/wix/campaigns.ts` and `donations-core.ts` to your language — the same functions returning
the same DTO shapes as dicts (the literal bodies are in the file), one anonymous visitor token per
process for these public reads (mint and refresh per `client.ts`) — and render the index and the
campaign page in your templates to the contracts above, so campaign names and goals are in the HTML.
**Donating in the browser:** the form on `./js/wix/donation-store.js` (pass the campaign DTO rendered
into the page as JSON), exactly as the static wiring above — the checkout and the redirect session are
created by the visitor's own token from the page, so the server never handles per-visitor tokens; the
thank-you page mounts `createReceiptStore()` the same way. Routes stay `/donate`, `/donate/<id>`,
`/donate/thank-you`. Add your public https origin to the OAuth app's allowed domains before the hosted
checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for the
reads, run at build time with one anonymous token; the generator emits `/donate` and one page per
campaign from `fetchCampaigns()` (at most 100 — one call). Goal progress is frozen at build time —
say so to the owner, or render `GoalProgress` client-side from a `fetchCampaign` on load. Run
`deploy.mjs donations --stack static --out <build dir>` so `js/wix/` is inside the output the pages
import from, point `site.outputDirectory` at that folder, `wix release`. Pages sit at different depths
(`/`, `/donate/…`): give the templates one base path to `js/wix/` (root-relative `/js/wix/…`), never a
relative `./js/wix/`. The frozen page is the first paint; the form still runs client-side through
`createDonationStore()`. Close with the live URL, the rebuild + release command, and one line for the
owner: dashboard edits to campaigns reach the site when that command runs; donating is live regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite plugins —
deploy added the dep). Routes: `/donate` → your grid (`useCampaigns()` fetches client-side when no
`initialCampaigns` is passed); `/donate/:id` → `fetchCampaign(id)` client-side, then your page around
`<DonateForm campaign={c} />` (null → your not-found state); `/donate/thank-you` → `<DonationReceipt />`.
Deploy wrote the public client id into `wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly —
hash routes, or one HTML file per route, decided before the first route is written; any URL handed to
Wix as a return target must be one the host serves (SKILL.md step 1) — pass it through `paths`.

## Hard rules

- **Donate only through the shipped exports** — `DonateForm` / `useDonation` / `donationCheckoutUrl`
  own the checkout line and the hosted redirect session. Never hand-build a checkout URL, never create
  an order, never mark anything paid.
- **Never promise a completed donation from the return URL.** `postFlowUrl` (the campaign page) is
  hit on abandon too; landing on `/donate/thank-you?orderId=` is the success redirect. The thank-you
  page reads the order when it can and degrades to a thank-you without order facts otherwise — never
  an invented amount, name or "paid".
- **Amounts are display-only.** `label`, `target`, `raised`, `amount` come pre-formatted from the API;
  the only computed money is the fee preview — Wix's fixed 2.9% — and the button total. Wix prices
  the line, tax and schedule at the hosted checkout.
- **No invented goal numbers.** Progress renders only from `goal`; a campaign without one has none.
- **The form is the shipped `DonateForm`** — it alone decides which controls appear (frequencies,
  presets, custom amount, fee, note) and when a campaign is closed; a page never rebuilds that.
- **The story copy is yours, the campaign data isn't.** The API has no description: write the cause's
  story from the brief; never fabricate figures, beneficiaries or urgency.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your markup
  uses Tailwind utilities on the same tokens — one design system across shipped and written code. No
  parallel theme files, no hardcoded palette values. Where they don't (`lib`, `static`, a port): style
  with whatever your stack does well, on one token set of your own.
- Live data or an honest empty state — never mock campaigns, amounts, or progress.
- **Call every hook before any conditional return.** Hooks first, branches after.
- **Browsing and donating need no login.** They run on the visitor session the shipped client already
  holds; don't gate campaigns behind sign-in.

## Out of scope (don't improvise these)

A donor's history or receipts page (member-only order reads), managing a recurring donation (Wix's
emails and hosted member flows do that), campaign creation or editing from the site (owner-only —
server-side per `templates/shared/CUSTOM_OPERATIONS.md`, or the dashboard). If the user asks for a
donor account area, deploy the `members` vertical beside this one rather than shipping code that
returns nothing for visitors.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`).

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Donations (campaigns, settings) | `app/333b456e-dd48-4d6b-b32b-9fd48d74e163` (redirects to the app's own route) |
| Orders — every donation is an eCom order | `ecom-platform/orders-list` |
| Accept payments — connect a payment method | `wix-cashier/payments` |
| Upgrade the plan — online payments need premium | full URL: `https://www.wix.com/upgrade/website?metaSiteId={siteId}` |

**Taking real donations needs a connected payment method plus a premium plan.** Until both are done, a visitor who reaches hosted checkout sees **"We can't accept online payments. Contact us for help with your order."** Recurring frequencies (`WEEK`/`MONTH`/`YEAR`) additionally need a
payment provider that supports recurring payments. Mention it; don't treat it as a code failure. The
cover-fee 2.9% is added to every recurring charge.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-donations.mjs` from the project root. Seed one
campaign that exercises every form branch (3 presets with impact text, one-time + monthly, a goal with
an end date, a custom amount with a minimum, note and cover-fee on, a cover image); a second campaign
only when the brief lists several causes.

## Caveats — verified against the SDK, not yet against a live site

The shipped code guards each of these, so a refusal degrades instead of breaking; confirm them on the
first real site and read the owning file if one bites.

- **Visitor reads.** Whether an anonymous visitor token may query campaigns and read `/metrics` is
  unverified. Metrics are caught per campaign: a refusal leaves `goal.raised` "" (the target still
  shows) and `options.currency` "" (the button reads "Donate" without an amount; preset labels still
  carry the API's own formatted amounts). If the campaign query itself is refused, the pages render
  their empty state.
- **Direct Create Checkout vs the Wix widget's cart route.** The default creates the checkout directly
  (a donation must never merge into a storefront visitor's cart); if the Donations catalog refuses to
  price that line, `donationCheckoutUrl` falls back to the widget's own Create Cart → Create Checkout
  (`channelType: OTHER_PLATFORM`), reachable by name as `createDonationCheckoutViaCart`. The cart route
  can answer `CURRENT_CART_ALREADY_EXISTS` for a visitor who already holds a cart — surfaced as the
  form's error.
- **Site currency.** Comes from the metrics response ("returns only the site's default currency");
  On a campaign nobody has donated to yet the metrics carry no currency either, so the transports read the site's currency once from the eCommerce settings (BUSINESS_INFO); unknown → "".
- **Reading the order on the thank-you page.** `GET /ecom/v1/orders/{id}` with the visitor's token is
  unverified; any failure → `receipt` null and the page thanks without order facts.
- **`orderId` spelling.** The redirect-session contract appends `orderId`; the Wix widget's own success
  URL uses `orderid`. Both are read.
- **Cover image update shape** (seed) — inferred from the SDK; a failed attach is reported, never fatal.
- **App installation** (seed) — installing Donations through the installer API, and whether it
  provisions eCom, is unverified; the seed installs both and reports each result.
- **Dashboard route.** The `app/<appDefId>` link redirects to the app's slug route; the slug itself
  was not resolved live.
- The `donorCoveringFees` option key and the fixed 2.9% come from the Wix widget's source, not a
  public reference page.
