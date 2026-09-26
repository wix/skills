---
name: "Manage a Campaign Success Guide"
description: "Campaign Success Guide for existing Wix Google Ads Performance Max Leads campaigns. Use after creating a supported campaign, even while it is learning or has no metrics, and whenever users ask how to improve a campaign, what to fix next, to view the guide, or to mark or reopen a recommendation. Covers campaign and site selection; a self-contained, per-task action plan with its own destination-specific Editor and Google Ads navigation; offers to perform supported work inline per task; Merchant Center and Business Profile connection follow-ups; and internal suggestion-status tracking."
---
# RECIPE: Manage a Campaign Success Guide

A campaign success guide is a prioritized list of improvements for an **existing** Google Ads `PERFORMANCE_MAX_LEADS` campaign. Offer it as a useful next step after [creating a Performance Max campaign](create-performance-max-campaign.md). Once Create Campaign returns the campaign ID, ask whether the user wants to retrieve the guide; call the API only after they approve. The guide does not use campaign performance metrics. It evaluates landing-page content, campaign configuration, and Wix site connections, so `LEARNING` status and an empty analytics history do not block it.

A direct request to improve a campaign, see what to fix next, or show its success guide is itself approval to retrieve the guide once the campaign is identified. Do not ask whether the user wants the guide after they have already made one of those requests. Separate approval is needed only when you proactively offer the guide after campaign creation.

Treat a broad request such as "How can I improve my Google Ads campaign?" as a Campaign Success Guide request for an existing campaign. Route here before offering generic optimization advice, querying analytics, or generating the pre-campaign inputs covered by Get AI Campaign Suggestions. If the conversation does not identify a Wix site or campaign, explain that you will use the guide and ask one focused question that resolves the missing identity; do not probe site-scoped APIs first.

This differs from [Get AI Campaign Suggestions](get-campaign-suggestions.md), which generates keywords, budgets, locations, copy, images, and other inputs used while **building** a campaign. Do not route pre-campaign keyword, budget, creative, or targeting generation here.

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

Present the suggestions the API returns, preserving their priority order — batched per the rules below. An empty array means no currently detected items need attention, not an API failure. Show `campaignSuccessGuide.url` when it helps identify the analyzed landing page.

`OPEN` means pending action. `COMPLETED` means the user marked the item completed; it does **not** mean the API changed the site or campaign for them. This status is internal bookkeeping only — see below for what to show the user.

## Present the guide as an actionable plan

Do not return a bare list of task labels. Turn the returned suggestions into a list of independent, self-contained tasks, one per suggestion, preserving the API's order. Do not group suggestions together or defer any part of a task — such as its CTA or its offer to help — into a separate shared block.

Show three tasks per batch, never more, in priority order. Track which `OPEN` suggestions have already been shown this conversation so the next batch continues where the last one left off instead of repeating or reordering. If retrieving the guide again returns items not yet shown, fold them into the remaining batches at their priority position rather than appending them at the end.

Never show suggestion status, or words like "Pending" or "Marked complete," to the user; it's internal state for deciding what to present and for handling reopen requests. Present only `OPEN` suggestions as tasks. Skip `COMPLETED` suggestions entirely rather than listing them without a status, since that would misrepresent finished work as still open. If the user asks what they've already completed, or asks to reopen an item, answer from the internal status without adding status labels to the plan. If every returned suggestion is `COMPLETED`, or the array is empty, say there's nothing pending right now instead of presenting an empty or partial plan.

Build the plan like this:

