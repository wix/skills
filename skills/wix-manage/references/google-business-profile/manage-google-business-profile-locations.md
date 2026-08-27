---
name: "Manage Google Business Profile Locations for a Wix Site"
description: Import Google Business Profile locations into the authenticated Wix site, list and query them with or without live Google data, update Wix-side and Google-side details through the correct method for each, create a new Google listing, check whether a profile is actually live on Google, and remove a location from Wix or delete its Google listing. Checks the site's Google connection first and reports a missing one as a setup step, warns before destructive or Google-visible writes, and respects Google's shared rate budget.
---

# Manage Google Business Profile Locations for a Wix Site

Use the public **Google Business Profile Locations API** to manage the
authenticated Wix site's Business Profile locations — the entries that decide
how the business appears on Google Search and Maps. The REST requests do not
contain a site ID — the site comes from the caller's authorization context.
Use the site the environment already supplies; if no site is selected, list
the user's sites once and auto-select the only one, or ask the user to choose
by site name when several are available. Never invent a site ID or ask the
user to type one.

> **Unconnected-site fast path — read first.** Read the connection once. Treat
> `NEVER_CONNECTED`, `NEEDS_RECONNECT`, or a single
> `CONNECTION_NOT_FOUND`/not-found response from that connection check as the
> same setup state. Query Wix-only GBP locations once to answer what the site
> already has, report the result, explain the connect → account selection →
> unimported-location selection → bulk-create flow, and stop. Do not call a
> Google-backed location method or make further API probes or documentation
> searches until the connection is `VALID`. A `403` or `PERMISSION_DENIED` is
> terminal: the **next action is the final response** explaining it. Stop
> without the Wix-only query, documentation search, or any other tool call.

The API is a live view onto Google, not a copy: most calls make a real Google
request, with Google's latency and rate limits. A location's ID is Google's
opaque location ID and is what identifies it everywhere.

## Direct calls for the unconnected-site path

Use these request shapes directly; do not search the API reference before
calling them.

| Method | Call |
|---|---|
| **Get Connection** | `GET https://www.wixapis.com/gbp/v1/connection` — no body or parameters |
| **Query GBP Locations** | `POST https://www.wixapis.com/gbp/v1/locations/query` with body below |

```json
{ "query": { "paging": { "limit": 100 } } }
```

Make **Get Connection** first, then branch before making any other call:

- `403` or `PERMISSION_DENIED` — stop. The next action is the final response;
  explain that the current Wix identity cannot inspect the site's GBP state.
  Do not query locations, inspect installed apps, search documentation, or try
  another endpoint.
- `NEVER_CONNECTED`, `NEEDS_RECONNECT`, or `CONNECTION_NOT_FOUND` — make one
  **Query GBP Locations** call, report the Wix-stored result, explain the future
  import steps, and stop.
- `VALID` — proceed with the requested Google-backed flow.

Do not call List GBP Accounts or another Google-backed method until the
connection is `VALID`.

## Check the connection first

Google-backed methods require a Google connection, established through the
**Google Business Profile Connection API** (see the connect recipe). Before
Google-backed work, call **Get Connection**:

- `VALID` — proceed.
- `NEVER_CONNECTED` or `NEEDS_RECONNECT` — report a setup step, not an error,
  and offer to run the connect flow. Do not retry location calls until the
  connection is `VALID`.

Wix-only reads and deletes still work without active Google credentials:
**Get GBP Location**, **Query GBP Locations**, **Update Location**,
**Delete Location**, and **Bulk Delete Locations**.

## Import locations

Importing registers listings that already exist at Google; it never creates
one. Each step narrows the next:

1. Call **List GBP Accounts**. One Google login can hold several Business
   Profile accounts, so present the list and let the owner pick — never assume
   the first one.
2. Call **List Unimported Locations** with the chosen `accountId`. It returns
   only what the site hasn't imported yet, so re-running never offers
   duplicates.
3. Let the owner select which locations to import, and confirm before writing.
4. Call **Bulk Create Locations** with the selected locations, supplying `id`
   and `accountId` on each.
