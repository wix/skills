---
name: "Manage Google Search Console for a Wix Site"
description: "Connect a Wix site to Google Search Console and drive its setup through the public GSC Connection and Site Readiness APIs: check connection and readiness, start the Google authorization, verify ownership, add the property, submit the sitemap, request indexing, read search performance, run URL inspection, recover a stale connection, or disconnect. The site owner authorizes in their own browser via a single-use connect URL."
---

# Manage Google Search Console for a Wix Site

The **GSC Connection API** links a Google account to the site. The **GSC Site
Readiness API** acts through that account: verifies ownership, adds the Search
Console property, submits the sitemap, requests indexing, reads search performance
and URL inspection. Both select the site from the caller's authorization context
and take no site ID. Use the site the environment already supplies; if no site is
selected, list the user's sites once and auto-select the only one, or ask the user
to choose by site name when several are available. Never invent a site ID or ask
the user to type one, and never stop to ask which site before a read.

All endpoints are under `https://www.wixapis.com`: Connection calls under
`/gsc/connection/v1`, everything else under `/gsc/v1`.

## Start every task with two reads

Both are side-effect free. Do them before describing the site's state.

```
GET https://www.wixapis.com/gsc/connection/v1/connection
```

```json
{ "connection": { "status": "VALID", "connectedEmailMasking": "m*******@gmail.com", "ownedByCaller": true } }
```

```
GET https://www.wixapis.com/gsc/v1/site-readiness
```

```json
{ "siteReadiness": { "status": "NOT_READY", "blockingReason": "SITE_OWNER_NOT_VERIFIED" } }
```

Read them together:

| `connection.status` | `siteReadiness` | Meaning | Next |
|---|---|---|---|
| `NOT_CONNECTED` | `NOT_READY` / `SITE_OWNER_NOT_VERIFIED` | No Google account linked | Connect (below) |
| `PENDING` | any | An authorization attempt is open | Ask the user to finish it in their browser, do not start another |
| `VALID` | `READY` | Connected and verified | Property steps if the user wants them |
| `VALID` | `NOT_READY` / `SITE_OWNER_NOT_VERIFIED` | Connected, not verified | Verify Site |
| `INVALID` | `NOT_READY` / `TOKEN_INVALID` | Credentials rejected by Google | Reconnect |
| `VALID` | `NOT_READY` / `DOMAIN_MISSING` | No connected domain | User connects a domain first |

`blockingReason` is `UNKNOWN_BLOCKING_REASON` when the status is `READY`; not an
error. Treat an unrecognized reason as "not ready, no known next action".

`READY` covers connection and verification only. Whether the property was added,
the sitemap submitted, or indexing requested comes from **List Events**.

## `VALID` can be stale, and `MISSING_TOKEN` means reconnect

`INVALID` is only written when a real call to Google is rejected, so a site nobody
has queried since its credentials broke keeps reporting `VALID`. The tell arrives
on the first Google-facing call:

```json
{ "message": "FAILED_PRECONDITION: Missing Token", "details": { "applicationError": { "code": "MISSING_TOKEN" } } }
```

The reference describes `MISSING_TOKEN` as "no Google account is connected"; it
also fires when the stored credentials are gone while Get Connection still said
`VALID`. Either way: the Google account must be reconnected. Do not retry, and do
not tell the user the site is connected.

## Connect a Google account

Get Connect URL is `GET`, but it **writes**: every call starts a new single-use
authorization attempt (two-hour expiry) and Get Connection reports `PENDING` while
it is open. Never call it to "check" anything, and never twice for one attempt. On
an already-connected site it is allowed: the same Google account refreshes the
credentials, a different one replaces the connection. Say which before you do it.

1. Read Get Connection. If `VALID`, stop unless the user wants to reconnect.
2. Call Get Connect URL.

   ```
   GET https://www.wixapis.com/gsc/connection/v1/connect-url
   ```

   ```json
   { "connectUrl": "https://accounts.google.com/o/oauth2/v2/auth?..." }
   ```

