---
name: "Editing Body Copy or Per-Page SEO Tags on an Existing Editor Page — Known Gap"
description: There is no REST/MCP API to edit the body text/components of an existing classic Wix Editor or Studio page, or to write per-page SEO title/description/OG tags. Read this before spending multiple tool calls hunting for one.
---

# Editing Body Copy or Per-Page SEO Tags on an Existing Editor Page — Known Gap

## The gap

For a page that already exists on a live classic Wix Editor or Studio site, there is **no REST or MCP API** to:

- Edit the page's body copy — the text inside its existing components/sections (a hero headline, a paragraph, a button label, etc.).
- Read or write that page's own SEO tags — title, meta description, or Open Graph image/tags.

This is one of the most common "update my website" requests ("change the wording on my About page" / "fix the SEO title and description on this page"), and it is a full dead end via API today. Confirmed by an exhaustive pass over the indexed REST API spec (`SearchWixAPISpec`'s `lightIndex`, ~389 resources) plus targeted `SearchWixRESTDocumentation` queries for page/SEO terms — no `page`-named resource exists at all, and the only SEO-named resources are:

- **[Resolve Static Page Seo Tags](https://dev.wix.com/docs/api-reference/site/viewer/seo-tags/resolve-static-page-seo-tags)** (`GET /promote/seo/v1/resolve-static-page-seo-tags`) — computes tags **for render-time display only**, given a `pageUrl`/`pageName` you already know. It does not read back what's stored, and there is nothing to persist to.
- **[Update SEO User Config](https://dev.wix.com/docs/api-reference/business-management/marketing/seo/seo-user-config/update-seo-user-config)** — **site-wide** URL-routing settings only (`shouldFlattenUrlHierarchy`, `shouldUsePartialRouteMatch`). Nothing per-page.

The underlying reason content-write is missing: classic Editor / Studio page body content lives in the Editor's own internal document model, which has no public write API — the same root cause as **[[editing-existing-site-pages-menus-and-homepage.md]]** (that doc covers adding/removing whole pages, menus, and homepage layout; this one covers editing the *text already on* an existing page). Don't keep searching REST docs or trying `CallWixSiteAPI`/`ManageWixSite` variations for "update page", "set page content", "update page SEO" — it isn't there.

## Update (2026-08): the SEO half is now public — use the Item SEO Tags API, but read the caveat below first

The `ItemSeoTagsService` described in the rest of this section (`wix.promote.seo.metatags.v1`) has since **graduated to `service_maturity = BETA`, `service_exposure = PUBLIC`**, with the WIXSEO-4395 REST-gateway exposure work now shipped. It is documented, callable through this MCP (`SearchWixRESTDocumentation` for "item seo tags" finds it), and confirmed live-reachable via `CallWixSiteAPI`:

- [Get Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/get-item-seo-tags) — `GET /seo-metatags-server/v1/item-seo-tags/{itemType}/{itemId}`
- [List Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/list-item-seo-tags) — `GET /seo-metatags-server/v1/item-seo-tags/{itemType}`
- [Set Item SEO Tags](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/set-item-seo-tags) — `PATCH /seo-metatags-server/v1/item-seo-tags/{itemType}/{itemId}`, `itemType: STATIC_PAGE` for a classic-Editor/Studio page

So for the **SEO-tag** half of "update the copy and SEO on my page" ("update the title/description of an existing page's SEO tags"), this now IS achievable via API — do not tell the user it's a dead end for SEO tags specifically. The page **body-copy** half below remains a full gap with no API in flight.

### Caveat — `publish: true` on a static page and a follow-up Get/List can disagree

`SetItemSeoTags(itemType: STATIC_PAGE, publish: true)` writes the **published** revision. `GetItemSeoTags`/`ListItemSeoTags` always read the **saved (draft)** revision — there is no way to read the published revision back through this API. Before a fix landed (`wix-private/promote-seo` PR #14969), this made `SetItemSeoTags` itself echo stale, pre-write data in its own PATCH response when `publish: true` was set — indistinguishable from the write silently failing. That part is fixed: the PATCH response now reflects what was just written. But a **separate**, later `GetItemSeoTags`/`ListItemSeoTags` call still only sees the draft revision, so it can keep showing the pre-write text indefinitely after a `publish: true` call — this is a real, currently-open gap (see `wix-private/promote-seo` PR #14972 for the doc note), not a bug in your own call. Don't burn tool calls re-trying `SetItemSeoTags` if a follow-up `GetItemSeoTags` looks unchanged right after a `publish: true` write — check the **live page** (or the Set response itself) instead of trusting a subsequent Get/List for verification.

### Background: how this was discovered internal-only

Wix's `promote-seo` team originally built this service (project "site-migration-apis") gated `service_maturity = ALPHA`, `service_exposure = INTERNAL`, `uou: NOT_ALLOWED`. The team's own design log recorded the graduation condition explicitly: *"INTERNAL + ALPHA at birth → graduate to PUBLIC when external consumers materialize"*. An earlier pass through this exact wall (an AI agent hitting `uou: NOT_ALLOWED` on behalf of a real site owner) was flagged to the team as that external-consumer signal (contacts: Yehonatan Zaritsky, primary author of the `ItemSeoTagsService` implementation; Omer Burshtein, team lead) — it has since shipped.

There is no equivalent internal project (as far as this pass found) for the page **content/body-copy** half — that remains a genuine architectural gap with no known API in flight.

## `ResolveStaticPageSeoTags`'s `custom` field is always `false` for classic-Editor pages — don't use it to verify a per-page override

A later report confirmed a specific symptom of the gap above: calling `ResolveStaticPageSeoTags` on a classic-Editor static page that genuinely has a live, published custom title/description override still returns `"custom": false` on every tag. This is **not a hardcoded value** — `custom` is a real computation (`packages/seo-renderer/src/private/tags/custom/update-custom-tags.ts` in `wix-private/promote-seo`, gated on a non-empty `advancedSeoData` payload) — but a direct public-API caller can never supply that payload for a classic-Editor page. The service's only two sources for a per-page override are (a) `seoData` passed directly in the request — how Wix's own internal Thunderbolt renderer gets it right — or (b) a Vibe/Astro-specific `AppItem` KV store (`fetch-vibe-static-page-seo-data.ts`), whose own doc comment says it returns `undefined` for "editor pages." Neither path can see classic-Editor per-page overrides, so `custom: false` on this API is not evidence a page lacks an override — it means "no override visible to this API," which for classic-Editor pages is always true. Don't use this API to confirm whether a per-page SEO edit is live; there's no API that can (see the gap above).

Separately, per-page custom title/description overrides — once set in the Editor — take precedence over later account-level `siteDisplayName`/Site Properties changes (an update to the account name propagates to the homepage and to any page still on auto-generated tags, but not to a page with its own override already set). This matches normal override-precedence semantics but isn't documented anywhere in the Site Properties or SEO Tags API docs.

## What this means for a request like "update the copy and SEO on my About page"

1. For the **SEO tags** (title/description/OG), use the Item SEO Tags API above (`SetItemSeoTags` with `itemType: STATIC_PAGE`, `publish: true`) — no need to fall back to the manual Editor for this part, but see the caveat above about verifying the result.
2. For the **body copy** (text inside existing components/sections), state plainly that no automated path exists today — don't loop on tool calls searching for one. The only real option is the manual Editor: log into the classic Editor/Studio Editor (desktop browser — the mobile Editor and Wix Owner app support in-place edits on already-editable text but not all component types reliably) and edit the text directly, then publish.
3. If the user only wants help *drafting* the new copy (LLM text generation), that part has nothing to do with the body-copy gap — the gap is purely about *persisting* it to the live page without human hands in the Editor.

See also **[[editing-existing-site-pages-menus-and-homepage.md]]** for the sibling gap (structural edits: adding pages, menus, homepage layout, dynamic pages) — same root cause, different edit surface.
