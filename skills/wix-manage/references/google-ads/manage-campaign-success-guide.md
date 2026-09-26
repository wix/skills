---
name: "Manage a Campaign Success Guide"
description: "Campaign Success Guide for existing Wix Google Ads Performance Max Leads campaigns. Use after creating a supported campaign, even while it is learning or has no metrics, and whenever users ask how to improve a campaign, what to fix next, to view the guide, or to mark or reopen a recommendation. Covers campaign and site selection; prioritized actionable recommendations; deduplicated, destination-specific Editor and Google Ads navigation; offers to perform supported work after approval; Merchant Center and Business Profile connection follow-ups; and suggestion-status tracking."
---
# RECIPE: Manage a Campaign Success Guide

A campaign success guide is a prioritized list of improvements for an **existing** Google Ads `PERFORMANCE_MAX_LEADS` campaign. Offer it as a useful next step after [creating a Performance Max campaign](create-performance-max-campaign.md). Once Create Campaign returns the campaign ID, ask whether the user wants to retrieve the guide; call the API only after they approve. The guide does not use campaign performance metrics. It evaluates landing-page content, campaign configuration, and Wix site connections, so `LEARNING` status and an empty analytics history do not block it.

A direct request to improve a campaign, see what to fix next, or show its success guide is itself approval to retrieve the guide once the campaign is identified. Do not ask whether the user wants the guide after they have already made one of those requests. Separate approval is needed only when you proactively offer the guide after campaign creation.

Treat a broad request such as "How can I improve my Google Ads campaign?" as a Campaign Success Guide request for an existing campaign. Route here before offering generic optimization advice, querying analytics, or generating the pre-campaign inputs covered by Get AI Campaign Suggestions. If the conversation does not identify a Wix site or campaign, explain that you will use the guide and ask one focused question that resolves the missing identity; do not probe site-scoped APIs first.

This differs from [Get AI Campaign Suggestions](get-campaign-suggestions.md), which generates keywords, budgets, locations, copy, images, and other inputs used while **building** a campaign. Do not route pre-campaign keyword, budget, creative, or targeting generation here.

## Present every guide as an actionable plan

The first response that presents a retrieved or supplied guide must use the actionable structure below. Do not wait for the user to ask for links, more detail, or a richer guide.

1. Start with the campaign name when known and link `campaignSuccessGuide.url` as the analyzed landing page when present.
2. Show the `OPEN` suggestions in a single-column numbered list, preserving their relative API order:
   - Put the first three under **Start here**, with a user-facing label and one concrete next step each.
   - When more than three remain, put the rest under **Then** as compact one-line actions. Keep their order and do not regroup them by theme or destination.
3. Put `COMPLETED` suggestions in a compact **Completed** section after the open list, preserving their relative API order. The section heading communicates their status; do not repeat a status label on every item.
4. When at least one `OPEN` item has supported agent work, add one **I can help** block that groups what the agent can perform after approval.
5. When at least one `OPEN` item has a verified navigation destination, finish with a **Next actions** block containing each destination exactly once as an absolute Markdown link.

Omit **Then**, **Completed**, **I can help**, or **Next actions** when that section would be empty.

Use Markdown that reads top to bottom. Never use a table, grid, columns, or side-by-side layout for suggestions. Suggestion labels and next steps are content, not controls: do not turn them into links or conversational actions. A manual task stays plain text and points to the shared destination in **Next actions**.

Keep navigation and delegated work distinct:

- Navigation opens a destination and must be an absolute Markdown link such as `[Go to Editor](https://...)`. A bare action label or a follow-up message is not navigation.
- Delegated work asks the agent to do something it actually supports. Group these offers in prose. If suggesting a conversational follow-up, include at most one for the highest-priority supported `OPEN` item and phrase it as an explicit request, such as **Draft FAQ content for me** or **Inspect my site speed**, never as the bare task label **Add an FAQ section**.
- Only `OPEN` suggestions create navigation or offers. Do not offer work or add a destination solely because a related suggestion is `COMPLETED`.

If there are no `OPEN` suggestions, say that nothing currently needs attention, show the completed items when useful, and omit **I can help** and **Next actions**.

## Resolve the campaign

The guide endpoints require a campaign UUID, but users often provide only a campaign name or say "my campaign." Google Ads calls operate on the current Wix site from the call context; the site is not a request-body field. Use an already-selected site context without asking the user to repeat it. If there is no unambiguous current site, ask which site to use instead of probing several sites. Follow the rest of this resolution flow only when retrieving or updating a guide. If the conversation already contains the guide recommendations and the user only wants them presented, do not block the action plan on campaign identity; resolve only the site context needed for relevant navigation.

