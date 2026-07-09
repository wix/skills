---
name: "Setup Restaurant Orders"
description: Configures Wix Restaurants **Online Ordering** on top of an already-seeded Menus backend. Installing the Orders app AUTO-PROVISIONS a working ordering setup (an ENABLED operation with Pickup + Delivery attached, and every menu ordering-enabled), so this recipe VERIFIES that baseline and CUSTOMIZES the fulfillment methods to the request — it does NOT build ordering from scratch. Specifies the *how* (calls + format); which methods/fees/hours and which menus come from the request.
---
**RECIPE**: Business Recipe – Online-Ordering Setup for Wix Restaurants (Orders app)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` **and** `wix-site-id: <SITE_ID>`. Body-bearing requests also need `Content-Type: application/json`.

A checklist for online ordering on a Wix site that already has a **Restaurants Menus** backend.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial ordering setup.

> **⚠️ THE ORDERS-APP INSTALL DOES ALMOST EVERYTHING — this recipe VERIFIES and CUSTOMIZES, it does NOT create ordering from scratch.** Installing the Orders app auto-provisions a **fully working** ordering setup with **zero** extra calls:
> - one **operation** (`onlineOrderingStatus: "ENABLED"`, `default: true`, `defaultFulfillmentType: "PICKUP"`, a full `orderScheduling`);
> - **three fulfillment methods already attached** to it — a `"Pickup"` (enabled), a `"Delivery Area #1"` (DELIVERY, RADIUS, enabled, `fee "0"`), and a `"DoorDash Drive"` (DELIVERY, provider-based, **disabled**);
> - a **menu-ordering-settings** object per menu, each already `onlineOrderingEnabled: true` and bound to the operation.
>
> So a site with a seeded menu is **already orderable (pickup + delivery) the moment the Orders app is installed.** The steps below **verify** that baseline and **reshape it to the request** (rename/re-fee/re-hour the auto methods, disable unwanted ones, add extra ones). If the request asks for nothing beyond "let people order," all steps are just confirmations — keep the auto-provisioned defaults and do only the verification (STEP 2 reshapes methods **only** when the request names specifics).

> **⚠️ DEPENDS ON MENUS — the menu must exist.** A customer orders **menu items**, and each menu is bound to the ordering operation through a **menu-ordering-settings** object. This recipe assumes the **Menus** backend is already seeded (`setup-restaurants.md` — menu → sections → items, all `visible: true`) and its `menuId`(s) are in hand. Installing the **Orders** app **auto-installs the Menus app** and **auto-creates one menu-ordering-settings object per menu** — for menus that already exist *and* for menus created *after* install — each already `onlineOrderingEnabled: true` and bound to the operation. So whichever order you install Orders vs. seed menus, every menu ends up orderable automatically; STEP 3 only verifies it.

> **This recipe is the *how*, not the *what*.** Which fulfillment methods to offer (pickup, delivery, or both), their fees / minimum-order amounts / hours / delivery area, and which menus are orderable come from the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide those quantities. Per the "simple seeds" default, **if the request names no ordering specifics, keep the auto-provisioned defaults** and do only the verification steps.

> **⚠️ API surfaces — this vertical spans SEVERAL micro-services, each on its OWN host prefix** (unlike Menus, which is all under `restaurants/menus/v1`). Do not "normalize" them to a single prefix:
> - **Operations** — `https://www.wixapis.com/restaurants-operations/v1/operations`
> - **Fulfillment methods** — `https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods`
> - **Menu ordering settings** — `https://www.wixapis.com/menu-ordering-settings/v1/menu-ordering-settings`
>
> These are the **new** Wix Restaurants Orders APIs. A superseded cURL sample in the docs still shows the old `restaurants/v1/fulfillment-methods` host **and** a snake_case `fulfillment_method` wrapper — ignore both. Use the `fulfillment-methods/v1/...` host and the **camelCase `fulfillmentMethod`** wrapper (for both create and update).

> **⚠️ Operations & operation groups are AUTO-provisioned — never create them.** There is **no create-operation / create-operation-group** call in this flow. On install Wix creates one operation group and, for a headless site with **no business location configured**, a single operation with `businessLocationId: "none"`. You **discover** that operation (STEP 1) and, only if customizing, **PATCH** it; you never POST one.

---

## Article: Steps for Setting Up Wix Restaurants Online Ordering
**YOU MUST** complete all the following steps **in the given order** (1-3) without skipping any and **without requiring additional user input**. Every step is idempotent — it verifies the auto-provisioned state and only writes when the request calls for a change or the state is wrong.

### STEP 1: Verify (and if needed enable) the operation

List operations and take the one Wix created on install. Keep its **`id`** and **`revision`**.

```bash
curl -sS <AUTH> -X GET "https://www.wixapis.com/restaurants-operations/v1/operations"
```

Response (`operations[]`, sorted by created date ascending):

