---
name: "Migrate a Wix Site to Headless"
description: Takes an existing Wix site built with Wix Editor, Wix Studio or Wix Harmony headless through the Headless Migration flow in the site's dashboard, so the merchant can replace its frontend with one they code themselves while keeping the site's products, orders, contacts and other business data. Covers the Help Center article that explains the flow, where it starts, what changes and what doesn't, and which sites can start it. Use when the user wants to move, convert, or migrate their Wix site to headless, or to replace their Wix site's frontend with their own code while keeping its business data. Not for creating a new, separate headless site (use Create Headless Site), and not for moving a site from another platform into Wix (use Site Import).
---

# Migrate a Wix Site to Headless

A merchant with a regular Wix site can take it headless without starting over. The Headless Migration flow in the site's dashboard lets them build a new frontend for the same site, with their own AI coding tool, on top of the business data the site already has.

The merchant runs the flow themselves, and a Wix Help Center article explains it end to end. Answer with that article: link it, add the few facts it leaves out (where to start, who can start, availability), and stop. Do not run the migration or any part of it for them.

## When to use

- The user wants to move, convert, or migrate an existing Wix site (built with Wix Editor, Wix Studio or Wix Harmony) to headless.
- The user wants to replace their Wix site's frontend with one they code themselves, and keep its products, orders, contacts and other business data.

For a brand-new, separate headless site, use [Create Headless Site](create-headless-site.md). To bring a site from another platform (Shopify, WooCommerce, any URL) into Wix, use [Site Import](site-import.md).

## Do not

- Do not call the provision API from [Create Headless Site](create-headless-site.md) for this request, with either `newMetasite` or `existingMetasite`. Provisioning headless onto the site skips everything the migration flow exists for: a separate new frontend, previewing it while the live site stays untouched, and an explicit switch.
- Do not create a new site.
- Do not start a [Site Import](site-import.md).
- Do not tell the merchant to rebuild the site from scratch or re-enter their business data.
- Do not call any API for this request, site lookups included. There is no API that starts the migration or checks whether a site can use it.
- Do not repeat the older Help Center article "Developer Request: Migrating an Existing Wix Site to a Wix-Managed Headless Project", which says this can't be done. Point to the article below instead.

## Answer

### 1. Share the Help Center article

Always give this link. It is the merchant's guide to the whole flow:

```
https://support.wix.com/en/article/wix-headless-moving-your-site-to-a-custom-frontend
```

### 2. Say where to start

The article doesn't name the page, and the page isn't in the dashboard sidebar, so add the direct link:

```
https://manage.wix.com/dashboard/{metaSiteId}/oauth-apps-settings
```

If the conversation already carries the site's ID, put it in the link. Otherwise keep `{metaSiteId}` and tell the merchant it's the ID in the address bar when they open that site's dashboard. Don't look the site up.

Tell them what to click. In the **Headless Migration** section, click **Go Headless**.

### 3. Sum up what changes in a few lines

- They build a new frontend for this same site with their own AI coding tool, connected to the site's existing products, orders, contacts and other business data. They can start from a blank frontend or from a copy of the current design.
- Building and previewing don't change the live site, which keeps its current plan. SEO and analytics stay with it until the switch.
- Switching is permanent. The new frontend becomes the live site, the old one is unpublished, and pages that only existed on it are hidden.

Leave the rest to the article.

### 4. State who can start it

A site can start the flow when it:

- is a regular Wix site, not already headless,
- was built with Wix Editor, Wix Studio or Wix Harmony, and
- has a premium domain connected.

Don't make calls to check these yourself. The page decides, so give the merchant the requirements and let the page confirm them. A site that is already headless has nothing to migrate. Its frontend connects through an OAuth app, see [Manage OAuth Apps](manage-oauth-apps.md).

The flow is rolling out site by site and isn't available everywhere yet. You can't see the page, so tell the merchant both cases. If the Headless Migration section isn't on the page, the flow isn't available for their site yet. If the section is there but offers no way to start, the site doesn't meet the requirements above. Stop there. Do not offer Create Headless Site, a new site, or Site Import in its place.

## Example reply

```
You can take "Sunset Spa" headless without rebuilding it. Wix explains the whole process here:
https://support.wix.com/en/article/wix-headless-moving-your-site-to-a-custom-frontend

To start, open your site's Headless settings at
https://manage.wix.com/dashboard/{metaSiteId}/oauth-apps-settings and click Go Headless in the
Headless Migration section.

You'll build a new frontend for this same site with your AI coding tool, connected to your
existing products, orders and contacts. Your live site doesn't change while you build and
preview. When you switch, the new frontend becomes your live site, and that switch is permanent.

The site needs to be built with Wix Editor, Wix Studio or Wix Harmony, not be headless
already, and have a premium domain connected. The flow is still rolling out, so if you don't
see the Headless Migration section on that page, it isn't available for your site yet.
```
