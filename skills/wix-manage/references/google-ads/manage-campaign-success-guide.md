---
name: "Manage a Campaign Success Guide"
description: "Retrieves and manages the campaign success guide for an existing Wix Google Ads Performance Max Leads campaign. Offer it as an immediate next step after creating a supported campaign, even while it is learning or has no performance metrics yet, but retrieve it only after the user approves. Also use when a user asks how to improve a campaign, what to fix next, or indicates they completed or want to reopen a guide item. Covers campaign selection, retrieving or generating the prioritized guide, waiting up to 120 seconds without premature retries, and updating an unambiguously referenced suggestion without redundant confirmation. REST base https://www.wixapis.com/pa-platform/suggestions/v1."
---
# RECIPE: Manage a Campaign Success Guide

A campaign success guide is a prioritized list of improvements for an **existing** Google Ads `PERFORMANCE_MAX_LEADS` campaign. Offer it as a useful next step after [creating a Performance Max campaign](create-performance-max-campaign.md). Once Create Campaign returns the campaign ID, ask whether the user wants to retrieve the guide; call the API only after they approve. There is no need to wait for the campaign to leave `LEARNING` or generate performance metrics because the guide analyzes the landing page, campaign configuration, and relevant site connections rather than depending on campaign performance data.

Also use this recipe for requests such as "How can I improve my campaign?", "What should I fix next?", "Show my campaign success guide", "I made the call-to-action button clearer as the success guide recommended", "Mark this recommendation complete", or "Reopen that guide item."

This differs from [Get AI Campaign Suggestions](get-campaign-suggestions.md), which generates keywords, budgets, locations, copy, images, and other inputs used while **building** a campaign. Do not route pre-campaign keyword, budget, creative, or targeting generation here.

Base URL: `https://www.wixapis.com/pa-platform/suggestions/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`.

## Resolve the campaign

The guide endpoints require a campaign UUID, but users often provide only a campaign name or say "my campaign."

1. If the user provides a campaign UUID, use it.
2. Otherwise follow [Manage Campaign Lifecycle](manage-campaign-lifecycle.md) and call:

   ```bash
   curl -X GET 'https://www.wixapis.com/google-ads/v1/campaigns' \
     -H 'Authorization: <AUTH>'
   ```

   Read each campaign's `id`, `name`, `campaignType`, and `status`.
3. Select a campaign only when one result clearly matches the user's wording. If none or multiple plausibly match, show concise choices and ask the user to choose; never guess.
4. Continue only for `campaignType: "PERFORMANCE_MAX_LEADS"`. If the selected campaign has another type, explain that campaign success guides currently support Google Ads Performance Max Leads campaigns only. For a supported campaign, do not gate guide retrieval on `status` or query analytics first: `LEARNING` and missing performance metrics are not reasons to wait.

The common flow always sends `platformType: "GOOGLE"`; do not ask the user to provide it.

## Retrieve or create the guide

```bash
curl -X POST \
  'https://www.wixapis.com/pa-platform/suggestions/v1/campaign-success-guides/get-or-create' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "campaignId": "7d4a9c2e-86f1-4b37-a2d5-9e18c6f043ab",
    "platformType": "GOOGLE"
  }'
```

```json
{
  "campaignSuccessGuide": {
    "id": "7d4a9c2e-86f1-4b37-a2d5-9e18c6f043ab",
    "url": "https://www.example.com/request-a-quote",
    "suggestions": [
      {
        "id": "131b82f1-44f5-4f32-8cf1-f783a5f35222",
        "type": "CLEAR_CTA_COPY",
        "status": "OPEN"
      }
    ]
  }
}
```

The first call may analyze the landing page, campaign configuration, and relevant site connections and can take up to **120 seconds**. Later calls normally return the saved guide unless campaign changes require another analysis. Wait for the request; do not retry prematurely. If execution times out with an unknown outcome, report the uncertainty and retrieve the guide later instead of immediately triggering another analysis.

Present only the suggestions the API returns and preserve their order; `suggestions` is already in priority order. An empty array means no currently detected items need attention, not an API failure. Show `campaignSuccessGuide.url` when it helps identify the analyzed landing page.

