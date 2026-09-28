---
name: "Migrate a Wix Site to Headless"
description: Takes an existing Wix site built with Wix Editor, Wix Studio or Wix Harmony headless through the Headless Migration flow in the site's dashboard, so the merchant can replace its frontend with one they code themselves while keeping the site's products, orders, contacts and other business data. Covers where the flow starts, what changes and what doesn't, and which sites can start it. Use when the user wants to move, convert, or migrate their Wix site to headless, or to replace their Wix site's frontend with their own code while keeping its business data. Not for creating a new, separate headless site (use Create Headless Site), and not for moving a site from another platform into Wix (use Site Import).
---

# Migrate a Wix Site to Headless

A merchant with a regular Wix site can take it headless without starting over. The Headless Migration flow in the site's dashboard lets them build a new frontend for the same site, with their own AI coding tool, on top of the business data the site already has.

The merchant starts the flow from the dashboard. It has no public API, so this recipe makes no changes to the site: it resolves the site, gives the merchant the direct link, and tells them what to expect.

## When to use

- The user wants to move, convert, or migrate an existing Wix site (built with Wix Editor, Wix Studio or Wix Harmony) to headless.
- The user wants to replace their Wix site's frontend with one they code themselves, and keep its products, orders, contacts and other business data.

For a brand-new, separate headless site, use [Create Headless Site](create-headless-site.md). To bring a site from another platform (Shopify, WooCommerce, any URL) into Wix, use [Site Import](site-import.md).

## Do not

- Do not call the provision API from [Create Headless Site](create-headless-site.md) for this request, with either `newMetasite` or `existingMetasite`. Provisioning headless onto the site skips everything the migration flow exists for: a separate new frontend, previewing it while the live site stays untouched, and an explicit switch.
- Do not create a new site.
- Do not start a [Site Import](site-import.md).
- Do not tell the merchant to rebuild the site from scratch or re-enter their business data.
- Do not look for an API that starts the migration or checks whether a site can use it. There is none.

## Steps

### 1. Resolve the site's metaSiteId

If the conversation is already scoped to the site, use its ID. Otherwise resolve it with [Query Sites](query-sites.md) (see "Find a site by name") or [Read Account or Site Context](read-site-context.md). If the account has more than one site and the user hasn't said which one, ask which site they mean, and give the rest of the answer anyway with `{metaSiteId}` in the link.

### 2. Send the merchant to the Headless settings page

The page isn't in the dashboard sidebar, so always give the direct link:

```
https://manage.wix.com/dashboard/{metaSiteId}/oauth-apps-settings
```

Tell them what to click. In the **Headless Migration** section, click **Go Headless**. That opens "Migrate to headless site", which takes them through the rest.

### 3. Tell them what changes and what doesn't

- They build a new frontend for this same site with their own AI coding tool, connected to the site's existing business data.
- Nothing changes on the live site until they decide to switch.
- Both frontends share the same dashboard and business data (products, orders, contacts).
- The site keeps its current plan while they build and preview.
- SEO stays as it is until the switch. After the switch, SEO and analytics follow the new frontend.
- They can start from a blank frontend or from a copy of the current design.

### 4. State who can start it

A site can start the flow when it:

- is a regular Wix site, not already headless,
- was built with Wix Editor, Wix Studio or Wix Harmony, and
- has a premium domain connected.

Don't make calls to check these yourself. The page decides, so give the merchant the requirements and let the page confirm them. A site that is already headless has nothing to migrate. Its frontend connects through an OAuth app, see [Manage OAuth Apps](manage-oauth-apps.md).

The flow is rolling out site by site and isn't available everywhere yet. You can't see the page, so tell the merchant both cases. If the Headless Migration section isn't on the page, the flow isn't available for their site yet. If the section is there but offers no way to start, the site doesn't meet the requirements above. Stop there. Do not offer Create Headless Site, a new site, or Site Import in its place.

## Example reply

```
You can take "Sunset Spa" headless without rebuilding it.

1. Open your site's Headless settings: https://manage.wix.com/dashboard/{metaSiteId}/oauth-apps-settings
2. In the Headless Migration section, click Go Headless.

You'll build a new frontend for this same site with your AI coding tool, connected to your
existing products, orders and contacts. Your live site doesn't change until you decide to
switch, it keeps its current plan while you build and preview, and SEO stays as it is until
then. You can start from a blank frontend or from a copy of your current design.

The site needs to be built with Wix Editor, Wix Studio or Wix Harmony, not be headless
already, and have a premium domain connected. The flow is still rolling out, so if you don't
see the Headless Migration section on that page, it isn't available for your site yet.
```
