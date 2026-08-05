---
name: "Setup Restaurant Reservations"
description: Configures Wix **Table Reservations**. Installing the app AUTO-provisions a default reservation location with a full config (approval AUTOMATIC, party size, weekly schedule, tables) — but with online reservations turned OFF. This recipe VERIFIES that location, CUSTOMIZES its config to the request, and TURNS ON online reservations (premium-gated). There is nothing to bulk-seed and no menu dependency. Specifies the *how* (calls + format); party sizes / hours come from the request.
---
**RECIPE**: Business Recipe – Table-Reservations Setup for Wix Restaurants (Table Reservations app)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` **and** `wix-site-id: <SITE_ID>`. Body-bearing requests also need `Content-Type: application/json`.

A checklist for turning on **table reservations** for a Wix site.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial reservations setup.

> **⚠️ Reservations is CONFIGURATION, not creation — there is NOTHING to bulk-seed.** Reservations themselves are created by **visitors at runtime** (the frontend flow), not at setup. And a **reservation location CANNOT be created via this API** — the docs are explicit: locations are "created and archived only through the Dashboard, or the Locations API." The Reservation Locations API only **queries / lists / updates**. So "setup" here means: verify the location the install already made, configure it, and switch online reservations on.

> **⚠️ THE INSTALL AUTO-provisions a default reservation location — this recipe VERIFIES and CONFIGURES it.** Installing the Table Reservations app auto-creates **one reservation location** (`default: true`) with its own `location` object and a **complete default configuration** — `approval.mode: "AUTOMATIC"` (manual approval already OFF), `partySize {min:1, max:6}`, `minimumReservationNotice 30 MINUTES`, `defaultTurnoverTime 90`, a 7-day `businessSchedule` (08:00–22:00), `timeSlotInterval 15`, and table management ON with default tables. **The one thing OFF is `onlineReservationsEnabled: false`** — flipping it on is STEP 3.

> **⚠️ NO menu dependency.** Reservations bind to a **location**, not a menu (unlike online ordering, which is menu-first). Do **not** copy the orders "seed the menu first" constraint — reservations can be set up with no menu at all.

> **This recipe is the *how*, not the *what*.** Party-size limits, business hours, turnover time, and reservation-notice come from the request you're fulfilling. This recipe only specifies the calls and the request format. Per the "simple seeds" default, if the request names no reservation specifics, keep the auto-provisioned config and just do STEP 1 + STEP 3.

> **API surface:** the **Reservation Locations** API on `https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations` (list `GET`, query `POST …/query`, get `GET …/{id}`, update `PATCH …/{id}`). The frontend visitor flow (time slots, held/reserve) is a separate concern — see `how-to-code-restaurant-reservations.md`.

> **⚠️ Field names — post-Jan-2026 migration.** Use the **new** field names: **`partySize`** (not `partiesSize`), **`approval`** (not `manualApproval`), **`tables.ids`** (not `tableIds`), **`ignoreConflicts`** (not the three old flags). The old names were removed after 2026-02-28; the install response still echoes some deprecated twins (e.g. `partiesSize` alongside `partySize`) — write the new ones.

---

## Article: Steps for Setting Up Wix Table Reservations
**YOU MUST** complete the steps in order (0-3) without requiring additional user input. Every step is idempotent — it verifies the auto-provisioned state and only writes when the request calls for a change.

### STEP 0: Configure the business location address

**Set a real street address on the site's default business location.** The reservation location **is** the site's business location (same entity — the reservation location's `location` object is the business `Location`), and a fresh site provisions it with an **empty street address**. A complete restaurant site needs a real address: it's where guests come, it's what the reservation/experience surface and the Business Manager show, and it's the **same** location online ordering requires (so a site with both ordering and reservations does this once). Set it via the **Locations API** — `PUT https://www.wixapis.com/locations/v1/locations/<id>` (Update Location). Docs: <https://dev.wix.com/docs/api-reference/business-management/locations/introduction.md>.

```bash
# 1) find the default location + its revision
curl -sS <AUTH> -X GET "https://www.wixapis.com/locations/v1/locations"   # take the entry with "default": true
# 2) overwrite it with a real address (FULL override — send the whole object)
curl -sS <AUTH> -X PUT "https://www.wixapis.com/locations/v1/locations/<id>" \
  -d '{ "location": {
    "id": "<id>", "revision": "<revision>", "default": true,
    "name": "<Business name>", "timeZone": "Europe/Paris",
    "address": { "country": "FR", "subdivision": "FR-75", "city": "Paris", "postalCode": "75001",
      "streetAddress": { "number": "18", "name": "Rue des Lumières" },
      "formattedAddress": "18 Rue des Lumières, 75001 Paris, France" } } }'
```

**⚠️ Earned gotchas (identical to `setup-restaurant-orders.md` STEP 0 — the same call):** Update Location is a **full override**, not a partial update (a "just the address" body is the classic *"reported success, nothing changed"* failure); **echo `"default": true`** or it 400s `CHANGE_DEFAULT_FORBIDDEN`; **`revision` is mandatory**; **`country` is a 2-letter ISO code**. The address also propagates to Site Properties. **Where the address comes from:** the request; if the brief names none, set a clearly-marked placeholder and **flag in the handoff that the owner must set their real address**.

