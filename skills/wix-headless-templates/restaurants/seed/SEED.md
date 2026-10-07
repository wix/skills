# Restaurants — seeding

Seed by **running `seed-restaurants.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Restaurants apps, builds each menu bottom-up (modifiers → modifier
groups → variants → items → sections → menu, all visible), imports+attaches images, and
configures ordering/reservations.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/restaurants/seed/seed-restaurants.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to one menu with ~3 sections
of 2–3 items each** (the seed shows the shape; the owner adds the rest in the dashboard),
every item with an image (a menu without photos looks broken) — the default is an
`imagePrompt` (AI-generated, ~1 Wix AI credit per image, account-billed): brand-contextual —
subject, aesthetic/mood, palette, lighting — always ending "no text, no watermarks". At least one image in the set shows the real subject of the business — the actual product/space/service, not abstract decoration. For an asset the user actually
supplied use `imagePath` (a file on this machine — uploaded to Wix Media) or `imageUrl`
(their own hosted URL; verify it with `curl -sI` → 200) — never a stock-photo or guessed URL. Images resolve in parallel and never
block the seed, a failed image leaves that item text-only — and both add-ons on for a
restaurant that takes orders and reservations. Give at least one dish a choice (a `variants`
size, or a `modifierGroups` entry) when the restaurant takes orders, so the dish sheet is exercised:

```json
{
  "menus": [
    { "name": "Dinner", "description": "Evening menu", "sections": [
      { "name": "Antipasti", "description": "To start", "items": [
        { "name": "Bruschetta al Pomodoro", "description": "Grilled sourdough, San Marzano tomatoes, basil.",
          "price": 9.5, "imageUrl": "https://…" },
        { "name": "Burrata", "description": "Creamy burrata, heirloom tomatoes, olive oil.",
          "price": 14, "imageUrl": "https://…" }
      ] },
      { "name": "Mains", "items": [
        { "name": "Tagliatelle al Ragù", "description": "Slow-braised beef ragù, parmigiano.",
          "price": 22, "acceptSpecialRequests": true,
          "modifierGroups": [
            { "name": "Pasta", "required": true, "min": 1, "max": 1,
              "modifiers": [{ "name": "Tagliatelle", "preSelected": true }, { "name": "Pappardelle" }, { "name": "Gluten-free penne", "price": 2 }] },
            { "name": "Extras", "max": 3,
              "modifiers": [{ "name": "Extra parmigiano", "price": 1.5 }, { "name": "Chili flakes" }] }
          ],
          "imageUrl": "https://…" },
        { "name": "Branzino", "description": "Whole roasted sea bass, lemon, herbs.",
          "price": 28, "imageUrl": "https://…" }
      ] },
      { "name": "Pizze", "items": [
        { "name": "Margherita", "description": "San Marzano tomato, fior di latte, basil.",
          "variants": [{ "name": "Small", "price": 14 }, { "name": "Large", "price": 22 }], "imageUrl": "https://…" }
      ] },
      { "name": "Dolci", "items": [
        { "name": "Tiramisù", "description": "Espresso-soaked ladyfingers, mascarpone.",
          "price": 10, "imageUrl": "https://…" }
      ] }
    ] }
  ],
  "ordering": { "address": {
    "name": "Trattoria Lumina", "timeZone": "America/New_York",
    "address": { "country": "US", "subdivision": "US-NY", "city": "New York", "postalCode": "10012",
      "streetAddress": { "number": "18", "name": "Prince Street" },
      "formattedAddress": "18 Prince Street, New York, NY 10012" } } },
  "reservations": { "partySize": { "min": 1, "max": 10 } }
}
```

- `price` — a number; stored as a decimal string in the **site currency** (never send one per item).
  An item has `price` OR `variants` (each `{ name, price }` — "Small" / "Large"), never both; an
  item with neither renders as "Market price" and can't be ordered online.
- `modifierGroups` — per item: `{ name, required?, min?, max?, modifiers: [{ name, price?, preSelected?, inStock? }] }`.
  `required: true, min: 1, max: 1` is a single choice (radios); `max` alone is "choose up to";
  `price` is the up-charge (0 when omitted); `preSelected` picks the default. Modifiers and groups
  are created as their own entities and referenced by id.
- `acceptSpecialRequests` — `true` lets the visitor leave a note on that dish (sent on the cart line).
- `currency` — 3-letter ISO code at the top of the plan, set **only when the brief names one**: a
  sentence about currency, or a price written with its unit ("9 dollars", "$9", "€20"). Do **not**
  infer it from a language, a country, or an address. The seed sets the site to it before creating
  anything, because prices are stored in the site currency at create time; a new site starts in the
  currency of the account that created it, not the business's. The site's currency + locale are what
  every menu price is formatted with on the live site.
- `ordering` — installs the Orders app, which **auto-provisions** a working setup (ENABLED
  operation, Pickup + Delivery methods, every menu orderable); the seed verifies it. The
  `address` is **required for real ordering** — without one, ordering is "testing only" and
  checkout breaks. If the brief names no address, pass `"ordering": true` and the result
  carries a note to flag the owner. Completing a **paid** order additionally needs a premium
  plan + a connected payment method (dashboard) — mention it, don't treat it as a failure.
- `reservations` — installs Table Reservations, which auto-provisions a default reservation
  location; `partySize` (or a full `configuration` — e.g. `reservationForm` with
  `lastNameRequired`, `emailRequired`, `customFieldDefinitions`, or `onlineReservations.approval`)
  is a partial PATCH. The final **enable-online-reservations toggle is premium-only**: on a free
  site the result carries `reservations.premiumRequired: true` — expected, tell the owner, don't retry.
- **Seeding is strictly additive — the seed never deletes or overwrites anything on the site,
  and neither do you.** A fresh Menus install ships a sample "Dinner Menu" (about 4 sections and 21
  items) that the live menu page lists next to the seeded menus; the result's `preexistingMenus[]`
  names every menu the plan did not create (`{ id, name, sections, items }`) with `dashboardMenusUrl`,
  and the closing message says so, so the owner removes it there if they want to.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For a restaurant the user hands
over the menu, often as a PDF or a photo. Each menu becomes an entry in `menus`, each heading a
`section`, each dish an `item` with `name`, `description`, `price` (or `variants` when the menu
lists sizes) and, when they supplied one, its photo as `imageUrl`; a "choose your side" line
becomes a `modifierGroups` entry. The restaurant's address, hours and party sizes go into
`ordering` and `reservations` only when the user stated them; otherwise leave those out and say so.

## Escape hatch — individual functions
`setupRestaurants` composes exported steps — `installMenusApp`, `installOrdersApp`,
`installTableReservationsApp`, `readPreexistingMenus`, `createModifiers`, `createModifierGroups`,
`createVariants`, `itemBody`, `createMenu`, `importImage`, `attachItemImages`,
`setBusinessLocation`, `listOperationsWithRetry`, `enableOperation`,
`queryMenuOrderingSettings`, `updateMenuOrderingSettings`, `listReservationLocationsWithRetry`,
`updateReservationLocation`, `enableOnlineReservations`, plus `makeCtx()` — import them only
for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page.