1. On the first batch only, name the campaign and link `campaignSuccessGuide.url` as the analyzed landing page when present. Later batches in the same conversation open directly with the next task — do not repeat the campaign name or landing-page link.
2. For every `OPEN` suggestion in this batch, show its user-facing label and one concrete next step. Do not show enum values or tracking status unless resolving an ambiguity requires it.
3. Within that same task, first describe the change itself, then say explicitly whether the agent can do it or the user must do it themselves — never leave the second part to be inferred from the presence or absence of a CTA, and never state it before the description. `GOOGLE_ADS_SEARCH_THEMES`, `GOOGLE_MERCHANT_CENTER_CONNECTION`, and `GOOGLE_BUSINESS_PROFILE_CONNECTION` are the only agent-performed actions, each backed by a concrete API call described in its own row below and in the flows that follow the table. Every other suggestion type is on the user — the agent has no capability to edit landing-page content or fix mobile/speed issues itself. For an agent-performed task, follow the description with that row's specific offer (e.g., "...such as 'artisan bakery.' I can propose a relevant set and apply it once you approve."). For every other task, follow the description with a plain, non-commanding note of where the change can be made rather than an instruction directed at the user (e.g., "...without scrolling. This change can be made in the Editor."), paired with the Editor CTA. Never blur the two into one ambiguous sentence.
4. The "Which action to offer" table below states, per suggestion type, whether the task needs a CTA and where it points; place it inline in the task per the rules in "Build destination-specific CTAs" below.
5. If any `OPEN` suggestions remain unshown after this batch, close with an invitation to see more that says where this batch sits in the priority order — don't reuse the same wording for every batch. On the first batch, say it led with the highest-priority tasks (e.g., "I led with the highest-priority tasks. Are you ready to see the rest?"). On later batches, say these are next in priority instead of repeating "led with" (e.g., "These are next in priority. Are you ready to see the rest?"). Skip this invitation once every `OPEN` suggestion has been shown; say so plainly instead (e.g., "That's everything currently open.").

When the user asks for more — whether because they finished the shown tasks, don't think they apply, or are just curious — present the next batch of up to three not-yet-shown `OPEN` suggestions using the same per-task format and the same closing rule above, without repeating the campaign name or landing-page link. This request is itself approval to show the next batch; do not ask for confirmation first.

Resolving navigation is read-only and does not require approval, including when the user says not to change anything yet. Use the selected site's `id` and `editUrl` from available site context. If the current-site ID is known but `editUrl` is absent, look up the site's navigation metadata through an available site-listing capability once; select only the result whose `id` or `metaSiteId` exactly matches that current-site ID, then read its `displayName`, `editUrl`, and `editorType`. Do not inspect other sites for campaigns. When no current-site ID is known and the lookup returns exactly one site, use it. When several sites are available and none is selected, present the tasks that don't need a CTA immediately and ask which site's CTAs to add for the rest.

### Which action to offer

| Suggestion types | Response behavior |
| --- | --- |
| `CLEAR_CTA_COPY`, `ABOVE_THE_FOLD_CTA`, `HEADER_MATCH`, `CONVERSION_POINT`, `GOOGLE_REVIEWS`, `TESTIMONIAL`, `CONTACT_AND_CREDIBILITY`, `FAQ_SECTION`, `MINIMIZE_FORM_FIELDS`, `SOCIAL_CHANNELS` | These change visible landing-page content. **Who does it: the user** — the agent has no capability to edit landing-page content itself, so note, without instructing them, that this change can be made in the Editor. Do not imply that marking the suggestion complete will edit the page for them. **CTA: yes, on this task** — include a **Go to Editor** CTA. |
| `MOBILE_OPTIMIZATION`, `SITE_SPEED` | **Who does it: the agent inspects and recommends; the user implements.** These broad findings are not a safe one-click mutation and the agent cannot make the fix itself, so offer to inspect the problem and recommend a concrete fix first, then note, without instructing them, that making the fix is theirs to do. Do not promise an improvement before identifying the actual cause. **CTA: not until inspected.** Don't add an Editor CTA when first presenting this task — add one, on this task, only once the inspection identifies the fix belongs in the Editor. |
| `GOOGLE_ADS_SEARCH_THEMES` | **Who does it: the agent, after approval.** Offer to generate relevant search themes, show the proposed set, and say the agent will apply the approved set to the existing campaign by following [Get AI Campaign Suggestions](get-campaign-suggestions.md) and [Manage Campaign Lifecycle](manage-campaign-lifecycle.md). Updating the campaign is a mutation, so do not apply themes merely because the guide returned this item. **CTA: no CTA while the offer is pending** — the update itself happens through the offer, not through manual navigation. Once the user approves and the themes are applied, add an **Add Search Themes** CTA on this task, linking directly to that campaign's keywords manager, so they can verify or refine the change. |
| `GOOGLE_MERCHANT_CENTER_CONNECTION` | **Who does it: the agent, after approval.** Offer to link the Merchant Center account using the account flow below. Reuse an already-linked Merchant Center account ID when present; otherwise ask the user for the ID. Get approval before the account update, and say plainly that the agent will make the link. Explain that the link begins as `PENDING` and its owner may still need to approve it in Google. **CTA: no** — the task's own offer covers the action. |
| `GOOGLE_BUSINESS_PROFILE_CONNECTION` | **Who does it: split.** Say explicitly that the agent can initiate the connection flow, but the site owner must finish Google's consent in their browser — this task is neither fully agent-performed nor fully manual, so state both halves. Offer to check the connection and start it by following [Connect a Wix Site to Google Business Profile](../google-business-profile/connect-google-business-profile.md). **CTA: not up front** — include the authorization URL on this task only once the flow creates it. |

