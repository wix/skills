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

## An internal API for the SEO half already exists — but isn't callable yet

Unlike the page-content gap (fully architectural), the **SEO tags** half is not a "never built" gap — it's a **not-yet-public** one. Wix's `promote-seo` team has an internal `ItemSeoTagsService` (`wix.promote.seo.metatags.v1`, project "site-migration-apis") that is **fully built and in production** with complete get/list/set/reset/bulk/publish support for the `STATIC_PAGE` item type — exactly classic-Editor page SEO tags (title/description/OG via meta tags), including a separate draft/publish revision split.

It is not usable by this MCP or any external caller today: the proto marks it `service_maturity = ALPHA`, `service_exposure = INTERNAL`, and its audience config sets `uou: NOT_ALLOWED` (the exact calling context an agent acting on a user's behalf uses). The team's own design log records the graduation condition explicitly: *"INTERNAL + ALPHA at birth → graduate to PUBLIC when external consumers materialize"* — and separately tracks the REST-gateway exposure work under **WIXSEO-4395**. An AI agent connected via the public Wix MCP hitting exactly this wall, on behalf of a real site owner, is the external-consumer signal that condition is waiting for — worth flagging to the `promote-seo` team (contacts: Yehonatan Zaritsky, primary author of the ItemSeoTagsService implementation; Omer Burshtein, team lead) rather than something fixable from this repo.

Don't attempt to call `ItemSeoTagsService` endpoints speculatively — they aren't in the public REST docs or `lightIndex`, aren't reachable through this MCP's auth context, and guessing at internal paths wastes tool calls for no chance of success.

There is no equivalent internal project (as far as this pass found) for the page **content/body-copy** half — that remains a genuine architectural gap with no known API in flight.

## What this means for a request like "update the copy and SEO on my About page"

1. State plainly that no automated path exists today for either the body-copy edit or the SEO-tag edit — don't loop on tool calls searching for one.
2. The only real option is the manual Editor: log into the classic Editor/Studio Editor (desktop browser — the mobile Editor and Wix Owner app support in-place edits on already-editable text but not all component types reliably) and edit the text and the page's SEO panel (Page Info / SEO settings) directly, then publish.
3. If the user only wants help *drafting* the new copy or SEO title/description, that part (LLM text generation) has nothing to do with this gap — the gap is purely about *persisting* it to the live page without human hands in the Editor.

See also **[[editing-existing-site-pages-menus-and-homepage.md]]** for the sibling gap (structural edits: adding pages, menus, homepage layout, dynamic pages) — same root cause, different edit surface.
