---
name: "Manage a Campaign Success Guide"
description: "Campaign Success Guide for existing Wix Google Ads Performance Max Leads campaigns. Use after creating a supported campaign, even while it is learning or has no metrics, and whenever users ask how to improve a campaign, what to fix next, to view the guide, or to mark or reopen a recommendation. Covers campaign and site selection; prioritized actionable recommendations; deduplicated, destination-specific Editor and Google Ads navigation; offers to perform supported work after approval; Merchant Center and Business Profile connection follow-ups; and suggestion-status tracking."
---
# RECIPE: Manage a Campaign Success Guide

A campaign success guide is a prioritized list of improvements for an **existing** Google Ads `PERFORMANCE_MAX_LEADS` campaign. Offer it as a useful next step after [creating a Performance Max campaign](create-performance-max-campaign.md). Once Create Campaign returns the campaign ID, ask whether the user wants to retrieve the guide; call the API only after they approve. The guide does not use campaign performance metrics. It evaluates landing-page content, campaign configuration, and Wix site connections, so `LEARNING` status and an empty analytics history do not block it.

A direct request to improve a campaign, see what to fix next, or show its success guide is itself approval to retrieve the guide once the campaign is identified. Do not ask whether the user wants the guide after they have already made one of those requests. Separate approval is needed only when you proactively offer the guide after campaign creation.

Treat a broad request such as "How can I improve my Google Ads campaign?" as a Campaign Success Guide request for an existing campaign. Route here before offering generic optimization advice, querying analytics, or generating the pre-campaign inputs covered by Get AI Campaign Suggestions. If the conversation does not identify a Wix site or campaign, explain that you will use the guide and ask one focused question that resolves the missing identity; do not probe site-scoped APIs first.

This differs from [Get AI Campaign Suggestions](get-campaign-suggestions.md), which generates keywords, budgets, locations, copy, images, and other inputs used while **building** a campaign. Do not route pre-campaign keyword, budget, creative, or targeting generation here.

Base URL: `https://www.wixapis.com/pa-platform/suggestions/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`.

## Resolve the campaign

The guide endpoints require a campaign UUID and site context, but users often provide only a campaign name or say "my campaign."

1. Resolve the Wix site from the conversation or available site context. If no site is identifiable, ask which Wix site to use before calling a site-scoped campaign or guide endpoint. Do not guess or probe every accessible site.
2. If the selected site and campaign UUID are both known, use them.
3. If the site is known but the campaign UUID is not, follow [Manage Campaign Lifecycle](manage-campaign-lifecycle.md) and call:

   ```bash
   curl -X GET 'https://www.wixapis.com/google-ads/v1/campaigns' \
     -H 'Authorization: <AUTH>'
   ```

   Read each campaign's `id`, `name`, `campaignType`, and `status`.
4. Select a campaign only when one result clearly matches the user's wording. If several campaigns on that site plausibly match, show concise campaign choices and ask the user to choose; never guess.
5. Continue only for `campaignType: "PERFORMANCE_MAX_LEADS"`. If the selected campaign has another type, explain that campaign success guides currently support Google Ads Performance Max Leads campaigns only. For a supported campaign, do not gate guide retrieval on `status` or query analytics first: `LEARNING` and missing performance metrics are not reasons to wait.

The common flow always sends `platformType: "GOOGLE"`; do not ask the user to provide it.

## Retrieve or create the guide

Skip this call when the conversation already contains a retrieved guide or its recommendations; present the supplied result using the next section instead of retrieving it again.

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

## Present the guide as an actionable plan

Do not return a bare list of task labels. Turn the returned suggestions into a compact action plan while preserving the API's order:

1. Name the campaign and link `campaignSuccessGuide.url` as the analyzed landing page when present.
2. For every returned suggestion, show its user-facing label, tracking status (`Pending` for `OPEN`, `Marked complete` for `COMPLETED`), and one concrete next step. Do not show enum values unless they help resolve an ambiguity.
3. For each `OPEN` item, distinguish work the agent can help perform from work the user must finish in Wix. Prefer an offer to do supported work over instructions that make the user do the same operation manually.
4. Do not offer work for `COMPLETED` items unless the user asks to reopen them.
5. Put each unique navigation link after the suggestions as a destination-specific CTA. Do not group every URL under a generic **Open in Wix** label or reuse that label for unrelated destinations. Name the actual page or action—for example, **Go to Editor**, **Go to Google Ads**, or **Connect Google Business Profile**. Deduplicate by destination: if two or ten tasks require the Editor, include the Editor CTA **once**, at the bottom, and never repeat it beside individual tasks. Apply the same deduplication to the Google Ads dashboard or any other shared destination.

### Which action to offer

