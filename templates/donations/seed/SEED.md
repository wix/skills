# Donations — seeding

Seed by **running `seed-donations.mjs` with a plan file** — don't hand-write the REST calls. The
script mints its own site token via the Wix CLI (logged-in session + `wix.config.json` required),
sets the site currency when the plan names one, installs the eCom platform and the Wix Donations app
if needed, creates the campaigns, verifies each reads back, then attaches cover images.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/donations/seed/seed-donations.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to one campaign** that exercises every
form branch: 3 preset amounts with impact text, one-time + monthly, a goal with an end date, a custom
amount with a minimum, the note and the cover-fee prompt on. A second campaign (say, without a goal)
only when the brief lists several causes. Every campaign gets a cover image — the default is an
`imagePrompt` (AI-generated, ~1 Wix AI credit per image, account-billed): brand-contextual — subject,
mood, palette, lighting — always ending "no text, no watermarks"; a real subject of the cause, not
abstract decoration. For an asset the user supplied use `imagePath` (a file on this machine) or
`imageUrl` (their own hosted URL; verify with `curl -sI` → 200) — never a stock or guessed URL.
Images resolve in parallel and never block the seed; a failed image leaves the campaign text-only.

```json
{
  "currency": "USD",
  "campaigns": [
    {
      "name": "Clean Water for Kibera",
      "frequencies": ["ONE_TIME", "MONTH"],
      "presets": [
        { "amount": "25", "impact": "Filters for one family" },
        { "amount": "50", "impact": "Filters for two families" },
        { "amount": "100" }
      ],
      "customAmount": { "enabled": true, "min": "5", "max": "10000" },
      "goal": { "target": "20000", "endDate": "2026-12-31T23:59:59Z", "acceptAfterGoal": true, "acceptAfterEndDate": false },
      "comments": true,
      "askCoverFee": true,
      "imagePrompt": "children filling water containers at a village well, warm evening light, documentary photo, no text, no watermarks"
    }
  ]
}
```

- `name` — 1–65 characters. The campaign has **no description field**: the story copy on the campaign
  page is the site's own text, written into the page, never seeded.
- `frequencies` — 1–4 of `ONE_TIME`, `WEEK`, `MONTH`, `YEAR` (default `["ONE_TIME"]`). The form shows a
  picker only when there is more than one.
- `presets` — up to 20 `{ amount, impact? }` (a bare `"25"` works too); `amount` a decimal string in the
  site currency, `impact` ≤ 200 chars — the line shown under the amount. With no presets the custom
  amount is enabled automatically (custom-only campaign).
- `customAmount` — `{ enabled, min?, max? }`; a missing limit means none. `enabled: false` needs ≥ 1 preset.
- `goal` — `{ target, endDate? (ISO), acceptAfterGoal? (default true), acceptAfterEndDate? (default false) }`.
  Omit for a campaign without a goal (no progress bar). With `acceptAfterGoal: false` the campaign
  closes at the target; with `acceptAfterEndDate: false` it closes at the deadline.
- `comments` — the donor note (default false). `askCoverFee` — the "cover the 2.9% fee" prompt (default false).
- `currency` — 3-letter ISO code at the top of the plan, set **only when the brief names one**: a
  sentence about currency, or an amount written with its unit ("$25", "€20"). Do **not** infer it from
  a language, a country, or an address. The seed sets the site to it before creating anything, because
  every amount is stored in the site currency at create time.

**Seeding is additive and idempotent** — a non-archived campaign with the same name is reused, not
duplicated; nothing is deleted or overwritten. Ask first if a cleanup seems needed.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For donations, each cause the user
lists is one campaign. Its name becomes `name`; listed amounts become `presets` (a sentence beside an
amount becomes its `impact`); "monthly" / "weekly" / "yearly" adds that frequency; a target becomes
`goal.target`; a deadline becomes `goal.endDate`; "let people write a message" sets `comments`. Their
images only (`imagePath` / `imageUrl`) — never an `imagePrompt` beside supplied content.

## What the seed cannot do — tell the owner

- **Completing a donation needs a premium plan and a connected payment method** (dashboard → Accept
  Payments). The seed creates campaigns on any site; the hosted checkout refuses the payment until
  then. Recurring frequencies additionally need a payment provider that supports recurring payments.
- The result JSON's `installed` field says whether each app install succeeded; a Donations install that
  is refused through the installer API is added from the dashboard's App Market instead.
- Cover images: the update's Image shape and field-mask requirement were inferred from the SDK, not
  seen live — a failed attach is listed under `imageErrors`; the owner adds the image in the dashboard.

## Escape hatch — individual functions
`setupDonations` composes exported steps — `installDonationsApps` (`installApp`), `createCampaigns`
(`createCampaign`, `findCampaignByName`, `getCampaign`), `setCampaignCoverImage`, `buildCampaign`,
plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page.
