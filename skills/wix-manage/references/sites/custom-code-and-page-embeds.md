---
name: "RECIPE: Custom Code & Embeds — Sitewide Scripts vs. Per-Page Embed Elements"
description: "Clarifies what the Custom Embeds API can and can't do: it injects sitewide HTML/JS at HEAD/BODY_START/BODY_END, but there is no API to read or write the content of a per-page visual embed element (Editor: Add Elements > Embed > HTML iframe). Use this before reaching for the Custom Embeds API to manage per-page embedded HTML/iframe content, especially across many pages or languages."
---

# RECIPE: Custom Code & Embeds — Sitewide Scripts vs. Per-Page Embed Elements

## The two things people mean by "embed" on a Wix site

1. **Sitewide document-level script injection** — tracking pixels, analytics,
   meta tags, chat widgets, a banner. Covered by the **Custom Embeds API**.
2. **A visual HTML/iframe component placed on a specific page's canvas** —
   added in the Editor via **Add Elements > Embed > Embed a Widget/HTML
   iframe**, sized and positioned like any other element, in the content
   flow of one page. **Not covered by any public API.**

These are easy to conflate: the Custom Embeds API's own description says it
embeds "custom HTML and JavaScript code into specific positions on Wix site
pages," which reads as if it could do #2. It can't — don't spend time trying.

## Custom Embeds API — what it's actually for (#1)

`POST/GET/PATCH/DELETE https://www.wixapis.com/embeds/v1/custom-embeds`
([REST docs](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/introduction))

- `position` is one of exactly 3 values: `HEAD`, `BODY_START`, `BODY_END` —
  fixed document-level insertion points, not an arbitrary spot in a page's
  layout.
- `embedData.html` (max 15,000 chars) is the raw HTML/JS to inject.
- Optional `pageFilter.pageIds` scopes an embed to specific pages, but this
  field is **read-only in Create/Update** — you can't set it through this
  API today (it's set by the Editor UI, if at all). Omit it; by default the
  embed applies to all pages.
- Good fits: analytics/marketing scripts, cookie-consent-gated third-party
  tags, a sitewide banner.

## There is no API for #2 (per-page visual HTML/iframe embed elements)

If the user wants to programmatically read or update the HTML content of an
`Add Elements > Embed` component that lives inside a specific page's layout
(not the document head/body edges), stop and tell them directly: **there is
currently no REST or SDK API for this.** Don't keep searching — you won't
find one. Concretely:

- The [Editor SDK Element API](https://dev.wix.com/docs/sdk/host-modules/editor/elements/element/element-properties)
  only supports two element types for programmatic property updates: `text`
  (`text`) and `image` (`src`). There's no `html` element type.
- The Velo `$w` [`HtmlComponent`](https://dev.wix.com/docs/velo/velo-only-apis/$w/html-component/introduction)
  only exposes `src` (a URL), `scrolling`, and `postMessage()`/`onMessage()`
  for iframe messaging — there's no settable `.html` string property. The
  component's raw HTML must be pasted into its settings panel in the Editor,
  per page instance, per component.

## The practical workaround for "the same embed on many pages" at scale

If the actual pain is *"I have to re-paste the same HTML into N page
instances every time it changes"* (common once N gets into double digits,
or ×languages), the fix isn't an API — it's changing what's pasted:

- **Point the embed's `src` at one externally-hosted HTML resource** instead
  of pasting raw HTML into each instance's `embedData`/settings. Do this once
  per page instance in the Editor (or via Velo, `$w('#html1').src = '<url>'`
  in each page's code, from one shared constant). From then on, every future
  content change is a single edit to that one hosted file/URL — not N manual
  re-pastes.
- This still requires setting `src` once per instance (there's no bulk-set
  API), but it collapses every *future* update from N touchpoints to 1.
- For multi-language sites, host one HTML resource per language (or one
  resource that reads a `?lang=` param) so translation updates aren't tied to
  page count.

## Don't do this

- Don't try to use the Custom Embeds API's `position` or `pageFilter` to
  place content inside a page's visual layout — it only ever renders at the
  document head/body edges, never inline in page content.
- Don't tell the user to keep pasting into 24 pages "for now" without
  mentioning the `src`-based workaround above — that's the one lever that
  actually reduces their manual work going forward.
