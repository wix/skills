---
name: "Manage Custom Embeds — Sitewide HTML/JS Injection (Head/Body)"
description: "Create/List/Get/Update/Delete Custom Embeds via REST (/embeds/v1/custom-embeds) to inject sitewide HTML/JS into a site's HEAD, BODY_START, or BODY_END. Covers the required premium-plan precondition, revision-based updates, and the consent-gating category behavior that can make a successful write look like it 'didn't show up' in a plain fetch. Use for tracking scripts, analytics tags, chat widgets, banners, and any other sitewide document-level script injection — not for embedding HTML into one specific page's visual layout."
---
# Manage Custom Embeds — Sitewide HTML/JS Injection (Head/Body)

## What this is for

The **Custom Embeds API** injects raw HTML/JavaScript into one of 3 fixed,
document-level insertion points on **every page of a site**:

- `HEAD` — meta tags, CSS, early-loading scripts.
- `BODY_START` — initialization code that needs to run before page content loads.
- `BODY_END` — analytics/tracking scripts, chat widgets, non-critical code.

Typical asks this covers: "add a tracking script/pixel to my site", "add
Google Analytics", "add a chat widget script", "inject this meta tag into
every page's head", "add a sitewide banner script".

**Not for:** embedding HTML into a specific page's visual layout/canvas (the
Editor's `Add Elements > Embed > HTML iframe` component). There is no public
API for that — see
[Custom Code & Embeds — Sitewide Scripts vs. Per-Page Embed Elements](custom-code-and-page-embeds.md)
before reaching for this API on a per-page request.

## Before you begin — premium-plan precondition

**Create, Update, and Delete all return `428 NOT_A_PREMIUM_SITE` on a
non-premium site.** This isn't called out in the API reference itself — if a
write fails with a `428`, that's the cause; don't debug the request body.
`List`/`Get` (read-only) work on any site. Check the site's plan first if you
hit this.

## Required APIs

All endpoints are under `https://www.wixapis.com/embeds/v1/custom-embeds`.
Permission: `EDITOR.CUSTOM_EMBED_*` / scope `SCOPE.EDITOR.MANAGE_CUSTOM_EMBEDS`.

| Action | Method | Endpoint |
|---|---|---|
| [Create Custom Embed](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/create-custom-embed) | `POST` | `/embeds/v1/custom-embeds` |
| [List Custom Embeds](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/list-custom-embeds) | `GET` | `/embeds/v1/custom-embeds` |
| [Get Custom Embed](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/get-custom-embed) | `GET` | `/embeds/v1/custom-embeds/{customEmbedId}` |
| [Update Custom Embed](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/update-custom-embed) | `PATCH` | `/embeds/v1/custom-embeds/{customEmbed.id}` |
| [Delete Custom Embed](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/delete-custom-embed) | `DELETE` | `/embeds/v1/custom-embeds/{customEmbedId}` |

### Create

Required fields: `name`, `position`, `embedData` (with `category` and `html`).

```bash
curl -X POST \
  'https://www.wixapis.com/embeds/v1/custom-embeds' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "customEmbed": {
      "name": "Header Custom Embed",
      "enabled": true,
      "loadOnce": true,
      "position": "HEAD",
      "embedData": {
        "category": "ANALYTICS",
        "html": "<script>console.log(\"hello\")</script>"
      }
    }
  }'
```

The response echoes back the created `customEmbed`, including its `id` and
starting `revision` (`"1"`).

### List / Get

`List` returns up to 100 embeds, sorted by `position`. `Get` fetches one by
`customEmbedId`. Both are unauthenticated by plan tier — use them to find an
embed's current `id`/`revision` before updating it.

### Update — revision required

`Update` requires the **current `revision`** in the request body, alongside
`id` and whichever fields are changing. This isn't optional-with-a-default:
omitting it or sending a stale value fails the call. Always `Get` (or use the
`revision` from your last write) immediately before `Update`.

```bash
curl -X PATCH \
  'https://www.wixapis.com/embeds/v1/custom-embeds/8046df3c-7575-4098-a5ab-c91ad8f33c47' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "customEmbed": {
      "id": "8046df3c-7575-4098-a5ab-c91ad8f33c47",
      "revision": "1",
      "position": "BODY_END",
      "embedData": {
        "category": "ANALYTICS",
        "html": "<script>console.log(\"updated\")</script>"
      }
    }
  }'
```

### Delete

`DELETE /embeds/v1/custom-embeds/{customEmbedId}` — permanent, no revision
needed. Returns `{}` on success, `404 CUSTOM_EMBED_NOT_FOUND` if already gone.

## Gotcha: `embedData.category` gates rendering, not just metadata

`category` isn't a label — it controls **when and whether** the embed
actually renders, based on visitor cookie-consent:

- `ESSENTIAL` — always rendered, unconditionally, immediately in the
  server-rendered HTML. (Never use this for tracking/marketing/analytics
  scripts — it bypasses consent by design and is meant only for
  core-functionality code.)
- `FUNCTIONAL`, `ANALYTICS`, `ADVERTISING`, `DATA_TO_THIRD_PARTY` — subject to
  the visitor's cookie-consent choice. These can legitimately be **absent**
  from a plain `curl`/fetch of the live page even though the write succeeded
  and the site was republished — the visitor (or your test request) simply
  hasn't given consent for that category.

**Live-confirmed:** on a fresh test site, an `ESSENTIAL` embed appeared
immediately in server-rendered HTML; a `FUNCTIONAL` embed with the identical
`position`, created the same way, did not — even after a publish. That's
expected consent-gating behavior, not a bug. Don't misdiagnose a
non-`ESSENTIAL` embed "not showing up" in a bare fetch as a platform failure —
confirm via `Get`/`List` (the write itself) rather than a visitor-side fetch,
or test in a browser with consent granted.

## Gotcha: positions are sitewide, not per-page

`HEAD`/`BODY_START`/`BODY_END` are the only 3 positions, and each is a single
document-level insertion point applied **site-wide** — every page gets the
same injected content. There is no `pageId`/page-scoping way to make an embed
appear on one page's canvas or only on some pages. If the actual request is
"put this HTML inside one specific page's layout," this API is the wrong
tool — see
[Custom Code & Embeds — Sitewide Scripts vs. Per-Page Embed Elements](custom-code-and-page-embeds.md).

## Gotcha: write succeeded but the live site doesn't show it

If `Create`/`Update` return success (confirmed via a follow-up `Get` showing
the new content and bumped `revision`), and it's not an `ESSENTIAL`-vs-consent
issue above, but a fresh cache-busted fetch of the live site — even after a
republish — still doesn't reflect it, that's a distinct, known
live-site-serving issue, not something to keep retrying this API for. See
[Diagnosing: Live Site Not Updating After a Successful Write](diagnosing-live-site-not-updating-after-successful-write.md)
(this recipe's own bisection technique uses a no-publish-required Create
Custom Embed call as the probe).

## Next Steps

- Use `List Custom Embeds` to audit what's already injected before adding more.
- For per-page visual HTML embeds, see [Custom Code & Embeds — Sitewide Scripts vs. Per-Page Embed Elements](custom-code-and-page-embeds.md).
- If a confirmed-successful write isn't reflected live, see [Diagnosing: Live Site Not Updating After a Successful Write](diagnosing-live-site-not-updating-after-successful-write.md).