For a Merchant Center connection, first read the selected site's Google Ads account:

```bash
curl -X GET 'https://www.wixapis.com/_serverless/pa-google/v1/accounts/current-site' \
  -H 'Authorization: <AUTH>'
```

Read `account.id`, `account.merchantCenterAccountId`, and `account.merchantCenterAccountLinkStatus`. If `merchantCenterAccountId` is present, use it as the existing connection context. If it is absent, ask the user for the account ID shown in Google Merchant Center; the Google Ads account API does not list candidate Merchant Center accounts. After the user confirms the ID and approves the mutation, follow [Install Google Ads and Create an Account](install-and-create-account.md) and update `merchantCenterAccountId` on `account.id`.

### Build destination-specific CTAs

- **Editor:** Add this to a task only when that task's row in "Which action to offer" calls for a CTA. Use the exact `editUrl` from the selected site context or the single matching result from the site-navigation lookup described above; prefix a relative value with `https://manage.wix.com`. Never construct or guess an Editor URL, and do not substitute the public landing-page URL for an Editor link. If the site is `EDITORLESS` or has no `editUrl`, say that an Editor link is unavailable instead of inventing one. Label the CTA **Go to Editor** or name the more specific editing action; do not label it **Open in Wix**. Do not attach a help-center or support-article citation to these tasks. The Editor CTA is the complete, correct destination on its own; a generic grounding search against the public help center can surface an article that superficially matches on wording (e.g., an unrelated product's own "landing page" article) but has nothing to do with this suggestion.
- **Add Search Themes:** The only task that carries this CTA is `GOOGLE_ADS_SEARCH_THEMES`, and only after the applied-theme update completes — never add it while that offer is still pending approval, and never add it to any other suggestion type. Link directly to the campaign's keywords manager using the campaign-scoped route from [Google Ads Dashboard Navigation](google-ads-dashboard-navigation.md): `https://manage.wix.com/dashboard/{metaSiteId}/google-ads/keywords-manager?campaignId={campaignId}`, using the same campaign ID resolved for this guide. Label the CTA **Add Search Themes**.
- **Other destinations:** Name the destination or action in the CTA, such as **Open Forms dashboard**, **Review site speed**, or **Connect Google Business Profile**. Never make several unrelated links look like the same generic action.
- Every task that needs a destination carries its own CTA, even when another task in the same plan points to the same destination. Do not merge same-destination CTAs into one link and do not move any CTA into a shared or closing block. Authorization URLs created by a later connection flow are task-specific; return one only after the user accepts that offer and the flow creates it.

Example:

```markdown
## Campaign success guide
Landing page: [Request a quote](https://www.example.com/request-a-quote)

1. **Clarify the main call to action**
   Make the button describe the conversion, such as "Request a quote." This change can be made in the Editor.
   [Go to Editor]({editUrl})
2. **Move a call to action above the fold**
   Place the primary button where visitors see it without scrolling. This change can be made in the Editor.
   [Go to Editor]({editUrl})
3. **Configure Google Ads search themes**
   Add search themes to sharpen this campaign's targeting. I can propose a relevant set and apply it once you approve.

I led with the highest-priority tasks. Are you ready to see the rest?
```

Each task carries its own CTA and its own offer, and each one describes the change first, then says outright who does the work. Tasks 1 and 2 are on the user — the agent cannot edit landing-page content itself — so both pair their description with the Editor CTA. Task 3 is one of the three agent-performed actions in this recipe (alongside Merchant Center linking and Google Business Profile connection), pending approval. This is one batch of three; the closing line invites the next one only because at least one more `OPEN` suggestion remains unshown.

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

The response wraps the updated guide as `{ "campaignSuccessGuide": { ... } }`. Treat that returned guide as the new source of truth: confirm in plain language which task changed (never the raw status value) and re-present the remaining `OPEN` suggestions as tasks using the same per-task, no-status format from "Present the guide as an actionable plan." Do not claim the underlying recommendation was implemented. Do not update multiple items unless the user's wording clearly identifies all of them.

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