Site listing is for resolving navigation metadata only. Never use account-wide site listing to hunt for a campaign before retrieving or updating a guide. A current-site ID in the available context counts as an unambiguous selected site even when the user's prompt does not repeat its name. If no current-site ID is available, ask which site to use.

1. If the campaign UUID is known, use it in the current site context.
2. Otherwise, list campaigns once for the current site using the Campaign API's public serverless route:

   ```bash
   curl -X GET 'https://www.wixapis.com/_serverless/pa-google/v1/campaigns' \
     -H 'Authorization: <AUTH>'
   ```

   Use this full URL exactly once. The `/_serverless/pa-google` prefix is part of the public endpoint. Do not retry with a relative URL or another service prefix, or probe another site when the documented call returns an error.

   Read each campaign's `id`, `name`, `campaignType`, and `status`.
3. Select a campaign only when one result clearly matches the user's wording. If several campaigns on that site plausibly match, show concise campaign choices and ask the user to choose; never guess.
4. Continue only for `campaignType: "PERFORMANCE_MAX_LEADS"`. If the selected campaign has another type, explain that campaign success guides currently support Google Ads Performance Max Leads campaigns only. For a supported campaign, do not gate guide retrieval on `status` or query analytics first: `LEARNING` and missing performance metrics are not reasons to wait.

The common flow always sends `platformType: "GOOGLE"`; do not ask the user to provide it.

## Retrieve or create the guide

Skip this call when the conversation already contains a retrieved guide or its recommendations; immediately present the supplied result using the next section instead of retrieving it again or asking for campaign identity. When the user paraphrases recommendation labels, map them to the closest unambiguous suggestion types in the translation table. Wording such as "still need to" or "still to do" means those items are `OPEN`.

When the user only wants a supplied guide presented, this article already contains the response behavior. Do not read the linked action recipes until the user accepts an offer to perform that action; unnecessary recipe reads delay the answer and can prevent the navigation block from being returned.

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

