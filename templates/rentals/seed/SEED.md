# Rentals — seeding

Seed by **running `seed-rentals.mjs` with a plan file** — don't hand-write the REST calls. The
script mints its own site token via the Wix CLI (logged-in session + `wix.config.json` required),
installs the Wix Rentals app if needed, creates the resource types and their resources, then the
rental services one at a time with every value that makes a Bookings service a rental, confirms the
duration range landed, and attaches images.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/rentals/seed/seed-rentals.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3–4 rentals** across one or two
resource types (the seed shows the shape; the owner adds the rest in the dashboard) and make them
exercise the UI: one hourly and one daily rental when the business allows it, a free or
approval-gated one where it fits, and an image per rental — the default is an `imagePrompt`
(AI-generated, ~1 Wix AI credit per image, account-billed): brand-contextual — subject,
aesthetic/mood, palette, lighting — always ending "no text, no watermarks". At least one image shows
the real thing being rented. For an asset the user actually supplied use `imagePath` (a file on this
machine — uploaded to Wix Media) or `imageUrl` (their own hosted URL; verify it with `curl -sI` →
200) — never a stock-photo or guessed URL. Images resolve in parallel and never block the seed.

```json
{
  "resourceTypes": [
    { "name": "Kayaks", "resources": ["Kayak 1", "Kayak 2", "Kayak 3"] },
    { "name": "Cabins", "resources": ["Lakeside cabin"] }
  ],
  "rentals": [
    { "name": "Single kayak", "tagLine": "Paddle the bay at your pace", "description": "…",
      "unit": "HOUR", "rate": 25, "min": 1, "max": 6, "resourceType": "Kayaks", "imagePrompt": "…" },
    { "name": "Lakeside cabin", "description": "…",
      "unit": "DAY", "rate": 180, "min": 2, "max": 7, "resourceType": "Cabins", "imagePrompt": "…" },
    { "name": "Life jacket", "description": "…", "unit": "HOUR", "free": true, "max": 8,
      "resourceType": "Kayaks", "resources": ["Kayak 1"], "imagePrompt": "…" }
  ]
}
```

- `resourceTypes` — the kinds of things rented (`name`, max 40 characters, unique per site) and
  the individual units in each (`resources`, by name). Two resources in a type mean two customers
  can rent in parallel. Resources are created **without working hours**: bookable around the
  clock, which keeps a multi-day rental to one booking. Opening hours are dashboard work — say so.
- `rentals` — one entry per rental service. `resourceType` names the type it rents from (every
  resource of that type unless `resources` narrows it). **The rate lives on the service**, so
  resources that rent at different prices are separate rentals sharing a type.
  - `unit` — `HOUR` or `DAY`, never both on one rental (a room by the hour AND by the day is two
    rentals). `min`/`max` are in that unit: hours from 0.5 to 24 (default 1 to 8), days from 1 to 8
    (default 1 to 5).
  - `rate` — a number per unit (per hour or per day); Wix multiplies it out at booking time. Omit
    it or set `free: true` for a no-fee rental (rents without a checkout, paid in person).
  - `requireManualApproval: true` — rentals are requests the owner approves (the CTA reads
    "Request to rent").
- `currency` — 3-letter ISO code at the top of the plan, set **only when the brief names one**: a
  sentence about currency, or a price written with its unit ("9 dollars", "$9", "€20"). Do **not**
  infer it from a language, a country, or an address. The seed sets the site to it before creating
  anything, because rates are stored in the site currency at create time; a new site starts in the
  currency of the account that created it, not the business's.

The result carries `durationRangeConfirmed` (the first rental re-read; `"HOUR"`/`"DAY"` means the
range landed, `null` means it was dropped and the rental would book as a fixed slot — stop and
read the create-service reference), the created rentals with their slugs, the resource types with
their resources, `errors` per rental, and `dashboardUrl`.

**Seeding is additive — never delete or overwrite existing content**; report what is there and
leave any cleanup to the owner.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For rentals, each thing the user
rents out is one entry. Its name becomes `name`; "per hour"/"per day" (or a price written that way)
becomes `unit` and `rate`; a stated shortest or longest rental becomes `min`/`max`; the number of
units they own becomes that type's `resources` (named "Kayak 1", "Kayak 2" when the user gives no
names); a group name ("boats", "rooms") becomes the `resourceType`. Their photo becomes `imageUrl`.
A rental with no unit is a question for the user.

## Escape hatch — individual functions
`setupRentals` composes exported steps — `installRentalsApp`, `createResourceTypes`,
`createResources`, `buildRental`, `createRental`, `confirmDurationRange`, `importImage`,
`attachRentalImage`, plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page. The Rentals model itself is four pages under
`https://dev.wix.com/docs/api-reference/business-solutions/rentals/`.