```json
{ "operations": [
  { "id": "<operationId>", "revision": "2", "name": "Ordering page 1", "default": true,
    "onlineOrderingStatus": "ENABLED", "defaultFulfillmentType": "PICKUP",
    "fulfillmentIds": ["<deliveryId>", "<pickupId>", "<doordashId>"],
    "orderScheduling": { "type": "ASAP", "asapOptions": { "preparationTime": { "type": "MAX_TIME", "maxTimeOptions": { "timeUnit": "MINUTES", "duration": 30 } }, "asapFutureHandlingType": "BUSINESS_DAYS_AHEAD_HANDLING", "businessDaysAheadHandlingOptions": { "daysCount": 0 } } },
    "operationGroupId": "<groupId>", "businessLocationId": "none" }
] }
```

**⚠️ CRITICAL:**
- **Do not POST to create an operation** — there is none to create; use the one that already exists. If `operations[]` comes back **empty**, the Orders-app install hasn't finished provisioning — **wait briefly and retry the GET once**; do not create anything. Still empty after one retry → **fail loud** (install didn't complete).
- **`onlineOrderingStatus` is normally already `"ENABLED"`** on the auto-created operation — nothing to do. Only if you see `"DISABLED"` (or you paused it), PATCH it on:
  ```bash
  curl -sS <AUTH> -X PATCH "https://www.wixapis.com/restaurants-operations/v1/operations/<operationId>" \
    -d '{ "operation": { "revision": "<operationRevision>", "onlineOrderingStatus": "ENABLED" } }'
  ```
  Enum values: `ENABLED` / `DISABLED` / `PAUSED_UNTIL`. **`revision` is mandatory and must be current** (it increments by 1 each PATCH; a stale revision 400s). **If you PATCH `orderScheduling`, send the whole object** — it's overwritten wholesale, not merged.
- For a locationless headless site `businessLocationId` is **`"none"`** — expected; it matches the menu's `"none"` so ordering binds. Don't set a location.
- Read `fulfillmentIds` here — it lists the methods currently attached to the operation (STEP 2 needs it).

### STEP 2: Reconcile the fulfillment methods to the request

List the fulfillment methods the install created, then shape them to the request. **Which methods/fees/hours/areas the site should offer come from the request — this step only gives the calls.**

```bash
curl -sS <AUTH> -X GET "https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods"
```

