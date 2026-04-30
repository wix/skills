# Manual App Dashboard & Listing Guide

Use this guide when the user wants the non-code App Market checks that need
App Dashboard access, Market Listing data, pricing-page previews, screenshots,
or explicit user confirmation. Keep these findings under
`Manual dashboard and marketing follow-up` instead of mixing them into the
technical blocker list.

## How to report manual-only items

- Use Query Market Listing for App Profile and listing fields when app
  credentials and an app ID are available.
- Mark each item as `Confirmed`, `Needs dashboard verification`, or `Needs listing verification`.
- Ask for screenshots, pricing-page previews, or direct user confirmation only
  for fields and rendered assets that the API response cannot verify.
- Do not turn these items into code fixes unless the user separately asks to change copy, assets, or dashboard settings.

## Market Listing API Check

When checking App Profile, listing copy, and market-facing metadata, prefer the
Market Listing query API over screenshots when credentials are available.

- REST: `POST https://www.wixapis.com/devcenter/app-market-listing/v1/marketListings/query`
- SDK: `appMarketListing.queryMarketListing(query)` from `@wix/app-market-listing`
- Query by `appId`, `languageCode`, and the relevant `status`; use `DRAFT` for
  submission review and compare with `PUBLISHED` when validating live listing
  consistency.
- Use WQL filtering, sorting, and paging. The default sort is `createdDate`
  descending, with `paging.limit` 50 and `paging.offset` 0.
- Inspect `basicInfo`, `contactInfo`, `installationRequirement`, `pricingData`,
  and listing assets. For rendered screenshots, image quality, pricing-page
  previews, or dashboard-only settings, keep the item as manual verification.

Docs:
- [Query Market Listing - REST](https://dev.wix.com/docs/api-reference/app-management/market-listing/query-market-listing)
- [Query Market Listing - SDK](https://dev.wix.com/docs/api-reference/app-management/market-listing/query-market-listing?apiView=SDK)

## Submission Prerequisites

- `#11` Security & Privacy form is completed in App Dashboard.
- `#137` A releasable App Profile version exists and the profile is complete.
- `#4` Reviewers have an active demo account, credentials, and supporting notes when the app needs them.
- `#6` Review notes explain subtle flows, hidden setup, or in-app purchases clearly.

## Pricing Page & Billing Configuration

- `#26` Price and billing language match the real cost to the user.
- `#27` In-app purchases are disclosed in the listing description, screenshots, and previews.
- `#34` Prices in the listing match the prices configured in App Dashboard.
- `#126` The pricing page is set up and each plan has clear feature descriptions.
- `#127` Pricing plans include benefit descriptions and are configured correctly.
- `#128` Usage-based pricing pages show the right billing information.
- `#129` The selected pricing model type matches the actual business model.

## App Profile, Listing, and Marketing Assets

Use Query Market Listing first for these fields when possible, then request
rendered previews or screenshots for anything not visible in the response.

- `#138` App Info and description are complete, clear, and correctly formatted.
- `#139` Audience and required Wix products are configured correctly.
- `#140` Category and keywords are relevant.
- `#141` App Profile media meets quality and marketing requirements.
- `#142` Any listed translations are actually implemented.
- `#99` Teaser, features, and description avoid disallowed Wix/stat/data phrasing.
- `#100` Images are high quality and not pixelated.
- `#101` Apps with visual components have a Wix-built demo site.
- `#103` Copy and media stay focused on Wix rather than other platforms.
- `#104` Listing assets do not promise prohibited promotional giveaways.
- `#105` Listing copy does not falsely claim Wix endorsements, sales, or features.
- `#106` Third-party logos follow brand rules and do not imply false affiliation.

## Company, Policy, and Support Info

- `#18` Support email is active and monitored.
- `#19` Documentation and instructions are Wix-specific and easy to follow.
- `#91` Privacy Policy and Terms of Use exist.
- `#143` Privacy Policy link works from App Profile.
- `#144` Company Info is complete and free of broken links.
- `#145` Contact details and support emails are filled in.
- `#146` Company website link is working and professional.
- `#147` Privacy Policy link points to the correct page.
- `#148` Company Info does not need clarification.
- `#149` Support contact email is configured correctly.
- `#150` Contact Info is complete.

## Extension Metadata & Review-Facing Copy

- `#164` Site plugin teaser, icon, and field descriptions are filled in.
- `#153` Widget or component names do not use placeholders.
- `#135` App UI review screenshots and visible copy avoid misleading or non-Wix branding.

## Review Notes

If the user cannot verify these surfaces directly, say so. The right output here
is a manual checklist, not a fabricated pass/fail verdict.
