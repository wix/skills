---
name: "Draft: List Wix-Stored Google Business Profile Locations"
description: "Read-only verification draft for listing Google Business Profile locations already stored for the authenticated Wix site. Uses Query GBP Locations with cursor paging, does not hydrate live data from Google, works without an active Google connection, and never imports, updates, or deletes a location."
---

# Draft: List Wix-Stored Google Business Profile Locations

> **Verification draft.** This focused, read-only recipe exists to verify that multiple new skill
> sources can be attached concurrently to the Google Business Profile documentation menu node.

Use **Query GBP Locations** when the user wants the locations already stored in Wix and does not
need live details from Google. The site is selected through the caller's authorization context;
never invent a site ID or add one to the request.

## Call

Start with one page of up to 100 Wix-stored locations:

```http
POST https://www.wixapis.com/gbp/v1/locations/query
Authorization: <AUTH>
Content-Type: application/json

{
  "query": {
    "paging": {
      "limit": 100
    }
  }
}
```

Report the returned locations and their identifiers. If the response supplies a next cursor and the
user asked for all results, request the next page using that cursor and keep the same limit.

This Wix-only read does not call Google and does not require an active Google connection. Do not
switch to Query Google Locations, because that method hydrates live Google data and has different
connection and rate-limit behavior. Do not import, update, or delete any location.

If the query returns `403` or `PERMISSION_DENIED`, explain that the current Wix identity cannot read
the site's stored Google Business Profile locations and stop. Do not retry with another site or
request shape.