The install ships three (all with an `America/..`-defaulted **San Francisco placeholder** address and time zone from the site's region): a `PICKUP` `"Pickup"` (enabled), a `DELIVERY` `"Delivery Area #1"` (RADIUS, enabled, `fee "0"`), and a `DELIVERY` `"DoorDash Drive"` (provider-based, **disabled**). Keep each `fulfillmentMethod.id` and `revision`.

Do only what the request calls for:

**(a) Customize an auto-created method** (rename, set fee/minimum/hours/area) — PATCH it, partial body is fine:

```bash
curl -sS <AUTH> -X PATCH "https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods/<methodId>" \
  -d '{ "fulfillmentMethod": { "revision": "<methodRevision>", "name": "Delivery", "fee": "5", "minOrderPrice": "20" } }'
```

**(b) Disable a method the request doesn't want** — PATCH `enabled: false` (leave `"DoorDash Drive"` disabled unless the request wants a 3rd-party courier):

```bash
curl -sS <AUTH> -X PATCH "https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods/<methodId>" \
  -d '{ "fulfillmentMethod": { "revision": "<methodRevision>", "enabled": false } }'
```

**(c) Add a method beyond the defaults** (e.g. a "Curbside" pickup) — create it, THEN attach it to the operation:

```bash
# create — camelCase `fulfillmentMethod` wrapper
curl -sS <AUTH> -X POST "https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods" \
  -d '{ "fulfillmentMethod": {
        "type": "PICKUP", "name": "Curbside", "enabled": true, "fee": "0", "minOrderPrice": "0",
        "availability": { "availableTimes": [ { "dayOfWeek": "MON", "timeRanges": [ { "startTime": { "hours": 9, "minutes": 0 }, "endTime": { "hours": 22, "minutes": 0 } } ] } ], "timeZone": "America/New_York" },
        "pickupOptions": { "instructions": "Wait in your car." } } }'
# → { "fulfillmentMethod": { "id": "<newId>", "revision": "1", ... } }   (address auto-defaults if omitted)
```
Then PATCH the operation to add `<newId>` to `fulfillmentIds` (the create does **not** attach it — see the callout):

```bash
curl -sS <AUTH> -X PATCH "https://www.wixapis.com/restaurants-operations/v1/operations/<operationId>" \
  -d '{ "operation": { "revision": "<currentOperationRevision>", "fulfillmentIds": [ "<existingId1>", "<existingId2>", "<newId>" ] } }'
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **A newly created fulfillment method is NOT auto-attached to the operation** (after a create, `operation.fulfillmentIds` is unchanged). Only the *install's* three are attached automatically. So whenever you **create** a method, you must **PATCH the operation's `fulfillmentIds`** to include it (pass the full array — existing ids **plus** the new one), or it won't be offered at checkout. Customizing/disabling an *existing* attached method needs no re-attach.
- **Attach each fulfillment method to exactly one operation** — Wix warns that sharing a method across operations breaks ordering.
- **Wrap create/update bodies in `fulfillmentMethod`** (camelCase). **`fee` and `minOrderPrice` are decimal STRINGS** (`"0"`, `"5"`, `"20"`), never numbers. Currency is site-derived — send none.
- **`enabled: true`** to offer a method. **`availability.availableTimes[]`** is one entry per open weekday, each `timeRanges: [{startTime,endTime}]` (`hours` 0-23, `minutes` 0-59); `availability.timeZone` is required but Wix overrides it with the site's language-and-region zone, so any valid IANA zone is accepted.
- **`pickupOptions`** for `PICKUP`, **`deliveryOptions`** (with a `deliveryArea`) for `DELIVERY` — send the one matching `type`. Omitting the pickup `address` is fine; it defaults from the operation.
- **`revision` is mandatory on every PATCH** and increments by 1 each update; a stale one 400s.
- Retry a failed create/update **once** with the same format; do not loop.

> **The San Francisco / `fee "0"` defaults are placeholders.** They're harmless for a locationless demo site (a visitor can still build a cart). Only override the delivery `deliveryArea` / pickup `address` when the request gives a real location; otherwise leave them.

### STEP 3: Verify each menu is orderable

Menu-ordering-settings are auto-created **and auto-enabled** per menu (both pre- and post-install menus), so this is normally a confirmation. List them and check each menu the request marks orderable.

```bash
curl -sS <AUTH> -X POST "https://www.wixapis.com/menu-ordering-settings/v1/menu-ordering-settings/query" -d '{ "query": {} }'
```

Response — one object per menu; match by **`menuId`**:

```json
{ "menuOrderingSettings": [
  { "id": "<settingsId>", "revision": "1", "operationId": "<operationId>", "menuId": "<menuId>",
    "onlineOrderingEnabled": true, "availability": { "type": "ALWAYS_AVAILABLE", "timeZone": "America/New_York" } }
] }
```

**⚠️ CRITICAL:**
- **Normally every entry is already `onlineOrderingEnabled: true` with `operationId` set** — nothing to do; just confirm it. Only if an entry shows `onlineOrderingEnabled: false` or `operationId: "none"` (or the request wants a menu *not* orderable), PATCH it:
  ```bash
  curl -sS <AUTH> -X PATCH "https://www.wixapis.com/menu-ordering-settings/v1/menu-ordering-settings/<settingsId>" \
    -d '{ "menuOrderingSettings": { "revision": "<settingsRevision>", "operationId": "<operationId>", "onlineOrderingEnabled": true, "availability": { "type": "ALWAYS_AVAILABLE", "timeZone": "America/New_York" } } }'
  ```
- **`availability.type: "ALWAYS_AVAILABLE"`** makes the menu orderable during the operation's hours; a `timeZone` is required. **`revision` is mandatory** and increments per update.
- The settings object's `businessLocationId` (inherited from its menu, `"none"` for a locationless site) must match the operation's `businessLocationId` for ordering to bind — both are `"none"` here, so they match. Don't override it.
- To make a menu **display-only** (not orderable), PATCH that one to `onlineOrderingEnabled: false`; leave the rest enabled.

> **⚠️ LIVE CHECKOUT PRECONDITION (note, don't fail).** A visitor can browse the orderable menu and build a cart with just this setup, but **completing a paid order** at runtime needs the site to have a **premium plan and a configured payment method** (checkout rides on Wix eCommerce). That's a site-provisioning concern, not a seed step — surface it in the handoff; do **not** fail the seed over it.

---

## Conclusion
Following these steps confirms/completes online ordering for a site whose **Menus** backend is already seeded:
- The **Orders-app install already produced a working setup** — an `ENABLED` operation with Pickup + Delivery attached and every menu ordering-enabled; this recipe **verifies** that and **reshapes it to the request**, it does not build it from nothing.
- The **operation** is discovered, never created (operations/groups are auto-provisioned); it stays `onlineOrderingStatus: "ENABLED"`.
- **Fulfillment methods** are reconciled to the request — auto-created ones customized (decimal-string `fee`/`minOrderPrice`, weekly `availability`), unwanted ones disabled, extra ones created **and attached** to the operation via `fulfillmentIds` (a create does not auto-attach).
- Every orderable **menu** is confirmed `onlineOrderingEnabled: true` and bound to the operation through menu-ordering-settings.
- Each Orders micro-service is called on its **own host prefix** (`restaurants-operations` / `fulfillment-methods` / `menu-ordering-settings`) with the camelCase `fulfillmentMethod` wrapper; `revision` is passed on every PATCH. Real paid checkout additionally needs a premium plan + payment method (handoff note).
</content>
