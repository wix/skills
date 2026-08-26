---
name: "Connect a Wix Site to Google Business Profile"
description: Connect the authenticated Wix site to a Google Business Profile account, check whether an existing connection is still usable, recover a connection whose stored credentials are gone, switch to a different Google account, or disconnect. The site owner authorizes in their own browser through a single-use connect URL; the agent never completes the Google authorization itself. Warns before any reconnect that permanently removes the site's imported locations.
---

# Connect a Wix Site to Google Business Profile

Use the public **Google Business Profile Connection API** to link the
authenticated Wix site to a Google Business Profile account. No request field
takes a site ID — the API resolves the site from the caller's authorization
context, so never ask the user for one. A connection is the prerequisite for Google-backed work in the Google
Business Profile Locations API — establish it before importing or managing
locations.

> **Bounded connect path — read first.** Read the connection once. For
> `NEVER_CONNECTED`, request one connect URL and hand it to the owner; for
> `VALID`, stop unless the user asked for other Google-backed work. A `403`,
> `PERMISSION_DENIED`, or other terminal recovery-rule error ends the flow:
> explain it and make no further API probes, documentation searches, alternate
> request-shape attempts, or calls against another site. Only the explicitly
> retryable `CONNECTING_USER_LOOKUP_UNAVAILABLE` error permits another connect-URL
> attempt.

Wix stores the Google credentials server-side. The API never returns tokens or
any Google identity — only whether a connection exists and its dates.

## Check the status first

Always start with **Get Connection** and branch on `status`:

| `status` | Meaning | What to do |
|---|---|---|
| `VALID` | Wix holds a credential for this site | Proceed with Google-backed work |
| `NEVER_CONNECTED` | The site has never been connected | Run the connect flow — this is a setup step, not an error |
| `NEEDS_RECONNECT` | The connection record exists but the stored credentials are gone | Warn the owner (see below), then run the connect flow |

`VALID` is not a live health check: **Get Connection** deliberately does not
call Google, so a connection can report `VALID` and still be refused by
Google — for example after the owner revoked Wix's access in their Google
account settings. Treat a Google-side authorization failure on a Locations
call as the authoritative signal and re-run the connect flow when one appears.

## Run the connect flow

1. Call **Get Connect URL** once and read `connectUrl`.
2. Present `connectUrl` to the site owner as a link to open in their own
   browser, where they sign in to Google and grant access. Never fetch or open
   the URL yourself — it is for a human, single-use, and expires after
   15 minutes.
3. Explain that completion is asynchronous: Google redirects the owner's
   browser back to Wix, which finishes the OAuth exchange and stores the
   credentials server-side.
4. When the owner reports they have finished (or while waiting, on a modest
   interval of a few seconds), call **Get Connection** and confirm `status` is
   `VALID`. The `status` field is the only source of truth — a returned
   connect URL alone proves nothing.
5. If the 15-minute window elapses with `status` unchanged, request a fresh
   URL and let the owner try again.

**Get Connect URL is not idempotent, despite its GET route.** Every successful
call creates a distinct live authorization attempt. Never retry it
automatically after a timeout or ambiguous response — re-check
**Get Connection** first and let the owner explicitly start another attempt.

## Warn before a reconnect that replaces the connection

Two flows permanently remove every Business Profile location imported into the
site — the locations created through Wix as well as the imported ones. For
locations migrated from an earlier Wix integration this cannot be reversed by
re-importing. Get the owner's explicit confirmation **before** handing them
the connect URL; there is no confirmation step later:

- **Switching to a different Google account.** No Disconnect is needed — the
  new account simply replaces the connection when its authorization completes.
- **Reconnecting from `NEEDS_RECONNECT`, even with the same Google account.**
  The stored credentials are gone, so there is nothing to match the incoming
  account against and the reconnect is always treated as a replacement.

While credentials are still present (`VALID`), authorizing again with the
**same** Google account heals the connection in place and removes nothing.

Also tell the owner that replacing or disconnecting changes nothing inside
Google Business Profile itself — locations, reviews, and photos stay exactly
as they are on Google — and does not revoke Wix's access inside their old
Google account; they remove that from their Google account settings.

## Disconnect

Call **Disconnect** only after the owner confirms. It deletes the credentials
Wix stores; it does not touch the Google Business Profile and does not revoke
Wix's grant inside the Google account.

## Recovery rules

- **`CONNECTING_USER_LOOKUP_UNAVAILABLE`:** the site-owner lookup failed
  temporarily, before any authorization attempt was created. This is the one
  failure of **Get Connect URL** that is safe to retry.
- **`CONNECTING_USER_NOT_RESOLVABLE`:** Wix could not identify a user to own
  the credential. Stop — this is not retryable until the caller identity or
  site ownership is corrected. Explain the blocker instead of trying other
  request shapes.
- **Timeout or ambiguous response from Get Connect URL:** do not retry. Call
  **Get Connection** to learn the actual state, then let the owner decide.
- **`MULTIPLE_CONNECTIONS_NOT_REPRESENTABLE`:** the site holds more than one
  connection and the API will not guess which one is meant. Not a caller error
  and not retryable — report it and direct the user to contact Wix support.
- **Permission denied:** stop after the first `403` or `PERMISSION_DENIED`.
  Do not retry with another request shape or site, and do not search for an
  alternate API or method. Explain that the current Wix identity is not
  authorized to manage the site's Google connection.

Before the first call, load only the specific public method reference needed to
construct that request so fields and errors come from the live contract. Once a
status or typed error selects a branch above, do not search or browse for an
alternate API, method, or request shape.
