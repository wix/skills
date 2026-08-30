# Restaurants — seeding

Seed by **running `seed-restaurants.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Restaurants apps, builds each menu bottom-up (items → sections →
menu, all visible), imports+attaches images, and configures ordering/reservations.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/restaurants/seed/seed-restaurants.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to one menu with ~3 sections
of 2–3 items each** (the seed shows the shape; the owner adds the rest in the dashboard),
every item with an image (a menu without photos looks broken) — the default is an
`imagePrompt` (AI-generated, ~1 Wix AI credit per image, account-billed): brand-contextual —
subject, aesthetic/mood, palette, lighting — always ending "no text, no watermarks". At least one image in the set shows the real subject of the business — the actual product/space/service, not abstract decoration. For an asset the user actually
supplied use `imagePath` (a file on this machine — uploaded to Wix Media) or `imageUrl`
(their own hosted URL; verify it with `curl -sI` → 200) — never a stock-photo or guessed URL. Images resolve in parallel and never
block the seed, a failed image leaves that item text-only — and both add-ons on for a
restaurant that takes orders and reservations:

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
          "price": 22, "imageUrl": "https://…" },
        { "name": "Branzino", "description": "Whole roasted sea bass, lemon, herbs.",
          "price": 28, "imageUrl": "https://…" }
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

- `price` — a number; stored as a decimal string in the **site currency** (never send one).
- `ordering` — installs the Orders app, which **auto-provisions** a working setup (ENABLED
  operation, Pickup + Delivery methods, every menu orderable); the seed verifies it. The
  `address` is **required for real ordering** — without one, ordering is "testing only" and
  checkout breaks. If the brief names no address, pass `"ordering": true` and the result
  carries a note to flag the owner. Completing a **paid** order additionally needs a premium
  plan + a connected payment method (dashboard) — mention it, don't treat it as a failure.
- `reservations` — installs Table Reservations, which auto-provisions a default reservation
  location; `partySize` (or a full `configuration`) is a partial PATCH. The final
  **enable-online-reservations toggle is premium-only**: on a free site the result carries
  `reservations.premiumRequired: true` — expected, tell the owner, don't retry.
- Fresh Menus installs ship a sample "Dinner Menu"; when THIS run installs the app the seed
  removes that sample (`sampleMenuRemoved: true`). On a site that already had the app,
  **seeding is strictly additive — never delete or overwrite existing content**; ask first
  if a cleanup seems needed.

## Escape hatch — individual functions
`setupRestaurants` composes exported steps — `installMenusApp`, `installOrdersApp`,
`installTableReservationsApp`, `removeSampleMenu`, `createMenu`, `importImage`,
`attachItemImages`, `setBusinessLocation`, `listOperationsWithRetry`, `enableOperation`,
`queryMenuOrderingSettings`, `updateMenuOrderingSettings`, `listReservationLocationsWithRetry`,
`updateReservationLocation`, `enableOnlineReservations`, plus `makeCtx()` — import them only
for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipes are `wix-headless/references/inline-recipes/setup-restaurants.md`,
`setup-restaurant-orders.md`, and `setup-restaurant-reservations.md`.
