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
- **[Custom Embeds API](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/introduction)** looks like it should cover "update the HTML of a page component" but doesn't — see the dedicated section below.

The underlying reason: classic Wix Editor / Wix Studio page structure, menus, and component layout live in the Editor's own internal document model, which currently has no public write API. This is an architectural gap, not a bug you can retry your way around.

## What this means for a request like "put this homepage design on my existing site"

If the user's site already exists (has a `siteId`, is live, has real content/products) and they want a new homepage design (e.g. a hero, menu, video embed, gallery) applied to it, say so plainly and don't loop on tool calls:

1. **There is no automated way to apply the design to the existing site.** The only path today is for the user (or someone with editor access) to manually place the design in the Wix Editor — **and this requires the desktop browser Editor**. The mobile browser Editor and the Wix Owner mobile app cannot perform structural homepage edits (adding sections, menus, or a video embed) — they only support in-place content edits (text, images, existing e-commerce data) on pages that already have those elements.
2. If the user has no desktop access, the practical options are: (a) find someone with desktop access to do the manual editor work, or (b) accept building a **brand-new** site via `WixSiteBuilder` or `import-claude-design-from-url` with the desired design, then manually reconnect the existing domain to the new site from the dashboard (Domains → connect/reassign) — this still requires a manual dashboard step, and note that the domain-reassignment site-picker has been reported to be unreliable on mobile browsers.
3. Don't imply to the user that the AI agent can "add a menu link" or "set the homepage" via API — it cannot, on either path above.

## Why this matters

A user who doesn't hear this clearly can spend days having an agent retry `import-claude-design-from-url` with different URLs, hunt through docs for a nonexistent pages/menu API, or reuse a `WixSiteBuilder` jobId expecting an edit — all while a fully-prepared design sits unusable because there was never a way to deliver it to their live site.

## Same gap from the CMS angle: "turn my collection into a page"

The gap above also blocks a distinct, common request: the user already has a CMS/Data collection fully populated (via the Data Items/Collections APIs) and wants it **displayed on the site** — e.g. "put these 18 knowledge-base articles on a page as a grid" or "add a page listing my collection." This looks purely data-related, so it's easy to burn a full CMS session before hitting the same wall:

- There is no REST/MCP API to create a Wix "Dynamic Page" (the List + Item page pair bound to a collection) or to add a collection-backed repeater/grid section to an existing page. The Data Items/Collections/Data Permissions APIs only manage the data itself, never its on-page presentation.
- The **only** entry point for "Add Dynamic Page" is inside the classic Wix Editor or Studio Editor — it is not exposed in the dashboard CMS's own "More Actions" menu, so there's no dashboard-only path either. Reaching it still requires the same desktop-browser Editor session called out above.
- Even after a human manually adds the dynamic page in the Editor, double-check the auto-generated List page's repeater before publishing: the title/description fields typically connect correctly, but the item-linking button (e.g. "Read More") has been observed shipping as **"Not connected"**, producing dead links until manually reconnected via Connect to Data. Don't assume the auto-generated page is fully wired just because the visible text fields populated correctly in preview.

Treat "make my CMS collection visible on a page" the same as the homepage-design case above: state plainly that no API can do the visual/page-composition part, and that the manual Editor step is required — including the repeater-button check.

## Same gap from the per-page HTML/embed angle: "update the HTML iframe embed I pasted into this page"

