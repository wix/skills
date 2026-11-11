---
name: "Review and Send Email Campaigns"
description: "Reads a Wix site's email marketing campaigns and reports on them: which campaigns were sent and when, drafts and scheduled campaigns, the subject and content of a campaign (for example whether one mentions a discount code, or its word count), delivery and engagement results, the contacts who received, opened or clicked a campaign, and the site's monthly email quota. Also sends or schedules an existing draft once the user confirms. Use when the user asks about their email campaigns or newsletters, how a campaign performed or who it reached, or wants an existing draft sent."
---

# Review and Send Email Campaigns

Uses the [Campaign API](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/introduction) of Wix Email Marketing. Every call in Steps 1-4 is read-only. Step 5 sends email to real contacts.

All calls are `GET` with query parameters unless the step says otherwise. Repeat an array parameter once per value (`?visibilityStatuses=DRAFT&visibilityStatuses=PUBLISHED`); a comma-joined value returns `400`. Every call below is complete and was run as written: send it without looking up its schema first.

For a link to the campaign in the dashboard, use [Marketing Dashboard Navigation](marketing-dashboard-navigation.md).

## Step 1: List the campaigns

`GET https://www.wixapis.com/email-marketing/v1/campaigns`

```bash
curl -G 'https://www.wixapis.com/email-marketing/v1/campaigns' \
-H 'Authorization: <AUTH>' \
--data-urlencode 'visibilityStatuses=PUBLISHED' \
--data-urlencode 'optionIncludeStatistics=true' \
--data-urlencode 'paging.limit=100' \
--data-urlencode 'paging.offset=0'
```

| Parameter | Values |
|---|---|
| `visibilityStatuses` | `PUBLISHED` (sent, sending, scheduled, in review or stopped; see the Sent? table), `DRAFT`, `TEMPLATE`. Leave it out to list campaigns of every visibility. |
| `statuses` | `ACTIVE`, `ARCHIVED`, `DELETED`. Leave it out to get `ACTIVE` and `ARCHIVED`. |
| `optionIncludeStatistics` | `true` adds `publishingData.statistics` to published campaigns |
| `paging.limit`, `paging.offset` | `limit` is 1-100; `101` and up return `400` |

There is no filter on dates, title or content, and no sort parameter. Results are sorted by `dateUpdated`, newest first, and the response has no total and no `hasNext`. Read every page: add 100 to `paging.offset` until a page returns fewer than 100 campaigns.

Each item in `campaigns[]` holds:

| Field | What it holds |
|---|---|
| `campaignId` | The ID every other call takes |
| `title` | The name in the dashboard; the subject when no title was set |
| `visibilityStatus` | `DRAFT`, `PUBLISHED`, `TEMPLATE` |
| `distributionStatus` | Where delivery stands; see the next table |
| `publishingData.datePublished` | When the campaign was published; only on published campaigns |
| `publishingData.statistics` | Results (Step 3), only with `optionIncludeStatistics=true` |
| `editorType` | `MJML`, `HTML`, `WEB` or `MOBILE`: the format of the content (Step 2) |
| `dateCreated`, `dateUpdated` | Record dates; `dateUpdated` changes on every edit, so it is not the send date |

| `distributionStatus` | Sent? |
|---|---|
| `DISTRIBUTED` | Yes, to the whole audience |
| `SENDING`, `SAMPLING` | Going out now; some contacts have it |
| `TERMINATED` | Only to the sample: sending stopped after the sample failed its checks; `email.notSent` (Step 3) counts the rest |
| `NOT_STARTED` | No |
| `SCHEDULED`, `PAUSED` | No: waiting for its send time, or paused before it |
| `IN_DETECTION`, `IN_MODERATION` | Not yet: in review before sending |
| `REJECTED` | No: blocked before sending |

When the status and the results disagree, the results win: a campaign whose `email.delivered` or `email.bounced` (Step 3) is above 0 reached contacts. Give its status too.

**The last campaign sent:** list with `visibilityStatuses=PUBLISHED` and `optionIncludeStatistics=true`, keep `DISTRIBUTED`, `SENDING`, `SAMPLING` and `TERMINATED`, plus any campaign whose `emailCampaign.delivered` or `emailCampaign.bounced` is above 0, and take the newest `publishingData.datePublished`. Sort by that field in code, because the list is sorted by `dateUpdated`.