`OPEN` means pending action. `COMPLETED` means the user marked the item completed; it does **not** mean the API changed the site or campaign for them.

## Translate suggestion types for the user

Keep the enum value unchanged in API calls, but use these labels when explaining the guide:

| Enum | User-facing meaning |
| --- | --- |
| `CLEAR_CTA_COPY` | Clarify the primary call-to-action button's conversion intent. |
| `ABOVE_THE_FOLD_CTA` | Put a call-to-action where visitors can see it without scrolling. |
| `HEADER_MATCH` | Align the landing-page heading with the campaign's ad headlines. |
| `CONVERSION_POINT` | Add a visible lead form or booking action. |
| `GOOGLE_REVIEWS` | Display Google reviews or ratings. |
| `TESTIMONIAL` | Add customer testimonials attributed to named people. |
| `CONTACT_AND_CREDIBILITY` | Display a phone number and email address. |
| `FAQ_SECTION` | Add a visible FAQ section. |
| `MINIMIZE_FORM_FIELDS` | Limit the lead form to four visible fields. |
| `SOCIAL_CHANNELS` | Add a visible social profile link. |
| `GOOGLE_MERCHANT_CENTER_CONNECTION` | Connect Google Merchant Center. |
| `GOOGLE_BUSINESS_PROFILE_CONNECTION` | Connect a Google Business Profile. |
| `GOOGLE_ADS_SEARCH_THEMES` | Configure Google Ads search themes. |
| `MOBILE_OPTIMIZATION` | Improve mobile optimization. |
| `SITE_SPEED` | Improve site speed. |

## Mark an item completed or reopen it

The update endpoint identifies the suggestion by its **`type`**, not its suggestion `id`. A clear statement that the user completed a specific guide recommendation—for example, "I made the call-to-action button clearer as the success guide recommended"—is sufficient instruction to mark that item `COMPLETED`. Do not ask for redundant confirmation.

Before executing an update:

1. Identify the campaign and a suggestion `type` currently present in its latest guide.
2. Match the user's wording to one returned suggestion and infer the requested status only when it is clear: a statement that they completed the recommendation means `COMPLETED`; a request to reopen it means `OPEN`.
3. Execute immediately when the campaign, suggestion, and status are unambiguous. Ask one targeted clarification only when any of them is unclear; never guess.

Mark an item completed:

```bash
curl -X POST \
  'https://www.wixapis.com/pa-platform/suggestions/v1/campaign-success-guides/7d4a9c2e-86f1-4b37-a2d5-9e18c6f043ab/update-suggestion-status' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "CLEAR_CTA_COPY",
    "status": "COMPLETED"
  }'
```

Reopen the same item by sending:

```json
{
  "type": "CLEAR_CTA_COPY",
  "status": "OPEN"
}
```

The response wraps the updated guide as `{ "campaignSuccessGuide": { ... } }`. Treat that returned guide as the new source of truth: report the changed tracking status and summarize remaining `OPEN` suggestions in priority order. Do not claim the underlying recommendation was implemented. Do not update multiple items unless the user's wording clearly identifies all of them.

If a mutation times out with an unknown outcome, do not retry automatically. Retrieve the guide later to determine the current status first.

## Errors

| Error | Response behavior |
| --- | --- |
| `PLATFORM_NOT_SUPPORTED` | Use `GOOGLE`; do not substitute another platform value. |
| `CAMPAIGN_TYPE_NOT_SUPPORTED` | Explain that success guides currently support Google Ads Performance Max Leads campaigns only. |
| `SUGGESTION_NOT_FOUND` | Retrieve the latest guide and choose a `type` actually present; do not keep retrying stale data. |
| Authentication or permission error | Explain that the current collaborator cannot access or modify the campaign; do not bypass authorization. |

## References

- [Suggestions API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/introduction)
- [Get or Create Campaign Success Guide](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/get-or-create-campaign-success-guide)
- [Update Campaign Success Guide Suggestion Status](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/update-campaign-success-guide-suggestion-status)