Present only the suggestions the API returns. `suggestions` is already in priority order: preserve the relative order of items inside the **Start here**/**Then** open list and inside the **Completed** section. An empty array means no currently detected items need attention, not an API failure.

`OPEN` means pending action. `COMPLETED` means the user marked the item completed; it does **not** mean the API changed the site or campaign for them.

## Resolve supported work and navigation

The navigation block is part of the guide, including when the user supplied or paraphrased the recommendations. Before responding, resolve the destinations required by the `OPEN` items. Resolving navigation is read-only and does not require approval, including when the user says not to change anything yet. Use the selected site's `id` and `editUrl` from available site context. If the current-site ID is known but `editUrl` is absent, look up the site's navigation metadata through an available site-listing capability once; select only the result whose `id` or `metaSiteId` exactly matches that current-site ID, then read its `displayName`, `editUrl`, and `editorType`. Do not inspect other sites for campaigns. When no current-site ID is known and the lookup returns exactly one site, use it for navigation. When several sites are available and none is selected, present the action plan immediately and ask which site's CTAs to add. If an item belongs in the Editor or Google Ads, include that destination once unless the destination is genuinely unavailable; do not omit navigation merely because no API call was needed to obtain the guide.

### Which action to offer

| Suggestion types | Response behavior |
| --- | --- |
| `CLEAR_CTA_COPY`, `ABOVE_THE_FOLD_CTA`, `HEADER_MATCH`, `CONVERSION_POINT`, `GOOGLE_REVIEWS`, `TESTIMONIAL`, `CONTACT_AND_CREDIBILITY`, `FAQ_SECTION`, `MINIMIZE_FORM_FIELDS`, `SOCIAL_CHANNELS` | These change visible landing-page content. Briefly describe the edit and point to the single **Go to Editor** CTA after the suggestions. If the current environment has a site-editing capability that can safely make the specific change, offer to make it after the user approves; otherwise do not imply that marking the suggestion complete will edit the page. |
| `MOBILE_OPTIMIZATION`, `SITE_SPEED` | Offer to inspect the problem and recommend a concrete fix first; these broad findings are not a safe one-click mutation. Include the single Editor link when the resulting work belongs there. Do not promise an improvement before identifying the actual cause. |
| `GOOGLE_ADS_SEARCH_THEMES` | Offer to generate relevant search themes, show the proposed set, and apply the approved set to the existing campaign by following [Get AI Campaign Suggestions](get-campaign-suggestions.md) and [Manage Campaign Lifecycle](manage-campaign-lifecycle.md). Updating the campaign is a mutation, so do not apply themes merely because the guide returned this item. |
| `GOOGLE_MERCHANT_CENTER_CONNECTION` | Offer to link the Merchant Center account using the account flow below. Reuse an already-linked Merchant Center account ID when present; otherwise ask the user for the ID. Get approval before the account update. Explain that the link begins as `PENDING` and its owner may still need to approve it in Google. |
| `GOOGLE_BUSINESS_PROFILE_CONNECTION` | Offer to check the connection and start it by following [Connect a Wix Site to Google Business Profile](../google-business-profile/connect-google-business-profile.md). Be explicit that the agent can initiate the flow and provide its authorization URL, but the site owner must finish Google's consent in their browser. |

After the tasks, make one closing offer that groups the supported actions you can take; do not append a separate approval question to every item or turn every suggestion into a follow-up action.

For a Merchant Center connection, first read the selected site's Google Ads account:

```bash
curl -X GET 'https://www.wixapis.com/_serverless/pa-google/v1/accounts/current-site' \
  -H 'Authorization: <AUTH>'
```

Read `account.id`, `account.merchantCenterAccountId`, and `account.merchantCenterAccountLinkStatus`. If `merchantCenterAccountId` is present, use it as the existing connection context. If it is absent, ask the user for the account ID shown in Google Merchant Center; the Google Ads account API does not list candidate Merchant Center accounts. After the user confirms the ID and approves the mutation, follow [Install Google Ads and Create an Account](install-and-create-account.md) and update `merchantCenterAccountId` on `account.id`.

### Build destination-specific CTAs

- **Editor:** Include this only when at least one returned `OPEN` item requires landing-page or mobile editing. Use the exact `editUrl` from the selected site context or the single matching result from the site-navigation lookup described above; prefix a relative value with `https://manage.wix.com`. Never construct or guess an Editor URL, and do not substitute the public landing-page URL for an Editor link. If the site is `EDITORLESS` or has no `editUrl`, say that an Editor link is unavailable instead of inventing one. Label the CTA **Go to Editor** or name the more specific editing action; do not label it **Open in Wix**.
- **Google Ads:** Include this only when at least one returned `OPEN` item belongs in Google Ads. Use the verified route from [Google Ads Dashboard Navigation](google-ads-dashboard-navigation.md): `https://manage.wix.com/dashboard/{metaSiteId}/google-ads`. Label the CTA **Go to Google Ads** or name the specific campaign action. Do not include **Open campaign**, **Open campaign dashboard**, or a Google Ads link when every campaign-related suggestion is `COMPLETED`.
- **Other destinations:** Include a destination only when an `OPEN` item has a verified existing URL. Name the page or action precisely, such as **Open Forms dashboard** or **Review site speed**. Never make unrelated links look like the same generic action.
- **Connection flows:** Google Business Profile and Merchant Center recommendations create an offer in **I can help**, not an initial navigation link. Return a task-specific authorization URL only after the user accepts the offer and the connection flow creates it.
- Include only destinations required by `OPEN` suggestions and list each URL once.

Example with several Editor tasks, supported connection work, and a completed campaign task:

```markdown
## Campaign success guide — Request a Quote campaign
Landing page: [Request a quote](https://www.example.com/request-a-quote)

### Start here
1. **Add contact details**
   Show a phone number and email address where visitors can easily find them.
2. **Add an FAQ section**
   Answer the questions prospective customers ask before contacting you.
3. **Connect Google Business Profile**
   Link the profile so campaign and business signals stay connected.

### Then
4. **Connect Google Merchant Center** — Link product data when the campaign is eligible.

### Completed
- **Google Ads search themes**

### I can help
I can draft the FAQ content, check and start the Business Profile connection, and link Merchant Center after you provide its account ID and approve the update. I can start with the FAQ draft.

### Next actions
- [Go to Editor]({absoluteEditUrl})
```

The Editor URL appears once even though several recommendations use it. Search themes create no Google Ads CTA because that recommendation is completed, and the connection items are agent offers rather than unverified navigation links.

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

1. Identify the campaign and a suggestion `type` currently present in its latest guide. Use the current-site ID directly and follow the campaign-resolution flow above; listing that site's campaigns once is valid context resolution, but account-wide site listing is not. Ask one focused site or campaign question only when the current context or campaign results leave more than one plausible target. Do not probe several sites or guess, because the same recommendation type can exist on multiple campaigns.
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
| Authentication or permission error | Stop after the first rejected campaign or guide call and explain that the current collaborator cannot access or modify it. Do not try alternate base URLs, infer that Google Ads is not installed, or probe other sites or endpoints to bypass authorization. |

## References

- [Suggestions API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/introduction)
- [Get or Create Campaign Success Guide](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/get-or-create-campaign-success-guide)
- [Update Campaign Success Guide Suggestion Status](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/update-campaign-success-guide-suggestion-status)