**One campaign by name:** read every page and match `title` in code. When several match, ask which one, and show each one's status and date.

One campaign by ID: `GET https://www.wixapis.com/email-marketing/v1/campaigns/<campaignId>` returns it in `campaign`, with the same fields and the same `optionIncludeStatistics` parameter. An unknown ID returns `404`.

## Step 2: Read the subject and content

`GET https://www.wixapis.com/email-marketing/v1/campaigns/<campaignId>/composer`

```json
{
  "composer": {
    "composerDataJson": "{\"mjml\":\"<mjml><mj-body><mj-section><mj-column><mj-text>Use code FALL20 at checkout.</mj-text></mj-column></mj-section></mj-body></mjml>\"}"
  },
  "emailSubject": "Autumn Sale - 20% off",
  "emailPreheader": "This week only"
}
```

`emailSubject` is the subject line. The text of the email is in `composer.composerDataJson`, nested under `composer`. The list in Step 1 holds no content, so a question about what a campaign says needs this call for each campaign. To get the text of an `MJML` or `HTML` campaign:

1. Parse `composer.composerDataJson`: it is a string that holds JSON, not an object. Take the string under its `mjml` key (`editorType` `MJML`) or its `html` key (`editorType` `HTML`). Stripping tags from the unparsed string, or reading `mjml` before parsing, gives an empty or wrong text.
2. Remove the `<mj-head>...</mj-head>`, `<head>...</head>` and `<style>...</style>` blocks.
3. Replace every remaining tag (`<...>`) with a space, so that words in separate blocks do not run together.
4. Decode entities such as `&nbsp;` and `&amp;`, and collapse runs of whitespace.

A word count is the number of whitespace-separated tokens in that text. For example, `<mj-text>Please welcome Maya.</mj-text><mj-text>She teaches on Tuesdays.</mj-text>` gives "Please welcome Maya. She teaches on Tuesdays.", which is 7 words.

- **Did a campaign about a code or topic go out:** list drafts and published campaigns (`visibilityStatuses=DRAFT&visibilityStatuses=PUBLISHED`), read the composer of each, and look for the code in `emailSubject` and in the content, ignoring case. The code is often only in the content, not in the title. Report each match with its status: a published campaign that went out (table in Step 1) was sent; a `DRAFT` that holds the code was not sent, so say so and name the draft.
- **Word count:** for `MJML` and `HTML` campaigns, count the words of the text from `composer.composerDataJson` as above, and do not call Preview: its rendered email adds about 40 words of header and footer. Only for `WEB` and `MOBILE` campaigns, whose content is in a Wix JSON format, take the text from Preview (below).

`POST https://www.wixapis.com/email-marketing/v1/campaigns/<campaignId>/preview` with the body `{}` returns `html` (the rendered email) and `emailSubject`. It sends nothing. Its text also holds the preheader, a "View in browser" line and the Wix footer ("This email was created with Wix...", the unsubscribe line). Leave those out of a word count.

## Step 3: Read the results

`GET https://www.wixapis.com/email-marketing/v1/campaigns/statistics?campaignIds=<id1>&campaignIds=<id2>`

Up to 100 IDs, each as its own `campaignIds` parameter. The response has one entry per campaign in `statistics[]`:

| Field | What it holds |
|---|---|
| `campaignId` | The campaign |
| `email.delivered` | Emails that reached an inbox |
| `email.opened` | Recipients who opened it (unique) |
| `email.clicked` | Recipients who clicked a link (unique) |
| `email.bounced` | Emails that did not arrive |
| `email.complained` | Recipients who reported it as spam |
| `email.notSent` | Audience members it did not reach because sending stopped after sampling |
| `landingPage.opened`, `landingPage.clicked` | Views of and clicks on the campaign's web page |

A count that is zero is left out of the response: read a missing count as `0`. A draft returns only `campaignId`.

Report rates against `email.delivered`: open rate = `opened` / `delivered`, click rate = `clicked` / `delivered`. The same numbers come from Step 1 with `optionIncludeStatistics=true`, under `publishingData.statistics.emailCampaign`, plus `publishingData.statistics.total.mailsSent`.

## Step 4: List the recipients

`GET https://www.wixapis.com/email-marketing/v1/campaigns/<campaignId>/statistics/recipients?activity=CLICKED&paging.limit=1000`

`activity` is required; without it the call returns `400`. Pick the value from the question:

