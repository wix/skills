---
name: "Setup Rentals"
description: Initializes a Wix Rentals backend — creates a resource type, the bookable resources (rooms, vehicles, equipment), and the rental services carrying serviceResources plus a duration range so customers pick their own length in hours or days. Rentals has no APIs of its own; it is Services V2 with rentals-specific field values. Specifies the *how* (calls + format); how many resources and services, their ranges and prices come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Rentals (Services V2 + Resources V2)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for turning a freshly provisioned Wix site with the **Wix Rentals** app installed into a populated catalog of rentable resources.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial Rentals backend setup. (The frontend read/booking contract is the sibling recipe `how-to-code-rentals.md`.)

> **This recipe is the *how*, not the *what*.** What to seed — how many resource types and resources, how many services, whether they are hourly or daily, their duration ranges and prices — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities.

> **⚠️ Wix Rentals has NO APIs of its own.** It runs on the **Wix Bookings** APIs with rentals-specific field values, so a rental offering is a Bookings *service* and a reservation is a Bookings *booking*. There is no `@wix/rentals` package and no `/rentals/` REST namespace — do not go looking for one, and do not report rentals as "not supported headlessly".
>
> **The Wix Rentals doc set is four pages** — this recipe is distilled from them, and they are where to go when a task falls outside the common path:
> - [About Wix Rentals](https://dev.wix.com/docs/api-reference/business-solutions/rentals/introduction.md) — the model, the app id, and the constraints
> - [Wix Rentals and the Bookings APIs](https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md) — each rentals concept mapped to its Bookings API
> - [About Wix Rentals Availability](https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md) — resource schedules, hourly vs daily, buffer time
> - [Wix Rentals: Sample Flows](https://dev.wix.com/docs/api-reference/business-solutions/rentals/sample-flows.md) — the call sequences, including [Set up a rental service](https://dev.wix.com/docs/api-reference/business-solutions/rentals/sample-flows.md#set-up-a-rental-service), which is this recipe end to end

> ### The invariants (read these before anything else)
> A service is a rental because of **four field values**, all set at create time in STEP 4:
> 1. **`appId` = `ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e`** — and it is **IMMUTABLE after create**. A service created without it is a plain Bookings service *forever*; no update converts it. This is the most expensive mistake in this recipe.
> 2. **`serviceResources: [{ "resourceType": { "id": "<resourceTypeId>" } }]`** — the resource types that must be available for the service to be bookable. **Omitting this is what actually causes `MISSING_APPOINTMENT_RESOURCES`**, and the error text sends you looking in the wrong place (see STEP 4).
> 3. **`primaryResourceType`** — the resource type GUID, which makes availability come from the rooms/vehicles instead of staff schedules. It must reference **one of the types listed in `serviceResources`**. Omitting it silently falls back to the **staff** resource type.
> 4. **`durationRange`** — with a single `unitType` (`HOUR` or `DAY`) and its matching `hourOptions`/`dayOptions`. Mutually exclusive with `sessionDurations`.
>
> And one ordering rule: **resources must exist before the service** (STEP 2 before STEP 4), or availability is permanently empty.
>
> **Rental services never use a category** — omit the field. The bookings "a category or it's invisible" rule is specific to Wix Bookings and does not apply to rentals. See STEP 3.

> **API surfaces:** everything is on the **public** host `https://www.wixapis.com/bookings/...`. Services are **Services V2** (`…/bookings/v2/services`) — the method page's schema header shows an internal `…/_api/bookings/v2/services` form, **do not use that**. Resource types are `…/bookings/v2/resources/resource-types`, resources are `…/bookings/v2/resources`. The Wix Rentals **app id** is `ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e` (needed here on the service, and by the frontend for filtering + the cart).

---

## Article: Steps for Setting Up Wix Rentals

**YOU MUST** complete the following steps **in the given order** (1-5) without skipping any and **without requiring additional user input**. STEP 5 (attributes) runs only when the request calls for filterable resource properties. The **Attach images** step runs **only when imagery is on** — skip it entirely otherwise.

**⚠️ CRITICAL ORDER REQUIREMENT: resource type (STEP 1) → resources (STEP 2) → services (STEP 4).** (STEP 3 is intentionally empty — rental services use no category.) A rental service declares its resource type in `serviceResources` and points at it via `primaryResourceType`, and its availability is derived from the *resources* in that type — so both must exist before the service. A service created against a resource type that holds **no resources has permanently empty availability**: it is created successfully, appears in the catalog, and can never be booked.

**Check for pre-existing services first** — same demo-data cleanup as bookings, same rules. List with `POST https://www.wixapis.com/bookings/v2/services/query` (body `{"query": {"paging": {"limit": 100}}}`), and `DELETE https://www.wixapis.com/bookings/v2/services/<serviceId>` the install's own samples. **Do not assume every existing service is a sample** — if it isn't obviously install demo data, **ask the user first**. Full rationale: `setup-bookings.md` § "Check for pre-existing services first".

### STEP 1: Create the resource type

A **resource type** is the category of thing being rented — "Meeting rooms", "Vans", "Cameras". A service connects to exactly **one** resource type, and Wix derives that service's availability from the resources inside it. Create one resource type per kind of thing the request rents.

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/resources/resource-types' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "resourceType": { "name": "Meeting rooms" } }'
```

The response is `{ "resourceType": { "id": "<resourceTypeId>", … } }` — **keep each `id`**, STEP 2 and STEP 4 both need it. Full contract: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resource-types-v2/create-resource-type.md>

- **`name` is required, max 40 characters, and must be unique per site.** A duplicate returns `409 RESOURCE_TYPE_ALREADY_EXISTS_FOR_NAME` — query or rename rather than retrying the same name.
- Sites have a cap on resource types (`429 MAX_NUMBER_OF_RESOURCE_TYPES_REACHED`). Create one per genuine category, not one per item.

### STEP 2: Create the resources

A **resource** is an individual bookable thing — "Room A", "Room B", "Van 3". Create one per rentable unit. Two resources of the same type mean two customers can rent in parallel.

```bash
curl -X POST 'https://www.wixapis.com/bookings/v2/resources' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "resource": {
      "name": "Room A",
      "typeId": "<RESOURCE_TYPE_ID_FROM_STEP_1>"
    }
  }'
```

Keep each resource's returned **`id`** — it's needed for attributes (STEP 5) and the handoff, **not** by the service.

**A resource reaches the service through its `typeId`, never by being listed on it.** That's why STEP 4 names only the resource *type* in `serviceResources` and no resource ids appear in the service payload — every resource of that type is automatically bookable, and adding a resource later needs no change to the service.

- **⚠️ Omit `workingHoursSchedules` — this is the deliberate seed default and it matters downstream.** ([Why, in detail](https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md#resource-schedules).) A resource with **no** working-hours schedule is bookable **24/7**. That keeps the seed to a single call per resource, *and* it makes a multi-day daily rental store as **one booking** rather than a linked group of per-day bookings. A resource **with** working hours splits every multi-day rental into one booking per working day, created through Create Multi Service Booking — a materially harder frontend flow (`how-to-code-rentals.md` § "Daily availability"). Seed 24/7 unless the request explicitly needs opening hours; the merchant can add hours from the dashboard later.
- **Working hours, when the request genuinely needs them,** are a Schedules V3 schedule referenced by `workingHoursSchedules.scheduleId` — created separately, then attached. It is out of scope for a seed; note it in the handoff instead. Reference: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resources-v2/create-resource.md>
- **Locations** — `locationOptions.specificLocationOptions` binds a resource to business locations. Omit it for a single-location site (the default). When both `workingHoursSchedules` and `locationOptions` are set, **`workingHoursSchedules` takes precedence**.

### STEP 3: No category — rental services don't use categories

**⚠️ Rental services do not use categories at all. Omit `category` from the service payload entirely** — do not send `"category": {}`, a made-up id, or try to create one. There is no step here; the numbering is kept so STEP 4 keeps its name.

This is the one place where the bookings invariant does **not** carry over. `setup-bookings.md` STEP 2 calls `category.id` critical because a Bookings service without one is hidden on the live site. **That rule is specific to Wix Bookings and does not apply to Wix Rentals** — rentals are surfaced through the `appId`-filtered catalog read, not through Bookings categories. Confirmed on a live Rentals site: services created with no category come back from that read with `hidden: false`, and the Rentals install's own demo service ships without one.

The categories API isn't reachable here anyway — it belongs to the **Wix Bookings app**, which `SETUP.md` tells you not to install alongside Rentals. On a Rentals-only site `POST …/bookings/v2/categories` returns **`428 APP_NOT_INSTALLED`** and `POST …/bookings/v2/categories/query` returns a flat **`401`**. If you see either, you are following the bookings recipe by mistake — stop and skip this step.

This holds on a **mixed** site too (Bookings *and* Rentals installed, per `SETUP.md`): the categories API works there, but rental services still don't need or use a category. Assign categories only to the plain Bookings services on such a site.

### STEP 4: Create the rental services

Create all services in a single bulk call to `POST https://www.wixapis.com/bookings/v2/bulk/services/create` (up to **100** per call). A rental service is a normal **Services V2 `APPOINTMENT`** carrying three rentals-specific values.

**⚠️ CRITICAL: the V2 service payload is FLAT** — name/description/tagLine are top-level, not nested under `info`. Price uses `value` (a **string**), not `amount`. Full field contract: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/create-service.md>

**One hourly rental service, bookable 1–8 hours at $40/hour:**

```json
{
  "services": [
    {
      "type": "APPOINTMENT",
      "appId": "ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e",
      "name": "Meeting Room",
      "description": "A brand-appropriate description of what is being rented.",
      "tagLine": "Short tagline",
      "defaultCapacity": 1,
      "serviceResources": [ {
        "resourceType": { "id": "<RESOURCE_TYPE_ID_FROM_STEP_1>" },
        "resourceIds": { "values": ["<RESOURCE_ID_FROM_STEP_2>"] }
      } ],
      "primaryResourceType": "<RESOURCE_TYPE_ID_FROM_STEP_1>",
      "onlineBooking": { "enabled": true, "requireManualApproval": false, "allowMultipleRequests": false },
      "schedule": {
        "availabilityConstraints": {
          "durationRange": {
            "unitType": "HOUR",
            "hourOptions": { "minDurationInMinutes": 60, "maxDurationInMinutes": 480 }
          }
        }
      },
      "payment": {
        "rateType": "FIXED",
        "fixed": { "price": { "value": "40.00", "currency": "USD" } },
        "options": { "online": true, "inPerson": false }
      },
      "locations": [ { "type": "BUSINESS" } ]
    }
  ],
  "returnEntity": true
}
```

**`serviceResources` carries both levels.** `resourceType.id` is the type from STEP 1; `resourceIds.values` lists the individual resources from STEP 2 that this service can book (max **100** ids, max **8** `serviceResources` entries).

Omitting `resourceIds` is also valid — then **every** resource of that type is eligible, including ones added later, with no change to the service. Use that when the service should always cover the whole type.

**⚠️ Price decides how many services you create.** The rate lives on the **service**, not the resource, so resources that rent at **different rates must be separate services**, each pinning its own resource in `resourceIds`. Three meeting rooms at ₪60, ₪120 and ₪250 per hour are **three services** sharing one resource type — not one service with three resources. Resources that rent at the **same** rate can share a single service, and then you can omit `resourceIds` and let the whole type be bookable.

**For a daily rental**, swap the duration range (everything else is identical):

```json
"durationRange": {
  "unitType": "DAY",
  "dayOptions": { "minDurationInDays": 1, "maxDurationInDays": 5 }
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**

- **`appId` must be the Wix Rentals app id** `ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e`, and it is **immutable after create** — a service created without it is a plain Bookings service forever, and no update can convert it. Getting this wrong is the single most expensive mistake in this recipe.
- **`appId` also means the service does NOT appear in the Wix Bookings dashboard** — it appears in the Rentals dashboard. That is correct and expected; don't "fix" it.
- **`serviceResources` names the resource *type*, not individual resources** (STEP 2) — every resource in that type is bookable.
- **⚠️ `serviceResources` is REQUIRED and is the real cause of `MISSING_APPOINTMENT_RESOURCES` — do not trust the error text.** The message reads *"service of type appointment requires at least one staff member or service resource"*, which invites you to go check whether your resource type has resources in it. **That is a dead end** — the create fails even when the type is fully populated. What the service actually needs is the resource type declared **on the service**:
  ```json
  "serviceResources": [ {
    "resourceType": { "id": "<resourceTypeId>" },
    "resourceIds": { "values": ["<resourceId>"] }
  } ]
  ```
  Verified on a live site: adding this field is what makes the create succeed. `resourceType.id` is the type from STEP 1; `resourceIds.values` lists the resources from STEP 2 this service can book. Max **8** `serviceResources` entries, max **100** ids each. Omitting `resourceIds` is also valid and makes every resource of that type eligible, including ones added later.
- **`primaryResourceType`** is the resource type **GUID** from STEP 1, and **must be one of the types listed in `serviceResources`**. It is what makes availability come from the rooms/vehicles rather than from staff schedules. Omitting it silently falls back to the **staff** resource type, which produces a normal staff-driven appointment service.
- **`durationRange` and `sessionDurations` are mutually exclusive** — send one or the other, never both. `durationRange` also **can't be combined with `workingHours`** on the service.
- **`unitType` selects which config object is read:** `HOUR` → `hourOptions`, `DAY` → `dayOptions`. Sending `dayOptions` with `unitType: "HOUR"` leaves the range unset.
- **Ranges:** hourly `minDurationInMinutes`/`maxDurationInMinutes` are **30–1440**; daily `minDurationInDays`/`maxDurationInDays` are **1–8** for rentals. Min must be **≤** max. (The underlying Services V2 schema permits days up to 60; Wix Rentals documents 1–8 — stay inside 1–8.)
- **One unit type per service.** A service is hourly *or* daily, never both. If the request wants a room by the hour **and** by the day, that is **two services**, each with its own price.
- **Omit `staffMemberIds`.** Rentals are resource-driven, not staff-driven — `serviceResources` above is what satisfies the appointment-resource requirement. Never add a staff resource to get past `MISSING_APPOINTMENT_RESOURCES`; that reintroduces staff-based availability and produces a service that is no longer a rental in behaviour.
- **Omit `category`.** Rental services don't use categories at all (STEP 3).
- **`onlineBooking: { "enabled": true }` is required** — V2 rejects the create without it even though it reads as optional.
- **`defaultCapacity`** is required; use `1` (one customer rents a given resource at a time; parallel capacity comes from having more *resources*, not higher capacity).
- **`payment.options` — at least one of `online`/`inPerson` must be `true`**, even for free services. `NO_FEE` must pair with `online: false, inPerson: true`.
- **Price is per unit** — per hour for `HOUR`, per day for `DAY`. Wix multiplies it out at booking time (hourly is prorated per minute: `minutes × price ÷ 60`). Do **not** pre-multiply into a whole-rental price.
- **`locations[].type`** — use **`"BUSINESS"`**, never `"OWNER_BUSINESS"` (that enum belongs to `createBooking`'s slot location).
- **Currency** — the site's business currency wins; a EUR-locale site stores `EUR` even if you send `USD`. Not an error.
- **Imagery is opt-in** (`SEED.md` § "Entity images") — seed text-only, attach images in the pass-2 step below.

**⚠️ Reading the response — created services are under `results[]`, each as `results[].item` with per-item `results[].itemMetadata`:**

```json
{ "results": [
  { "itemMetadata": { "id": "<serviceId>", "originalIndex": 0, "success": true },
    "item": { "id": "<serviceId>", "name": "…", "type": "APPOINTMENT",
              "mainSlug": { "name": "<url-slug>", "custom": false },
              "schedule": { "id": "<scheduleId>", "availabilityConstraints": { "durationRange": { … } } } } }
], "bulkActionMetadata": { "totalSuccesses": 1, "totalFailures": 0 } }
```

Keep each service's **`item.id`** and **`item.mainSlug.name`** (the frontend links by slug; if absent, derive it: lowercase, non-alphanumerics → hyphens). **Check `itemMetadata.success` per item** — retry only the failed ones **once**, with the same format.

**Verify the range actually landed.** `durationRange` is a newer field and a silently-dropped range yields a service that looks fine and books as a fixed slot. Re-read one created service (`GET https://www.wixapis.com/bookings/v2/services/<serviceId>`) and confirm `schedule.availabilityConstraints.durationRange.unitType` is populated before moving on.

### STEP 5: Resource attributes (only when the request wants filterable properties)

Attributes are typed custom properties on a resource — `Capacity` (number), `Has projector` (boolean), `Bed type` (string) — used to describe resources on the site and to filter the catalog. Skip this step entirely unless the request calls for it.

> **⚠️ The attributes API is the one surface here that really does live under `/_api/`.** Unlike Services V2 (where the `_api` form in the schema header is wrong and the public form is correct), the attributes reference's own examples call `https://www.wixapis.com/_api/attributes/v1/...`. Use the paths exactly as written below — don't "correct" them to a public form.

**1 · Define each attribute once per site.** Keep each returned `attributeDefinition.id`.

```bash
curl -X POST 'https://www.wixapis.com/_api/attributes/v1/attribute-definitions' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "attributeDefinition": {
      "name": "Capacity",
      "valueType": "NUMBER",
      "numberConfig": { "min": 1, "max": 20 },
      "defaultValue": { "numberDefault": 2 },
      "visibility": true
    }
  }'
```

**2 · Set values per resource.** The **resource id** is the `{entityId}` path segment. Each entry is matched by `attributeDefinitionId`, so only the listed attributes are created or updated.

```bash
curl -X POST 'https://www.wixapis.com/_api/attributes/v1/attribute-values/<RESOURCE_ID_FROM_STEP_2>/bulk-upsert' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "values": [ { "attributeDefinitionId": "<ATTRIBUTE_DEFINITION_ID>", "numberData": 4 } ],
    "returnEntity": true
  }'
```

The value key is typed — `numberData` for `NUMBER`, and the string/boolean equivalents for those `valueType`s; check the reference for the exact key rather than guessing.

**3 · Reading them back for display** — filter to attributes whose `attributeDefinition.visibility` is `true`. **⚠️ The API does not enforce visibility server-side**, so an unfiltered render leaks attributes the merchant marked hidden.

References: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/attributes/attribute-definition/create-attribute-definition.md> and <https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/attributes/attribute-value/bulk-upsert-attribute-values.md>

### Attach images (imagery ON only — skip otherwise)

Identical to the bookings flow, because it is the same Services V2 entity. Obtain the image per `references/IMAGE_GENERATION.md`, then `PATCH https://www.wixapis.com/bookings/v2/services/<serviceId>` writing under **`media.mainMedia`** and **`media.coverMedia`**, each `{ "image": { "id", "url", "width", "height" } }`, echoing the current `revision`.

**⚠️ Writing the image under `media.image` returns `HTTP 200` but silently drops it** — confirm by re-querying the service and checking `media.mainMedia` is populated. Never block on image failure; leave the service text-only. Full shape and caveats: `setup-bookings.md` § "Attach images".

---

## Conclusion

Following these steps **in order** sets up a Wix Rentals site:

- A **resource type** exists, and it **contains resources** — without resources the service's availability is permanently empty.
- Every service carries the **Wix Rentals `appId`** (`ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e`), set at create time because it is **immutable** afterwards.
- Every service carries **`serviceResources`** naming its resource type — the field the `MISSING_APPOINTMENT_RESOURCES` error does *not* point you to — plus **`primaryResourceType`**, so availability comes from the resources rather than from staff.
- Every service carries a **`durationRange`** with a single `unitType` and its matching `hourOptions`/`dayOptions` — never alongside `sessionDurations`.
- **No category** is set — rental services don't use categories, and the bookings visibility rule doesn't apply to them. They are surfaced by the `appId`-filtered catalog read.
- Resources are seeded **24/7** (no working-hours schedule), which keeps a multi-day daily rental to a single booking.
- IDs kept for the coding handoff: `resourceTypeIds[]`, `resourceIds[]`, `serviceIds[]`, service `slug`s (`mainSlug.name`), and any `attributeDefinitionIds[]`.