3. Give the URL to the user and ask them to tell you when they have finished. Wix
   completes the exchange server-side; there is no code to send back.
4. When the user says they are done, read Get Connection once and confirm `VALID`.
   Do not poll while waiting. If it is still `PENDING`, the user has not finished;
   if the attempt expired (two hours), request a fresh URL only after they agree.

## Writes need a published, indexable site with a connected domain

Get Connect URL, Verify Site, Add Site, and Submit Sitemap fail with
`FAILED_PRECONDITION` until the site is published, has a connected (premium)
domain, and allows indexing. The code names the first failing check:

```json
{ "message": "FAILED_PRECONDITION: The site has no connected domain. Connect a domain before connecting the site to Google Search Console",
  "details": { "applicationError": { "code": "DOMAIN_NOT_CONNECTED" } } }
```

Codes: `SITE_NOT_PUBLISHED`, `DOMAIN_NOT_CONNECTED`, `SITE_NOT_INDEXABLE`. A free
site on a `wixsite.com` address cannot complete these writes. Report the missing
prerequisite and stop. When listing sites to find one that qualifies, filter for
premium sites with a connected domain.

## Set the site up in Search Console

Run the steps the user asked for, in this order, confirming before each write.
Bodies are empty unless shown.

| Step | Call | Notes |
|---|---|---|
| Verify ownership | `POST /gsc/v1/verify-site` with `{ "method": "META" }` | Synchronous against Google, allow up to 60 s. Idempotent. Wix already places the meta tag. |
| Add the property | `POST /gsc/v1/add-site` | Requires a verified site. |
| Submit the sitemap | `POST /gsc/v1/submit-sitemap` | Wix hosts and generates the sitemap. Google processes it asynchronously. |
| Request indexing | `POST /gsc/v1/request-site-indexing` | Success means Google accepted the request, not that the site is indexed. |
| Request one page | `POST /gsc/v1/request-page-indexing` with `{ "url": "https://www.example.com/about" }` | Full URL of a page on this site. |

All succeed with `{}`. Re-read Get Site Readiness after each step and act on the
current `blockingReason`. Verify Site on an already-verified site returns `{}` and
re-stamps the `SITE_VERIFIED` event date: safe, but not a change to report.

Two Google-side failures are retryable. `RESOURCE_EXHAUSTED` (`GOOGLE_QUOTA_EXCEEDED`):
the quota is daily, tell the user to retry tomorrow. `UNAVAILABLE`
(`GOOGLE_UNAVAILABLE`): retry once after a few seconds. On any other error your next
message is the final response: name the step that failed and the error code, and
make no further Search Console calls.

## Check what was done: List Events and List Sitemaps

```
GET https://www.wixapis.com/gsc/v1/events
```

```json
{ "events": [
  { "eventType": "ACCOUNT_CONNECTED", "occurredDate": "2025-10-29T11:10:15.869Z" },
  { "eventType": "SITE_VERIFIED", "occurredDate": "2026-09-07T11:39:31.992Z" },
  { "eventType": "SITE_ADDED", "occurredDate": "2025-10-29T11:07:39.050Z" } ] }
```

One entry per event type with the date it **last** occurred, **not sorted by
date**: never read the last entry as the latest event. Types: `ACCOUNT_CONNECTED`,
`SITE_VERIFIED`, `SITE_ADDED`, `SITEMAP_SUBMITTED`, `SITE_INDEXING_REQUESTED`,
`PAGE_INDEXING_REQUESTED`. A missing type means that step never happened.

```
GET https://www.wixapis.com/gsc/v1/sitemaps
```

```json
{ "sitemaps": [ { "url": "https://www.example.com/blog-posts-sitemap.xml", "type": "sitemap", "pending": false,
  "lastDownloadedDate": "2026-09-05T15:14:47.210Z", "errorCount": "0", "warningCount": "0",
  "contents": [ { "type": "web", "submittedCount": "1", "indexedCount": "1" } ] } ] }
```