| The user asks | `activity` |
|---|---|
| Who it was sent to | `SENT` (delivered and bounced) |
| Who received it | `DELIVERED` |
| Who opened it / did not open it | `OPENED` / `NOT_OPENED` |
| Who clicked | `CLICKED` |
| Whose email bounced | `BOUNCED` |
| Who it did not reach after sampling stopped | `NOT_SENT` |

Each item in `recipients[]` has `contactId`, `emailAddress`, `fullName`, `lastActivityDate` and `contactDeleted`. `paging.limit` is at most 1000. While `pagingMetadata.cursors.next` is present, send the same request with `paging.cursor=<pagingMetadata.cursors.next>`. Count the recipients yourself: `pagingMetadata.total` is not returned.

For more about the recipients (labels, phone, address), query their contacts by ID, up to 100 IDs per call:

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/contacts/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "query": { "filter": { "id": { "$in": ["<contactId>", "<contactId>"] } }, "paging": { "limit": 100 } } }'
```

The contacts are in `contacts[]`, with labels in `info.labelKeys.items`. To label the people who clicked, use [Bulk Label and Unlabel Contacts](../contacts/bulk-label-and-unlabel-contacts.md).

**Emails used this month:** `GET https://www.wixapis.com/email-marketing/v1/account-details` returns `accountDetails.quotaPeriod.quotaUsage.emails` (sent in this period), `accountDetails.package.monthlyQuotaAllocation.emails` (the plan's limit), `accountDetails.quotaPeriod.dateFrom` and `dateTo`. To break the emails down by campaign, add up `email.delivered` and `email.bounced` (Step 3) of the campaigns published in that period.

## Step 5: Send or schedule a draft

Publishing sends email to real contacts and cannot be undone. Before you send:

1. Find the draft (Step 1) and read its subject (Step 2).
2. Check `accountDetails.status` from `GET https://www.wixapis.com/email-marketing/v1/account-details`. Any value other than `ACTIVE` blocks sending: send the user to the email marketing dashboard. For a scheduled send, also check that `accountDetails.features.scheduling` is `true`.
3. Settle the audience: contact IDs, or contact labels by their `key` (such as `custom.vip-customers`), from `GET https://www.wixapis.com/contacts/v4/labels?paging.limit=100` (`labels[]` with `key` and `displayName`). The call has no "all contacts" option. When the user wants everyone and no label holds them, send them to the dashboard to send it there.
4. Ask the user to confirm, naming the campaign title, the subject, the audience, and the time: now, or the date and time in the site's time zone (`properties.timeZone` from `GET https://www.wixapis.com/site-properties/v4/properties`). Send only after the user answers yes to that question. A first message that asks to send does not count as the confirmation, because it does not name the audience and the subject they will get.

`POST https://www.wixapis.com/email-marketing/v1/campaigns/<campaignId>/publish`

Send now, to a label:

```json
{
  "emailDistributionOptions": {
    "emailSubject": "Autumn Sale - 20% off",
    "labelIds": ["custom.vip-customers"],
    "activeContactsOnly": true
  }
}
```

For contacts, send `"contactIds": ["<contactId>", "<contactId>"]` in place of `labelIds`. Send only the audience fields you use.

Schedule: put `sendAt` inside `emailDistributionOptions`, in UTC, at least 30 minutes and at most one year ahead. A plan without scheduling returns `428 SCHEDULING_FEATURE_UNAVAILABLE`.

```json
{
  "emailDistributionOptions": {
    "emailSubject": "Autumn Sale - 20% off",
    "labelIds": ["custom.vip-customers"],
    "sendAt": "2026-11-20T09:00:00.000Z"
  }
}
```

A `4xx` response means nothing was sent. Do not retry with a different audience or body: tell the user what the error says and give them the campaigns link from [Marketing Dashboard Navigation](marketing-dashboard-navigation.md).

Never send a body without `emailDistributionOptions`, such as `{}`: that publishes the campaign as a web page only, sends no email, and the campaign can never be emailed after that. A campaign that was already published returns `428 ALREADY_PUBLISHED`. The response holds `publishingData.datePublished` and `publishingData.landingPageUrl`. Delivery then moves through `SAMPLING`, `SENDING` and `DISTRIBUTED` in `distributionStatus`.

Full contract: [Publish Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing/campaign/publish-campaign).
