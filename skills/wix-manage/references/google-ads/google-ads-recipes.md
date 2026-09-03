---
name: "Google Ads Recipes"
description: "Google paid advertising for a Wix site — install the Google Ads app and create the account, get AI campaign suggestions, launch and manage Performance Max campaigns, read performance analytics and billing. Use for anything users call Google Ads, paid ads, PPC, campaigns, ad spend, keywords, or advertising."
---

# Google Ads Recipes

Everything here depends on a Google Ads account existing, so **Install Google Ads and Create an Account** is the first stop whenever ads are new to the site or a call fails on a missing account. From there: **Get AI Campaign Suggestions** supplies keyword themes, geo targets and budget tiers to build a campaign from; **Create and Launch a Performance Max Campaign** creates and starts one; **Manage Campaign Lifecycle** handles everything afterwards — launch versus resume, pausing (optionally with auto-resume), and editing budget or targeting. **Query Campaign Performance Analytics** answers how a campaign is doing, and **Retrieve Google Ads Billing and Payment Details** answers what it cost.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Install Google Ads and Create an Account](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/install-google-ads-and-create-an-account)
**Technical:** One-time setup for running Google paid ads on a Wix site: install the Wix
Google Ads app, then create the Google Ads account that every campaign, suggestion, and
analytics call depends on. Covers checking whether an account already exists, choosing a
currency, optionally attaching a promotional incentive (credit offer), linking a Google
Merchant Center account, and deleting an account. Use when the user wants to 'set up
Google Ads', 'connect Google Ads', 'start advertising on Google', 'create a Google Ads
account', or hits an ACCOUNT_NOT_FOUND / app-not-installed error before creating a
campaign. Google Ads REST API, base https://www.wixapis.com/google-ads/v1.

### [Get AI Campaign Suggestions for Google Ads](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/get-ai-campaign-suggestions-for-google-ads)
**Technical:** Reference for the Google Ads Suggestions API on a Wix site:
AI/Google-generated inputs that help build effective campaigns — keyword themes (from a
URL or autocomplete), geo-target options, low/recommended/high daily-budget tiers with
estimated clicks, PMAX budget recommendations, text assets (headlines/descriptions), AI
image assets (auto-uploaded to Wix Media), search themes, promotional incentive offers,
and complete AI-generated campaign configurations from a campaign brief. Use when the
user asks 'suggest keywords for my ads', 'what budget should I use', 'where should I
target', 'generate ad copy/headlines', 'generate ad images', 'suggest a whole campaign',
or when a create-campaign flow needs suggested values. REST base
https://www.wixapis.com/google-ads/v1.

### [Create and Launch a Performance Max Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/create-and-launch-a-performance-max-campaign)
**Technical:** Creates and launches a Google Ads Performance Max (PMAX) campaign for a
Wix site — a goal-based campaign that runs across all Google channels (Search, Display,
YouTube, Gmail, Discover, Maps) from an asset group of headlines, descriptions, images,
and (for PMAX Leads) search-theme signals. Covers generating AI text and image assets,
generating search themes, getting a Google budget recommendation, assembling the asset
group with the required minimum assets, choosing PERFORMANCE_MAX vs
PERFORMANCE_MAX_LEADS (leads: phone/form goals, negative keywords, 28-day learning) vs
retail/Shopping (Merchant Center feed), creating in PAUSED, and launching. Use for
'create a Performance Max campaign', 'PMAX', 'run ads across all of Google', 'lead-gen
Google campaign', or 'Google Shopping ads'. Requires an existing Google Ads account.
REST base https://www.wixapis.com/google-ads/v1.

### [Google Ads Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/google-ads-dashboard-navigation)
**Technical:** Builds a direct link to the Wix Google Ads dashboard page on
manage.wix.com, where campaigns created via the Google Ads API recipes are managed. Use
when the user asks where something is in the Wix dashboard, wants a direct link to a
dashboard page, or you need a dashboard URL to include with the result of an API
operation.

### [Manage Campaign Lifecycle](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/manage-campaign-lifecycle)
**Technical:** Manages existing Google Ads campaigns on a Wix site: list/get, launch
(first activation) vs resume (reactivate after a pause), pause a running campaign —
optionally with a scheduled auto-resume date — update name/budget/targeting, change the
daily budget, delete permanently, and read status history / change log. Use when the
user wants to 'pause my Google ad', 'resume my campaign', 'stop the campaign', 'change
my daily budget', 'rename the campaign', 'delete this campaign', 'list my Google Ads
campaigns', or 'why did my campaign status change'. Requires an existing Google Ads
account and campaign. REST base https://www.wixapis.com/google-ads/v1.

### [Query Campaign Performance Analytics](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/query-campaign-performance-analytics)
**Technical:** Reads performance analytics for a Google Ads campaign on a Wix site:
daily performance metrics (impressions, clicks, CTR, cost, leads, phone calls) with
optional previous-period comparison and trends; conversion metrics from Wix Analytics
(orders, revenue, leads, CPL, ROAS); the search terms that triggered a campaign's ads;
per-product shopping performance for retail campaigns; and per-asset performance
(headlines, descriptions, images) for PMAX Leads. Explains when to use
campaignResourceName vs the Wix campaignId, the dateRange shape, field enums, sorting,
and paging. Use when the user asks 'how is my campaign doing', 'show ad performance',
'what search terms triggered my ads', 'which products/assets perform best', 'campaign
ROI/ROAS', or 'conversions from my Google ads'. REST base
https://www.wixapis.com/google-ads/v1.

### [Retrieve Google Ads Billing and Payment Details](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/skills/retrieve-google-ads-billing-and-payment-details)
**Technical:** Retrieves billing and payment details for a Wix site's Google Ads
account: the current billing period's ad spend (usage), the Wix service fee, the total
charge, any promotional coupon adjustment, the billing period dates, and the account's
credit balance (positive = available credits, negative = outstanding debt not yet
charged). Also explains reading current vs remaining budget from the account object. Use
when the user asks 'how much have I spent on Google Ads', 'what's my next Google Ads
charge', 'show my ad billing', 'do I have ad credits left', 'why was I charged', or
'upcoming Google Ads payment'. Requires an existing Google Ads account. REST base
https://www.wixapis.com/google-ads/v1.