5. Inspect every `results[].itemMetadata.error`. The call reports per-item
   failures instead of aborting, so a `200` does not mean every location
   imported. Report failures explicitly.

Repeat steps 2–5 per account if the owner wants locations from more than one.

## List and query locations

Choose by whether live Google data is needed:

- **Just the site's locations:** call **Query GBP Locations**. Wix-stored rows
  only — fast, no Google round-trip, no Google rate limit. Use it for counts,
  ID lookups, and anything driven by `id`, `googleLocationId`, or `accountId`.
- **Locations with live business details:** call **Query Google Locations**
  (or **Get Google Location** for one). Each row is hydrated with a live
  Google fetch. Check each row for `googleError` — one location failing at
  Google does not fail the request or break paging, so render it as a
  per-location problem, not an empty result.

## Update the correct side

Wix stores almost nothing; the method name tells you which side a write
reaches. Check before calling anything destructive:

| Method | Wix row | Google listing |
|---|---|---|
| **Create Location**, **Bulk Create Locations** | created | untouched (imports an existing listing) |
| **Create Google Location** | created | **created** |
| **Update Location** | updated | untouched (writes Wix-stored fields only) |
| **Update Google Location** | untouched | **updated** |
| **Delete Location**, **Bulk Delete Locations** | deleted | untouched |
| **Delete Google Location** | deleted | **deleted** |

- **Update Location** is not the way to edit a Business Profile — it writes
  only Wix-stored fields. To change Google-owned data (title, address, hours,
  categories), call **Update Google Location**, and confirm with the owner
  first: the change is publicly visible on Google.
- To create a brand-new Google listing, call **Create Google Location** after
  explicit confirmation. Use the API's reference-data methods (address schema,
  category and region suggestions) rather than inventing values.
- Google allows roughly 10 profile edits per minute per Business Profile, and
  the budget is shared across every write method. Pace the profile as a whole
  and treat a `429` as worth retrying after a delay, not as a rejection.

## Remove a location

Decide first whether the owner is removing it from Wix or deleting the real
Google listing — these are different operations and one is irreversible.
Confirm which they mean before calling anything:

- **Un-import from Wix, leave Google alone:** call **Delete Location**, or
  **Bulk Delete Locations** for several. Inspect every
  `results[].itemMetadata` entry — the bulk call can partially succeed.
- **Delete the Google listing as well:** call **Delete Google Location** once
  per location; there is no bulk Google delete. Require explicit confirmation
  naming the location — the listing disappears from Google Search and Maps.
- If **Delete Google Location** returns `LOCATION_DB_PERSIST_FAILED`, Google
  deleted the listing but Wix didn't record it. The error payload carries the
  location ID; call **Delete Location** with it to reconcile.

## Check whether a profile is actually live

A location existing in Wix does not mean it appears on Google — verification
can be pending, the profile suspended, or ownership contested. Call
**Get Voice of Merchant** for the location and act on what Google reports:
wait, verify, comply, or resolve the conflict.

## Recovery rules

- **`FAILED_PRECONDITION` with `CONNECTION_NOT_FOUND`:** the site has no
  usable Google connection. Report the setup step and offer the connect flow;
  do not retry the same call.
- **`GOOGLE_API_CALL_FAILED`:** read the carried Google code and description.
  Some failures are permanent (profile suspended, field not editable) —
  retrying will not help; explain instead.
- **Per-row `googleError` on hydrating reads:** report it per location and
  continue with the rest of the page.
- **Rate limited (`429`):** wait, then retry; interleaved writes share one
  budget per profile.
- **Permission denied:** stop after the first `403` or `PERMISSION_DENIED`.
  Do not retry with other locations, request shapes, or sites, and do not
  search for an alternate API or method. Deleting locations requires the
  site's `GBP_ADMIN` role.

The same API also covers reviews and replies, photos and bulk media uploads,
attributes, verification, performance insights, and location admins — load the
specific public method reference needed before constructing a request so field
names, filters, permissions, and errors come from the live contract. Once a
connection state or typed error selects a branch above, do not search or browse
for an alternate API, method, or request shape.
