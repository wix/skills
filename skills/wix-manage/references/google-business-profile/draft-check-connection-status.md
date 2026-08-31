---
name: "Draft: Check Google Business Profile Connection Status"
description: "Read-only verification draft for checking whether the authenticated Wix site has a usable Google Business Profile connection. Calls Get Connection once, explains NEVER_CONNECTED, VALID, and NEEDS_RECONNECT, and stops without requesting a connect URL, disconnecting, or changing site or Google data."
---

# Draft: Check Google Business Profile Connection Status

> **Verification draft.** This focused, read-only recipe exists to verify that multiple new skill
> sources can be attached concurrently to the Google Business Profile documentation menu node.

Use the public **Google Business Profile Connection API** to inspect the connection for the
authenticated Wix site. The site is selected through the caller's authorization context; never
invent a site ID or add one to the request.

## Call

Call **Get Connection** once:

```http
GET https://www.wixapis.com/gbp/v1/connection
Authorization: <AUTH>
```

There is no request body or query parameter. Read `connection.status` from the response and report
it in plain language:

| Status | Meaning |
|---|---|
| `NEVER_CONNECTED` | This site has not connected a Google Business Profile account. |
| `VALID` | Wix has stored credentials for this site's Google Business Profile connection. |
| `NEEDS_RECONNECT` | A connection record exists, but the stored Google credentials are unavailable. |

This is a status check only. Do not request a connect URL, start OAuth, call Disconnect, or modify
locations. A `VALID` value confirms that Wix has credentials; it is not a live Google health check.

If the call returns `403` or `PERMISSION_DENIED`, explain that the current Wix identity cannot read
the site's Google Business Profile connection and stop. Do not retry with another site or request
shape.
