---
name: "Manage Custom Embeds"
description: Add, update, list, and delete custom HTML/JS embeds (HEAD, BODY_START, BODY_END) on a Wix site using the Custom Embeds API, and understand how this relates to the classic Editor's Settings > Custom Code panel.
---

# Manage Custom Embeds

This recipe covers injecting custom HTML/JavaScript snippets into a site's pages via the Custom Embeds API — the programmatic equivalent of the classic Editor's **Settings > Custom Code** panel.

## Prerequisites

- Site-level API access
- Permission scope `SCOPE.EDITOR.MANAGE_CUSTOM_EMBEDS`

## Required APIs

- **List Custom Embeds**: `GET https://www.wixapis.com/embeds/v1/custom-embeds`
- **Create Custom Embed**: `POST https://www.wixapis.com/embeds/v1/custom-embeds`
- **Update Custom Embed**: `PATCH https://www.wixapis.com/embeds/v1/custom-embeds/{customEmbed.id}`
- **Delete Custom Embed**: `DELETE https://www.wixapis.com/embeds/v1/custom-embeds/{customEmbedId}`

## Before you use this

- **`ListCustomEmbeds` only returns embeds of type `CUSTOM_EMBED`.** The same underlying storage backs the classic Editor's Settings > Custom Code panel and other embed types (e.g. verification codes, some third-party app embeds), but those other types don't come back from this list call. If a count from this API looks lower than what's visible in the Editor's Custom Code panel, that's expected — it isn't a sign of a separate/disconnected system, just a type filter on this endpoint.
- For the 5 specifically-supported ad/analytics tags (Google Ads, Google Analytics, Google tag, Facebook Pixel, Yandex Metrica), prefer the [Marketing Tags API](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-tags/introduction) instead of a raw custom embed — Wix has first-class handling (consent gating, de-duplication) for those.
- Use category `ESSENTIAL` only for code that must always load regardless of visitor cookie consent (Wix's own guidance: never use `ESSENTIAL` for tracking/marketing/analytics scripts — use `ANALYTICS`/`ADVERTISING` instead so the cookie-consent banner gates them correctly).

## Create a Custom Embed

**Request Body**:
```json
{
  "customEmbed": {
    "name": "My Embed",
    "enabled": true,
    "loadOnce": true,
    "position": "BODY_END",
    "embedData": {
      "category": "FUNCTIONAL",
      "html": "<script>console.log('hello')</script>"
    }
  }
}
```

`position` is one of `HEAD`, `BODY_START`, `BODY_END`. `domain` is optional (used only for your own organizing/filtering, not required for the embed to render).

## Update / Delete

`Update Custom Embed` requires the current `revision` (from a prior `Get`/`List`/`Create` call) — pass it along with the fields to change. `Delete Custom Embed` just needs the `customEmbedId`.

## Verifying the change is live

A create/update/delete here applies on the **next site render** — you do not need to call Publish Site afterward for an **already-published** site. If you don't see the change on the live site after a create/update call succeeded:

1. Re-fetch with `Get`/`List Custom Embeds` and confirm `enabled: true` and the `position`/`revision` you expect were actually persisted (a stale `revision` on Update silently fails with a conflict — check the response, don't assume success from a 200).
2. Confirm you're checking the right position (`HEAD` vs `BODY_START` vs `BODY_END`) and, for non-`ESSENTIAL` categories, that the visitor's cookie consent state would actually allow the script to load.
3. If the site itself is unpublished (draft-only), embeds won't be visible until the site is published at all — see [Create Site from Template](create-site-from-template.md#step-4-publish-the-site-optional) for the Publish Site call.
4. If none of the above explains it, this may be a site-level publish/serving issue unrelated to the embed itself (rare, but has been reported) — don't assume the Custom Embeds API is misbehaving without first confirming other recent site changes (Editor saves, Velo code) are reflected live.