| Suggestion types | Response behavior |
| --- | --- |
| `CLEAR_CTA_COPY`, `ABOVE_THE_FOLD_CTA`, `HEADER_MATCH`, `CONVERSION_POINT`, `GOOGLE_REVIEWS`, `TESTIMONIAL`, `CONTACT_AND_CREDIBILITY`, `FAQ_SECTION`, `MINIMIZE_FORM_FIELDS`, `SOCIAL_CHANNELS` | These change visible landing-page content. Briefly describe the edit and point to the single **Go to Editor** CTA after the suggestions. If the current environment has a site-editing capability that can safely make the specific change, offer to make it after the user approves; otherwise do not imply that marking the suggestion complete will edit the page. |
| `MOBILE_OPTIMIZATION`, `SITE_SPEED` | Offer to inspect the problem and recommend a concrete fix first; these broad findings are not a safe one-click mutation. Include the single Editor link when the resulting work belongs there. Do not promise an improvement before identifying the actual cause. |
| `GOOGLE_ADS_SEARCH_THEMES` | Offer to generate relevant search themes, show the proposed set, and apply the approved set to the existing campaign by following [Get AI Campaign Suggestions](get-campaign-suggestions.md) and [Manage Campaign Lifecycle](manage-campaign-lifecycle.md). Updating the campaign is a mutation, so do not apply themes merely because the guide returned this item. |
| `GOOGLE_MERCHANT_CENTER_CONNECTION` | Offer to link the Merchant Center account using the account flow below. Reuse an already-linked Merchant Center account ID when present; otherwise ask the user for the ID. Get approval before the account update. Explain that the link begins as `PENDING` and its owner may still need to approve it in Google. |
| `GOOGLE_BUSINESS_PROFILE_CONNECTION` | Offer to check the connection and start it by following [Connect a Wix Site to Google Business Profile](../google-business-profile/connect-google-business-profile.md). Be explicit that the agent can initiate the flow and provide its authorization URL, but the site owner must finish Google's consent in their browser. |

After the tasks, make one closing offer that groups the supported actions you can take; do not append a separate approval question to every item.

For a Merchant Center connection, first read the selected site's Google Ads account:

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/accounts/current-site' \
  -H 'Authorization: <AUTH>'
```

Read `account.id`, `account.merchantCenterAccountId`, and `account.merchantCenterAccountLinkStatus`. If `merchantCenterAccountId` is present, use it as the existing connection context. If it is absent, ask the user for the account ID shown in Google Merchant Center; the Google Ads account API does not list candidate Merchant Center accounts. After the user confirms the ID and approves the mutation, follow [Install Google Ads and Create an Account](install-and-create-account.md) and update `merchantCenterAccountId` on `account.id`.

### Build destination-specific CTAs

- **Editor:** Include this only when at least one returned `OPEN` item requires landing-page or mobile editing. Use the selected site's exact `editUrl` from available site context. If it is not available, list the accessible sites and read the selected site's `editUrl`; prefix a relative value with `https://manage.wix.com`. Never construct or guess an Editor URL, and do not substitute the public landing-page URL for an Editor link. If the site is `EDITORLESS` or has no `editUrl`, say that an Editor link is unavailable instead of inventing one. Label the CTA **Go to Editor** or name the more specific editing action; do not label it **Open in Wix**.
- **Google Ads:** When a returned item belongs in Google Ads, use the verified route from [Google Ads Dashboard Navigation](google-ads-dashboard-navigation.md): `https://manage.wix.com/dashboard/{metaSiteId}/google-ads`. Label the CTA **Go to Google Ads** or name the specific campaign action.
- **Other destinations:** Name the destination or action in the CTA, such as **Open Forms dashboard**, **Review site speed**, or **Connect Google Business Profile**. Never make several unrelated links look like the same generic action.
- Include only relevant destinations and list each URL once. Authorization URLs created by a later connection flow are task-specific; return one only after the user accepts that offer and the flow creates it.

Example when several tasks share the Editor:

```markdown
## Campaign success guide
Landing page: [Request a quote](https://www.example.com/request-a-quote)

1. **Clarify the main call to action — Pending**
   Make the button describe the conversion, such as “Request a quote.”
2. **Move a call to action above the fold — Pending**
   Place the primary button where visitors see it without scrolling.
3. **Configure Google Ads search themes — Pending**
   **I can help with this:** I can propose relevant themes and apply the set you approve.

I can take care of the search-theme update after you review the proposed set.

### Next actions
- [Go to Editor]({editUrl})
- [Go to Google Ads](https://manage.wix.com/dashboard/{metaSiteId}/google-ads)
```

Each link has its own destination-specific CTA, and the Editor URL appears once even though the first two recommendations both use it.

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

The update endpoint identifies the suggestion by its **`type`**, not its suggestion `id`. A clear statement that the user completed a specific guide recommendation—for example, "I made the call-to-action button clearer as the success guide recommended"—is an actionable request to mark that item `COMPLETED`, not merely an FYI. Do not require the user to turn it into a question or ask for redundant confirmation.

Before executing an update:

1. Identify the campaign and a suggestion `type` currently present in its latest guide. If the conversation and available context contain no site or campaign identity, ask one targeted site-or-campaign selection question before making a read or update call. Do not probe multiple sites, endpoints, or installations to discover context.
2. Match the user's wording to one returned suggestion and infer the requested status only when it is clear: a statement that they completed the recommendation means `COMPLETED`; a request to reopen it means `OPEN`.
3. Execute immediately when the campaign, suggestion, and status are unambiguous. The completion statement is approval for this tracking-status update; do not ask a redundant confirmation question. Ask one targeted clarification only when identity, suggestion, or intended status is unclear; never guess.

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

```json
{
  "campaignSuccessGuide": {
    "id": "7d4a9c2e-86f1-4b37-a2d5-9e18c6f043ab",
    "suggestions": [
      {
        "type": "CLEAR_CTA_COPY",
        "status": "COMPLETED"
      },
      {
        "type": "FAQ_SECTION",
        "status": "OPEN"
      }
    ]
  }
}
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
| Authentication or permission error | Stop after the first rejected campaign or guide call. If no Wix site was selected, ask one targeted site-selection question rather than diagnosing the account or trying another endpoint. If a site was selected, explain that the current collaborator cannot access or modify it. Do not try alternate base URLs, infer that Google Ads is not installed, or probe other endpoints to bypass authorization. |

## References

- [Suggestions API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/introduction)
- [Get or Create Campaign Success Guide](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/get-or-create-campaign-success-guide)
- [Update Campaign Success Guide Suggestion Status](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/update-campaign-success-guide-suggestion-status)
