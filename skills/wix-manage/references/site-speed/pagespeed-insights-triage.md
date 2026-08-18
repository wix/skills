---
name: "Triage a Wix Site's Google PageSpeed Insights / Lighthouse Report"
description: Separates PageSpeed Insights (Lighthouse) findings on a Wix site into what's actually fixable through Wix tools (images, Custom Embeds, installed apps) versus what's baseline Wix platform behavior with no site-owner-facing lever. Prevents chasing warnings that no API or dashboard setting can change.
---

# Triage a Wix Site's Google PageSpeed Insights Report

Wix has no PageSpeed/Lighthouse API — there's nothing to poll for a score. The
workflow is: the user runs PageSpeed Insights (or Lighthouse) manually and pastes
or describes the findings, then this recipe sorts each finding into "fixable
here" or "platform baseline, not actionable."

## Fixable through Wix tools

| Finding | Fix |
|---|---|
| Large/uncompressed images ("Improve image delivery", oversized PNGs) | Identify the offending asset via [Media Manager Files API](../media/upload-media-to-wix.md) (`search-files`), tell the user its size/format, have them re-export as JPEG/WebP and re-upload. Wix serves images from `static.wixstatic.com` with `Cache-Control: public, max-age=2592000, immutable` already — the fix is the source file, not caching. |
| "Duplicated JavaScript" / "Legacy JavaScript" / render-blocking scripts from analytics or marketing pixels the user added themselves | List and disable/remove via the [Custom Embeds API](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/introduction) (`ListCustomEmbeds`/`UpdateCustomEmbed`/`DeleteCustomEmbed`). Removing a redundant embed (e.g. two analytics tools loaded at once) directly reduces render-blocking requests and duplicate JS. |
| "More than 4 preconnect connections" caused by the user's own embeds | Same Custom Embeds API — check `position` (`HEAD`/`BODY_START`/`BODY_END`) and `category` (loading priority) on each embed; move non-essential ones out of `HEAD` and out of the `ESSENTIAL` category so they don't compete for early connections. |

## NOT fixable — platform baseline, no site-owner lever

These show up on **every** Wix Editor/Studio site regardless of the user's own
content or embeds. Don't propose an API call or dashboard setting for them —
there isn't one, and testing this live has confirmed why:

- **"Use efficient cache lifetimes" against Wix's own bundles** — not the actual
  cause. Wix's own static assets (`static.parastorage.com`, `static.wixstatic.com`)
  are already served with `Cache-Control: public, max-age=7776000, immutable`
  (90 days). If this audit still shows meaningful savings after removing the
  user's own images/embeds, the remaining weight is almost always a **third-party
  script the user installed** (Google Analytics/GA4, Microsoft Clarity, Meta
  Pixel, etc.) — Google/Microsoft serve those scripts directly from their own
  domains with short cache lifetimes (GA4's `gtag.js` is a well-known ~15
  minute `max-age` industry-wide, on every platform, not just Wix). Wix does not
  proxy or rehost these scripts, so there is no cache-control lever available —
  only removing the third-party tool changes it.
- **"More than 4 preconnect connections"** — Wix's own SSR layer
  (`thunderbolt`'s `preconnectHeadersCalculator`) emits a `Link: rel=preconnect`
  header for the site's own static/media origins (`static.parastorage.com`,
  `static.wixstatic.com`, the site-assets host), intentionally sending both a
  `crossorigin` and a non-`crossorigin` variant per origin because both
  connection-pool types are actually used for different resource fetches. That
  alone produces 5 preconnect hints before the user adds anything. There is
  no dashboard/API control over this — it's baseline platform output on every
  site.
- **"Forced reflow", "LCP breakdown", "Network dependency tree"** — these are
  Lighthouse **diagnostic/informational** sections, not "opportunities" with
  savings. They describe the site's client-hydrated rendering architecture and
  appear on most JS-hydrated sites, Wix or otherwise. Don't report these as bugs
  to fix.

## What to tell the user

If, after fixing everything in the first table, PageSpeed Insights still shows
"Use efficient cache lifetimes," "Duplicated JavaScript," "Legacy JavaScript,"
or "more than 4 preconnect connections" — say so plainly: those are coming from
Wix's own platform code or from a third-party script the user chose to install,
not from anything editable in the Wix Editor/Studio, Velo, or the REST APIs
available here.