A distinct request that runs into this same wall: the user (via the Editor's own **Add Elements → Embed → HTML iframe** flow) has manually pasted custom HTML/CSS/JS into an in-page component — often to get design flexibility the native Editor doesn't offer — on several pages (e.g. per-language variants of the same content), and now wants any future edit (a link, a phone number, a shared footer) applied across all of them without hand-pasting into every page again.

The API that looks like it should solve this is the **[Custom Embeds API](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/introduction)** (`List/Create/Get/Update/Delete Custom Embed`) — but it's the wrong tool, and only becomes obvious after inspecting its full schema:

- `position` only accepts `HEAD` / `BODY_START` / `BODY_END` — it injects HTML at the page's head/body boundary, not into the middle of a page's component tree the way "Add Elements → Embed" does.
- `embedData.html` is capped at `maxLength: 15000` — too tight for a full custom-styled section with embedded CSS + JS design system.
- `pageFilter.pageIds` (limiting which pages an embed loads on) is `readOnly` in the schema — even the sitewide-injection API's own page-scoping can't be set by a caller; it's only populated by the Editor's internal document model.

In short: Custom Embeds is built for sitewide tracking/marketing script injection (analytics tags, consent-gated pixels), not for authoring or updating visual page content. **There is no REST/MCP API to read or write the HTML content of a specific in-page HTML/embed component** — it lives in the same Editor internal document model as pages/menus/layout described above, with the same lack of a public write API.

**Practical workaround to suggest:** since the component in question is an `<iframe>`, the user doesn't need a Wix API to fix the multi-page copy-paste problem — they can host the shared HTML/CSS/JS at a single external URL (any static host) and point the iframe's `src` at that URL instead of pasting the code inline into each page's embed box. Future edits then happen once at the external URL and propagate to every page/language variant automatically. This sidesteps the gap entirely and is the recommended answer rather than waiting on a Wix API.

## Same gap from the URL-slug angle: "rename this page's URL / fix a mismatched canonical URL"

A distinct request that hits the same wall: the user wants to change an existing classic-Editor or Studio page's URL path (e.g. a page renamed in the Editor without updating its slug, so it still serves at a stale or wrong-looking path like `/privacy-policy` for a page now called "Wheeled Tiny Homes"). This looks like a pure SEO/metadata edit, so it's easy to assume the [Item SEO Tags API](https://dev.wix.com/docs/api-reference/business-management/seo/item-seo-tags-v1/introduction) covers it — it doesn't:

- A page's URL path (`pageUriSEO` in the Editor's internal document model) is a **structural** property of the page, not an SEO **tag**. The Item SEO Tags API's `tags` field covers title/description/robots/custom meta tags/JSON-LD — it has no field for the page's own URL path.
- There is no other REST/MCP API for it either: Members have `Update My Slug`/`Update Member Slug`, Bookings services have `Set Custom Slug`, Blog posts take their slug via `Update Draft Post` — but classic-Editor/Studio **static pages** have no equivalent. The Editor's own **SEO Basics tab → URL/slug field** is the only place this can be changed.
- Same underlying reason as the rest of this doc: the page's URI lives in the Editor's internal document model, which has no public write API — this isn't a gap specific to SEO tooling.

Treat this the same as the other cases above: state plainly that no API can rename a static page's URL, and that the fix requires a human with desktop-browser Editor access to open Page Settings → SEO Basics → URL and change the slug there.

## Same gap from the full custom-site-migration angle: "faithfully recreate my finished N-page site in Wix Studio"

A distinct request that hits the same wall from the creation side, not the editing side: the user already has a finished, custom multi-page site elsewhere (copy, page architecture, imagery, visual system, internal links, and responsive behavior all already solved) and wants it brought into Wix **as-is** — not rebuilt from a prompt or a template.

[Site Import](site-import.md) is the one tool built for exactly this, but it's gated (limited rollout, `NOT_ENABLED` for most accounts, no self-service path). When it's unavailable, none of the other site-creation tools substitute for it, because they solve a different problem:

- **`WixSiteBuilder`** generates a site from a natural-language prompt (Harmony AI) — it invents layout and copy to fit the prompt, it does not faithfully reproduce a specific existing design/copy/page set.
- **`CreateSiteFromTemplate`** starts from a generic template — the user still has to manually rebuild every page's content and layout to match their finished design.
- **`import-claude-design-from-url`** creates a new site from a single self-contained HTML bundle, but only from a Claude Design export (`claudeusercontent.com`) — it doesn't accept an arbitrary existing site's markup, and doesn't cover multi-page fidelity (internal links, shared nav/footer across pages) even for the one page it can take.

So when Site Import is gated, there is currently **no automated path at all** to bring a finished custom multi-page site into Wix with layout/design fidelity — only a full manual rebuild in the Editor. This is the same root cause as the rest of this doc (the Editor/Studio internal page/layout document model has no public write API), just hit before a site is created rather than after. Say so plainly rather than attempting `WixSiteBuilder` or `CreateSiteFromTemplate` as a "close enough" substitute and hoping the result matches — it won't.

### A last-resort workaround when the user needs the *existing URL* specifically: a full-viewport Custom Embed iframe

If the user's hard requirement is that the design appears **at their existing Wix URL** (not "a Wix site" in general — the URL itself matters, e.g. it's already printed on packaging or shared with customers) and the exact source page is a self-contained, publicly-hosted HTML file, one workaround does deliver pixel-exact visual parity without a native migration: create a [Custom Embed](https://dev.wix.com/docs/api-reference/business-management/custom-embeds/introduction) at `position: BODY_START` on the existing homepage whose `embedData.html` is a single full-viewport `<iframe>` (`position:fixed; inset:0; width:100%; height:100%; border:0`) pointing its `src` at the external page's URL. This overlays the exact external design on top of the existing page at its current address.

This is a brittle band-aid, not a real import, and should only be offered after the user understands the tradeoffs — say these explicitly rather than presenting it as equivalent to a native page:

- It is **not** a real Wix page: none of the pasted content is editable via the Wix Editor, isn't part of the site's SEO/sitemap/page document model, and any future redesign still has to happen on the externally-hosted file, not in Wix.
- It only works reliably if the existing site is served by the **modern render pipeline** — check the `server` response header on the live URL first (`curl -I <url>`): `server: cloudflare` (or similar modern CDN) is fine, but `server: Pepyaka` means the site is on the legacy classic-Editor renderer, where Custom Embeds writes are currently invisible to the live site indefinitely (see the Custom Embeds recipe's staleness-diagnosis note) — the iframe would never actually appear no matter how many times the embed is updated or the site republished.
- The source URL must be a genuinely public, stable HTML resource — an ephemeral or access-gated preview URL will break silently once it expires or access is revoked.

Reach for this only after confirming Site Import is gated and there's no page/layout write API for a native import (i.e. after reading the rest of this doc) — it's a fallback of last resort, not a first suggestion.

## Same gap from the responsive-layout angle: "normalize/reset my page's broken responsive grid — menus overflow, sections have huge empty gaps"

A distinct request that hits the same wall on an **Odeditor (Harmony)** or Studio site whose page structure was already built (by AI generation or by hand) and now renders badly: the header/menu overflows its container on desktop, some sections show content clustered at the top with a large blank area below, and mobile doesn't consistently fit the viewport — even though the source images themselves are intact. The user asks for a one-shot "reset/normalize the responsive layout without rebuilding the catalog or losing content."

There is no REST/MCP API for this, for the same underlying reason as the rest of this doc, plus one more wrinkle specific to layout:

- A page's sections/containers, their grid structure (e.g. a hero section configured as 1 column × 2 rows), and each row/cell's responsive breakpoint behavior all live in the Editor's internal document model — there is no endpoint to read or write any of it. The SDK's `siteSite.getSiteStructure()` (`@wix/site-site`, Velo-only) only returns a flat list of page names/URLs/types, never section/container/grid data, so it doesn't help either — and most Odeditor AI-built sites have Velo disabled by default anyway.
- This isn't just "no reset button" — the underlying editor behavior itself can be fragile: reducing a multi-row grid section (e.g. 1×2 → 1×1) has been observed to pull a *different*, unrelated section's content into the row that remains, instead of just removing the deleted row's own content. Warn the user before they delete a grid row on a multi-section page: check what's actually inside each row first (select each row individually and confirm its content in the Editor's layers panel) rather than assuming row boundaries match section boundaries.
- A specific known trigger for menu/header overflow: a Menu component set to "Adjust to Text" / "Fit to Text" sizing can render wider than its container on desktop. If a report includes an overflowing header, suggest checking the menu's text-fit setting as a first troubleshooting step before assuming the whole page's grid is broken.

Treat this the same as the other cases above: there is no automated "fix/reset the layout" call to make. The only path is manual, section-by-section, desktop-browser Editor work (check each grid row's actual content before resizing it, and check the menu's fit-to-text setting for header overflow) — say so plainly instead of searching for a normalize/reset endpoint that doesn't exist.

## Same gap from the Wix CLI angle: "use the CLI to add my design/code to my existing Editor site"

A distinct entry point into this same wall: an agent (or the user directly) reaches for the **Wix CLI** (`npm create @wix/new@latest`, `wix login`, headless `create`/`create headless link`) expecting it to attach code or a design to the site they already have. Two frictions here are easy to blame on "the CLI is broken," but both are inherent to the product as designed — flag them to the user **before** starting the CLI flow, not after:

- **A fresh interactive device-code login is unavoidable**, even if the user/agent already completed Wix auth for this MCP session. `wix login` (without `--api-key`) is a separate OAuth device-code grant for the local CLI process — there is no token passthrough from an existing MCP/dashboard session, by design.
- **Every Wix CLI project-creation path provisions a brand-new site** — `create headless`, `create headless link` (even when "linking" an existing local project), and `create init` all mint a new managed site. There is no CLI command that attaches to or overwrites an existing classic-Editor/Studio site's content; the CLI docs themselves note that extending an *existing* site's code is a different, separate feature ("Git Integration & Wix CLI for Sites," Studio-only, requires connecting a GitHub repo — still doesn't let you import external page designs).

So if the user's goal is "get my already-designed pages onto my existing Wix Editor site," the CLI is not a shortcut — it's a dead end for that specific goal, and following it just relocates the same page/layout-editing gap into a new, empty site while costing an extra device-code round-trip. Say this upfront and point back to the rest of this doc's options instead of letting the user spend time authenticating into a CLI flow that can't reach their existing site.