Wix submits several sitemaps, typically one per content type. `pending: true` with
an empty `type` means Google has not processed it yet. Counts are strings.

## Read search performance

```
GET https://www.wixapis.com/gsc/v1/search-analytics?startDate=2026-08-01&endDate=2026-08-31&dimensions=query&rowLimit=5
```

```json
{ "results": [ { "keys": ["best of santorini"], "clicks": 0, "impressions": 3, "ctr": 0, "position": 36 } ] }
```

- `startDate` and `endDate` are required, `YYYY-MM-DD`, end inclusive.
- `dimensions` repeats: `date`, `query`, `page`, `country`, `device`,
  `searchAppearance`; omit for one aggregate row. `keys` follow your order.
- `type`: `web` (default), `image`, `video`, `news`. Page with `rowLimit`/`startRow`.
- It is Google's own report: the latest days are usually missing, and there is no
  history from before the property was added. Empty `results` is a real answer.

## Inspect pages

Page IDs are Wix static-page IDs, not URLs. Discover them with the SEO Tags API's
List Item SEO Tags for `STATIC_PAGE` (see the SEO Tags recipe): each `itemId` (for
example `c1dmp`, the homepage) is a `pageId` Inspect URLs takes. Never invent one.

```
POST https://www.wixapis.com/gsc/v1/inspect-urls
```

```json
{ "pageIds": ["c1dmp"], "updateResults": true }
```

```json
{ "results": [ { "page": { "pageId": "c1dmp", "name": "Home", "path": "/", "itemType": "STATIC_PAGE" },
  "status": "OK", "createdDate": "2026-09-07T12:09:55.301Z",
  "data": { "inspectionResultLink": "https://search.google.com/search-console/inspect?...",
    "indexStatusResult": { "verdict": "PASS", "coverageState": "Submitted and indexed",
      "indexingState": "INDEXING_ALLOWED", "lastCrawlTime": "2026-08-16T11:39:45Z",
      "googleCanonical": "https://www.example.com/", "userCanonical": "https://www.example.com/" } } } ],
  "status": "COMPLETE", "remainingPageCount": 0 }
```

- Each page spends one unit of the account's Google quota (2,000 per property per
  day): confirm the page list first. Sites over 2,000 pages fail with
  `SITE_EXCEEDS_INSPECTION_LIMIT`.
- The site stores **one** inspection; without `updateResults: true` a new call
  replaces it. Prefer `true` unless the user wants a clean run.
- `ONGOING`: poll `GET https://www.wixapis.com/gsc/v1/inspection` every few
  seconds until `COMPLETE` or `ERROR` (same shape plus `updatedDate`).
- `remainingPageCount > 0` on `COMPLETE` means quota ran out. Name the missing
  pages; do not call it done.
- `data` is Google's raw URL Inspection payload: read `indexStatusResult.verdict`
  (`PASS`, `PARTIAL`, `FAIL`, `NEUTRAL`) and `coverageState`; text is English only.
  `UNKNOWN_INSPECTION_STATUS` with empty `results` means never inspected.

## Disconnect and clear

Two different removals; confirm which one the user wants.

| Call | Removes | Keeps |
|---|---|---|
| `POST /gsc/connection/v1/disconnect` | Stored Google credentials | Verification tag, Search Console property |
| `POST /gsc/v1/clear-verification` | Verification tag, verification state, **and** credentials | Search Console property |

Neither removes the site from Search Console or revokes Wix's access on Google's
side. Disconnect with no stored credentials returns `NOT_FOUND`
(`CONNECTION_NOT_FOUND`).

## When a call fails

- `403` or `PERMISSION_DENIED`: stop after the first and report the missing SEO
  permission (reads need view access to SEO settings, writes need manage access).
  Do not try another site, path, or method.
- `FAILED_PRECONDITION`: act on `details.applicationError.code` as above. Do not
  retry the same call.
- Get Connect URL is a recovery step only for `MISSING_TOKEN`, `INVALID`, or
  `TOKEN_INVALID`, and only after the user agrees to reconnect.
