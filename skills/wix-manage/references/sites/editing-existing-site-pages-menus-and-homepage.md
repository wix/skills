---
name: "Editing Pages, Menus, or Homepage Layout on an Existing Site — Known Gap"
description: There is no REST/MCP API to add pages, edit menus/navigation, or change homepage layout on an already-existing Wix Editor or Studio site. Read this before spending multiple tool calls hunting for one.
---

# Editing Pages, Menus, or Homepage Layout on an Existing Site — Known Gap

## The gap

There is **no REST or MCP API** to do any of the following on a site that already exists (i.e. not a brand-new site you are creating in this session):

- Add, remove, or reorder pages in the site's structure.
- Add or edit menu / navigation items (e.g. link a Stores category page into the site menu).
- Set which page is the homepage.
- Add, remove, or rearrange sections/components on an existing page (hero, gallery, embeds, etc.).

This is a genuine product gap, not a missing recipe — don't keep searching REST docs or trying variations of `CallWixSiteAPI`/`ManageWixSite` calls for "add page", "update menu", "set homepage", etc. It has already been confirmed by a full pass over the REST docs catalog (`BrowseWixRESTDocsMenu` root categories: Articles, App Management, Business Solutions, Assets, CRM, Business Management, Account Level, Tools, Site, Wix Backoffice) and targeted searches for site/page/menu/navigation/homepage terms. The closest-sounding APIs all turn out not to apply:

- **[Add Store Pages to Site](../stores/add-store-pages-to-site.md)** only re-adds the Stores app's own missing cart/checkout pages (`POST /_api/add-pages-to-site/install`) — it cannot add arbitrary pages or link anything into navigation.
- **App Management "Site Extensions" / "Site Plugins" APIs** only let an *installed app* extend predefined slots on pages the app itself owns (e.g. the eCommerce checkout page) — not a way for a site owner (or an agent acting for them) to add general content to their own homepage.
- **Site URLs API's "Get Editor URLs"** only returns a link that opens the real Wix Editor for a *human* to click — it's a redirect, not a way to make edits programmatically.
- **`WixSiteBuilder`** and **`import-claude-design-from-url`** both only create a **brand-new** site (Harmony-generated or from an HTML bundle, respectively) — neither can inject a design or content into an existing site. Reusing an existing site's `jobId` with `WixSiteBuilder` does not work either — see the site-builder-tool gap notes if this comes up.

The underlying reason: classic Wix Editor / Wix Studio page structure, menus, and component layout live in the Editor's own internal document model, which currently has no public write API. This is an architectural gap, not a bug you can retry your way around.

## What this means for a request like "put this homepage design on my existing site"

If the user's site already exists (has a `siteId`, is live, has real content/products) and they want a new homepage design (e.g. a hero, menu, video embed, gallery) applied to it, say so plainly and don't loop on tool calls:

1. **There is no automated way to apply the design to the existing site.** The only path today is for the user (or someone with editor access) to manually place the design in the Wix Editor — **and this requires the desktop browser Editor**. The mobile browser Editor and the Wix Owner mobile app cannot perform structural homepage edits (adding sections, menus, or a video embed) — they only support in-place content edits (text, images, existing e-commerce data) on pages that already have those elements.
2. If the user has no desktop access, the practical options are: (a) find someone with desktop access to do the manual editor work, or (b) accept building a **brand-new** site via `WixSiteBuilder` or `import-claude-design-from-url` with the desired design, then manually reconnect the existing domain to the new site from the dashboard (Domains → connect/reassign) — this still requires a manual dashboard step, and note that the domain-reassignment site-picker has been reported to be unreliable on mobile browsers.
3. Don't imply to the user that the AI agent can "add a menu link" or "set the homepage" via API — it cannot, on either path above.

## Why this matters

A user who doesn't hear this clearly can spend days having an agent retry `import-claude-design-from-url` with different URLs, hunt through docs for a nonexistent pages/menu API, or reuse a `WixSiteBuilder` jobId expecting an edit — all while a fully-prepared design sits unusable because there was never a way to deliver it to their live site.