### STEP 1: Discover the auto-provisioned default reservation location

List reservation locations and take the default one. Keep its **`id`** and **`revision`** (the PATCH in STEP 2/3 needs both).

```bash
curl -sS <AUTH> -X GET "https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations"
```

Response (`reservationLocations[]`):

```json
{ "reservationLocations": [
  { "id": "<reservationLocationId>", "revision": "1", "default": true, "archived": false,
    "location": { "id": "<locationId>", "name": "Location 1", "timeZone": "America/New_York" },
    "configuration": { "onlineReservations": {
      "approval": { "mode": "AUTOMATIC" },
      "partySize": { "min": 1, "max": 6 },
      "minimumReservationNotice": { "number": 30, "unit": "MINUTES" },
      "defaultTurnoverTime": 90,
      "businessSchedule": { "periods": [ { "openDay": "MONDAY", "openTime": "08:00", "closeDay": "MONDAY", "closeTime": "22:00" } ] },
      "onlineReservationsEnabled": false,
      "timeSlotInterval": 15
    } } }
] }
```

**⚠️ CRITICAL:**
- **Do not POST to create a location** — there is no create method in this API; use the one the install made. If `reservationLocations[]` is **empty**, the install hasn't finished provisioning — **wait briefly and retry the GET once**; do not try to create one. Still empty after one retry → **fail loud** (either the install didn't complete, or the site genuinely has no location; a location can only be added via the Dashboard / Locations API, which is out of scope here).
- Take the entry with **`default: true`** (there's normally exactly one). Keep `reservationLocation.id` and the **current** `revision`.
- **Verify `configuration.onlineReservations.approval.mode` is `"AUTOMATIC"`** — that means manual approval is OFF, which is required for a headless site to auto-confirm reservations (there's no dashboard operator to approve). It's the default; only PATCH it (STEP 2 shape) if you find it set to a manual mode.

### STEP 2: Customize the configuration (only what the request names)

PATCH the location to set party-size limits, hours, turnover, or notice per the request. Partial updates are supported; **`revision` is mandatory**. **Config PATCH works on a non-premium site** (unlike the enable toggle in STEP 3).

```bash
curl -sS <AUTH> -X PATCH \
  "https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations/<reservationLocationId>" \
  -d '{
    "reservationLocation": {
      "id": "<reservationLocationId>",
      "revision": "<revision>",
      "configuration": { "onlineReservations": {
        "partySize": { "min": 2, "max": 10 },
        "minimumReservationNotice": { "number": 60, "unit": "MINUTES" },
        "defaultTurnoverTime": 90
      } }
    }
  }'
```

**⚠️ CRITICAL:**
- **`revision` must be the current one** (from STEP 1, or the previous PATCH's response); it increments by 1 each update — a stale revision 400s. Keep the new revision for STEP 3.
- **You cannot change the `location` object** via this method (address/name live on the business Location) — attempting to returns an application error. Only touch `configuration`.
- Use the **new** field names (`partySize`, `approval`) — see the migration callout above.
- Skip this step entirely if the request names no reservation specifics (keep the auto-provisioned config).

### STEP 3: Turn on online reservations (premium-gated)

Flip `onlineReservationsEnabled` on so visitors can book. Send the current `revision`.

```bash
curl -sS <AUTH> -X PATCH \
  "https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations/<reservationLocationId>" \
  -d '{
    "reservationLocation": {
      "id": "<reservationLocationId>",
      "revision": "<revision>",
      "configuration": { "onlineReservations": { "onlineReservationsEnabled": true } }
    }
  }'
```

**⚠️ CRITICAL — this toggle is PREMIUM-ONLY; on a non-premium site it returns `428 PREMIUM_ONLY`, NOT success.** On a free/headless site this PATCH fails with:
```json
{ "message": "Can't turn on online reservation for a non-premium website", "details": { "applicationError": { "code": "PREMIUM_ONLY" } } }
```
This is a **site-provisioning precondition, not a recipe bug** — treat `428 PREMIUM_ONLY` as an **expected, non-fatal** outcome: record that the site must be upgraded to premium before online reservations can be turned on (the owner then enables it, in the Dashboard or via this same call on the premium site), and **continue**. Do **not** retry-spiral it and do **not** fail the whole seed over it. (This is stricter than online ordering, where only *paid checkout* needs premium — here the *enable toggle itself* is gated.) On a premium site the same call returns the updated location with `onlineReservationsEnabled: true`.

---

## Conclusion
Following these steps configures Table Reservations for a site:
- Uses the **auto-provisioned default reservation location** (discovered, never created — locations come only from the Dashboard / Locations API), with its `id` + `revision` kept.
- Verifies **manual approval is off** (`approval.mode: "AUTOMATIC"`) so a headless site auto-confirms.
- **Customizes** party size / hours / turnover / notice per the request via `PATCH` (works on non-premium; `revision` mandatory; `location` object immutable here; new field names).
- **Attempts to enable online reservations** (`onlineReservationsEnabled: true`) — succeeds on premium, returns a non-fatal **`428 PREMIUM_ONLY`** on a non-premium site (recorded as a premium precondition, not a failure).
- **Nothing is bulk-seeded** and there is **no menu dependency** — reservations are created by visitors at runtime (`how-to-code-restaurant-reservations.md`).
</content>
