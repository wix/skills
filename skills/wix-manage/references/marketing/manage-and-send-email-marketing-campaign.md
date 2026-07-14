---
name: "Manage, Test, and Send an Email Marketing Campaign"
description: "Manages existing Wix Email Marketing (Shoutout) campaigns via the Campaign API: list/get campaigns, send a test email, identify the sending address, publish (send) a campaign to contacts/labels, schedule/reschedule/pause a send, and reuse an existing campaign as a starting point for a new one. The API cannot author or edit a campaign's content (subject line and body must already exist) — that step is Wix-dashboard-only. Use for 'send my newsletter', 'publish this email campaign', 'test my campaign', 'schedule this campaign', 'duplicate my last newsletter', or 'who is my newsletter sent from'."
---
# RECIPE: Manage, Test, and Send an Email Marketing Campaign

## THE PROTOCOL (read this first)

1. **Content authoring is out of scope for this API — check that first.** The Email Marketing (Shoutout) Campaign API has no Create Campaign or Update-content method. A campaign's subject and body can only be authored or edited by a Wix user in the dashboard's visual campaign editor (from scratch or a pre-made template). If the user asks you to "create and send a newsletter" without an existing draft, do not attempt to synthesize campaign content through this API — tell them the content must be created/edited in the dashboard first, then call [List Campaigns](#list-campaigns) to find it once it exists.
2. **If they want to start from something that already exists**, use [Reuse Campaign](#reuse-campaign) to duplicate a past campaign (copies content into a new draft) rather than telling the user no automation path exists at all.
3. **Before publishing**, confirm the sender ([Identify Sender Address](#identify-sender-address)) and, if it's the first send in a while, send a test ([Send Test](#send-test)). Publishing sends real email to real contacts and can't be undone.

---

Base URL for all endpoints: `https://www.wixapis.com/email-marketing/v1`. All write methods require `Shoutout.Manage` permission; reads require `Shoutout.Read`.

**What this recipe covers:** discovering existing campaigns, sending test emails, identifying the sender, publishing/sending, scheduling/rescheduling/pausing a send, and duplicating an existing campaign.

**Not covered here (not supported by this API at all):** creating a brand-new campaign, or authoring/editing a campaign's subject/body content. There is no endpoint for either — see Protocol rule 1.

---

## List Campaigns

**API Endpoint:** `GET /campaigns`

Query params: `statuses` (`ACTIVE`, `ARCHIVED`, `DELETED`), `visibilityStatuses` (`DRAFT`, `PUBLISHED`, `TEMPLATE`), `optionIncludeStatistics`, `paging.limit`/`paging.offset`. Defaults to sorting by `dateUpdated` descending.

```
GET /campaigns?visibilityStatuses=DRAFT&statuses=ACTIVE
```

Use `visibilityStatuses=DRAFT` to find campaigns a user built in the dashboard but hasn't sent yet — this is how you locate the campaign the user means when they say "my newsletter" without an ID.

## Get Campaign

**API Endpoint:** `GET /campaigns/{campaignId}`

Returns `title`, `emailSubject`, `status`, `visibilityStatus`, `distributionStatus` (e.g. `NOT_STARTED`, `SCHEDULED`, `SENDING`, `DISTRIBUTED`, `PAUSED`), and `publishingData` (populated only after publishing — contains `landingPageUrl` and statistics).

## Identify Sender Address

**API Endpoint:** `POST /identify-sender-address`

Body: `{ "emailAddress": "<address>" }`. Returns `{ "senderAddress": "<actual-from-address>" }` — the address that will actually be used as "From" may differ from what you pass (Wix may substitute a verified/default sender). Call this before publishing so you can tell the user who the email will appear to come from.

## Send Test

**API Endpoint:** `POST /campaigns/{campaignId}/test`

Body: `{ "toEmailAddress": "<address>", "emailSubject": "<optional override>" }`. Rate-limited — don't call it repeatedly in a short window.

## Publish Campaign

**API Endpoint:** `POST /campaigns/{campaignId}/publish`

This is the "send" action. Omitting `emailDistributionOptions` publishes the campaign as a landing page only (no email sent) — always include it to actually send:

```json
{
  "emailDistributionOptions": {
    "emailSubject": "Optional override of the campaign's subject",
    "labelIds": ["contacts-all"],
    "contactIds": ["<contact-guid>", "..."],
    "sendAt": "<future ISO 8601 timestamp, optional>"
  }
}
```

- Audience is `labelIds` and/or `contactIds` — recipients must be existing Wix site contacts (no arbitrary external email addresses).
- Sends always go out from the account's current default sender (see [Identify Sender Address](#identify-sender-address)); to send a different campaign from a different sender, update the default sender first.
- Set `sendAt` to schedule instead of sending immediately (must be ≥ 30 minutes in the future; scheduling requires the site to be on a paid Email Marketing plan).
- Response includes `publishingData.landingPageUrl` — the shareable landing page for the campaign, returned even for immediate sends.

## Reschedule

**API Endpoint:** `POST /campaigns/{campaignId}/reschedule`

Body: `{ "sendAt": "<new future ISO 8601 timestamp>" }`. Only valid while the campaign's `distributionStatus` is `SCHEDULED`.

## Pause Scheduling

**API Endpoint:** `POST /campaigns/{campaignId}/pause-scheduling`

Empty body. Pauses a `SCHEDULED` send. To resume with the same audience, call [Get Audience](#get-audience) first to retrieve it, then [Publish Campaign](#publish-campaign) again with that audience.

## Get Audience

**API Endpoint:** `POST /campaigns/{campaignId}/audience`

Empty body. Only valid for a paused campaign — retrieves the `contactIds`/`labelIds`/`segmentIds`/`contactsFilter` that were set when it was published, so they can be passed back into [Publish Campaign](#publish-campaign) without asking the user to re-specify the audience.

## Reuse Campaign

**API Endpoint:** `POST /campaigns/{campaignId}/reuse`

Empty body. Creates a new **draft** copy of an existing campaign (its content, not its audience or send state) — the closest thing to "create" this API offers. Use it when the user wants to send a new newsletter based on a previous one instead of starting from scratch in the dashboard. The new draft still needs [Publish Campaign](#publish-campaign) to actually send.

## List Statistics / List Recipients

**API Endpoints:** `GET /campaigns/statistics` (multiple campaign IDs, e.g. for A/B comparisons) and `GET /campaigns/{campaignId}/statistics/recipients` (filter by activity, e.g. `CLICKED`, `OPENED`).

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| User wants a brand-new newsletter with no existing draft | No Create/Update-content endpoint exists in this API | Tell the user to author it in the dashboard's campaign editor first; once it exists, this recipe manages it (test, publish, schedule) |
| Publish sends no email, only returns a `landingPageUrl` | `emailDistributionOptions` was omitted from the request | Include `emailDistributionOptions` with `labelIds`/`contactIds` to actually send |
| Reschedule or Pause Scheduling fails | Campaign isn't currently `SCHEDULED` | Check `distributionStatus` via [Get Campaign](#get-campaign) first |
| Get Audience returns nothing useful | Campaign isn't currently paused | Only call it on a `PAUSED` campaign, right before republishing |
| Publish fails for a contact/label the user expected to reach | Recipients must be existing Wix site contacts — no arbitrary external addresses | Confirm the label/contact exists in Contacts first |

## References

- [Email Marketing Campaign API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/introduction)
- [Campaign object](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/campaign-object)
- [List Campaigns](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/list-campaigns)
- [Get Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/get-campaign)
- [Send Test](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/send-test)
- [Identify Sender Address](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/identify-sender-address)
- [Publish Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/publish-campaign)
- [Reschedule](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/reschedule)
- [Pause Scheduling](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/pause-scheduling)
- [Get Audience](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/get-audience)
- [Reuse Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/reuse-campaign)
- [List Statistics](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/list-statistics)
- [List Recipients](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/list-recipients)
- [Sample Use Cases and Flows](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/sample-use-cases-and-flows)
