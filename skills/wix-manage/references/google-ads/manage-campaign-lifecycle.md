---
name: "Manage Campaign Lifecycle"
description: "Manages existing Google Ads campaigns on a Wix site: list/get, launch (first activation) vs resume (reactivate after a pause), pause a running campaign — optionally with a scheduled auto-resume date — update the campaign itself (name, budget, geo targets, ad schedule, keyword themes, assets), delete permanently, and read status history / change log. An update is a whole-entity replace, not a patch: get the campaign first and send every field back with the change applied, or the fields you omit are wiped. Use when the user wants to 'pause my Google ad', 'resume my campaign', 'stop the campaign', 'change my daily budget', 'rename the campaign', 'add a city to my targeting', 'delete this campaign', 'list my Google Ads campaigns', or 'why did my campaign status change'. Requires an existing Google Ads account and campaign. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Manage Campaign Lifecycle

Operate on campaigns that already exist. Base URL: `https://www.wixapis.com/google-ads/v1`; `<AUTH>` = `Authorization` header, and body calls also need `Content-Type: application/json`.

**Answer directly.** When the user asks *how* to do something, give the endpoint, an example request, and the key behavior right away — use `{campaignId}` as a placeholder rather than asking which campaign. Only pause to confirm when you are about to **execute** a launch, resume, update, or delete on the user's behalf (those spend money or are irreversible); explaining how never requires confirmation. **Executing an update is the one flow that also always needs the real campaign first** — see *Update a campaign* below.

> **Launch vs Resume — the key distinction.** **Launch** activates a campaign for the *first time* (`POST /v1/campaigns/{campaignId}/launch`). **Resume** reactivates one that was live and then *paused* (`POST /v1/campaigns/{campaignId}/resume`). Both move it to `LIVE` and both count against the **5-live-campaigns-per-site** cap.

## Read

- **List:** `GET /v1/campaigns` → `{ "campaigns": [ { "id", "campaignType", "status", "name", "budget": { "amountMicros" } } ] }`
- **Get one:** `GET /v1/campaigns/{campaignId}` — takes a campaign id only; resolve a name to an id with the list call first. `status` and `budget` are synced live from Google on each read.

`status` (read-only, can change on its own via policy/billing): `DRAFT`, `LIVE`, `PAUSED`, `LEARNING` (PMAX Leads, ~28d post-launch), `IN_REVIEW`, `DISAPPROVED`, `NOT_SERVING` (budget), `ENDED`, `ERROR`.

## Launch / Pause / Resume

```bash
# Launch (first activation)  → status LIVE
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/launch' -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'

# Pause a running campaign (settings + data preserved) → status PAUSED
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/pause' -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "scheduledResumeDate": "2024-04-15T08:00:00.000Z" }'

# Resume a paused campaign → status LIVE
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/resume' -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'
```

- **Pause** stops delivery immediately without losing configuration. Optional body fields: `scheduledResumeDate` (ISO 8601 — the campaign **auto-resumes** at that time; pass `null` to cancel a scheduled resume), `resumeReminderDate` (dashboard reminder), `turnAutoRenewOff`. Send `{}` to pause with no auto-resume. To temporarily stop a campaign, **pause it — never delete**.
- **Resume** accepts `{ "turnAutoRenewOn": true }` to re-enable subscription auto-renewal. Fails with `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` if 5 are already live.

## Update a campaign — read it first, send it whole

`PATCH /v1/campaigns/{campaignId}` **replaces what the payload names.** Every writable field you leave out, and every value you drop from an array you did send, is removed from the campaign. A budget-only body strips the name, geo targets, keyword themes and asset group; a `locations` array holding one entry deletes the other geo targets. The call still returns `200` — the damage is silent, and a campaign left without its targeting or assets stops serving or has to be rebuilt.

**So the payload is never assembled from what the user asked for.** The user supplies the *change* ("make it $30 a day", "rename it to Spring Sale"), usually with a campaign name at best. The body has to be the *whole campaign* with that change applied — which you cannot produce without reading the campaign first.

1. **Get the current entity — `GetCampaign`, `GET /v1/campaigns/{campaignId}`.** It takes an id and nothing else; there is no lookup by name. When the user gave a name (or nothing), call **`ListCampaigns`** — `GET /v1/campaigns` — find the entry whose `name` matches, take its `id`, and then read that campaign. Ask the user which one they mean when more than one matches, and never guess.
2. **Apply the change to the returned `campaign` object, in place.** Touch only what the user asked for; leave every other field at the value the read returned.
3. **Show the user what changes** — the old value and the new one — and get their approval, then **`PATCH` that entire object back**, fields you changed and fields you didn't.
4. **Read it back and check.** A `200` proves the body parsed, not what was stored — re-`GET` and confirm the untouched fields are still there.

Never skip step 1 because the change looks small. Changing one number still sends the full entity.

```bash
# 1. Read the current campaign
curl -s 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}' \
  -H 'Authorization: <AUTH>' > campaign.json

# 2. Change ONLY the daily budget; every other field stays exactly as it was read
jq '{ campaign: (.campaign | .budget.amountMicros = "30000000") }' campaign.json > update.json

# 3. Send the whole entity back
curl -X PATCH 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' --data @update.json

# 4. Verify what was stored
curl -s 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}' -H 'Authorization: <AUTH>'
```

Building the body by hand instead of piping? Copy the `campaign` object out of the `GET` response verbatim and edit the one value in it. Do not retype it from the fields you happen to remember.

**A nested array is replaced wholesale, not merged.** To add a keyword theme, send the existing themes *plus* the new one. To reword one headline, send the asset group with every other headline, description, image and signal unchanged. To add a city, send the existing `locations` plus the new entry.

Both worked updates below start from the same `campaign.json` the read in step 1 produced, and append to the array *that read returned* — the `+=` is the whole point. Building a fresh array with only the new entry deletes everything already there.

**Smart campaign — exclude a search term.** Traffic-quality tuning; this is the only way to set `excludedSearchTerms`.

```bash
jq '{ campaign: (.campaign | .smartCampaign.excludedSearchTerms += [
       { "freeFormKeywordTheme": "diy", "displayName": "diy" }
     ]) }' campaign.json > update.json
```

A Smart campaign's update is also hard-gated server-side: `smartCampaign.adGroups` (each with its `ads`), `smartCampaign.url`, `smartCampaign.languageCode` and `smartCampaign.businessName` must be present on **every** update — plus `smartCampaign.phone` when the campaign runs call ads. Omitting them fails with a 5xx and no actionable message rather than a validation error, so this is one place where a partial payload doesn't silently corrupt, it just breaks. Sending the whole entity satisfies it either way.

**PMAX Leads — add a search theme signal.** The follow-through for a `GOOGLE_ADS_SEARCH_THEMES` item in the [campaign success guide](manage-campaign-success-guide.md).

```bash
jq '{ campaign: (.campaign | .performanceMaxCampaign.assetGroups[0].assetGroupSignals.signals += [
       { "searchTheme": { "text": "emergency plumber near me" } }
     ]) }' campaign.json > update.json
```

The entire asset group rides along — every headline, description, image and existing signal — because `assetGroups` is replaced wholesale, not merged. `[0]` assumes a single asset group; with more than one, select the intended group by its `resourceName` instead of by index. `performanceMaxCampaign.excludedKeywords` takes the same `{ freeFormKeywordTheme, displayName }` shape as a Smart campaign's excluded search terms.

| What the user asks for | What the payload must still carry |
| --- | --- |
| Change the daily budget | `name`, `locations`, `adSchedule`, and the whole `smartCampaign` / `performanceMaxCampaign` block |
| Rename the campaign | `budget`, `locations`, `adSchedule`, and the whole campaign-type block |
| Add or remove one geo target | The complete new `locations` array — plus everything above |
| Edit one asset or keyword theme | The complete asset group / theme list — plus everything above |

Budget is in **micros** (`30000000` = $30.00/day). Over the account max → `CAMPAIGN_DAILY_BUDGET_TOO_HIGH` (check `GET /v1/campaign/daily-budget-boundaries`, returns min/max in micros).

**`id`, `accountId` and `campaignType` are required on every update** — they ride along automatically when you send the entity as read, but a hand-built body that omits one is rejected.

**`campaignType` never changes.** Send back exactly the value the read returned — `SMART`, `PERFORMANCE_MAX` or `PERFORMANCE_MAX_LEADS`. It is fixed at creation: a mismatched value is rejected, and there is no conversion between types — a campaign of a different type has to be created fresh. It also decides which block the payload carries (`smartCampaign` for `SMART`, `performanceMaxCampaign` for the two PMAX types); sending the block that doesn't match the type is the same mistake.

`id`, `status`, `resourceName`, `createdDate`, `updatedDate`, `actionDate` and `reportingKey` are read-only. Echo them back as read — they are ignored on write. Only if the API rejects one by name, drop that single named field and resend; never drop anything else to make a call pass. `status` in particular is not editable here: use Launch / Pause / Resume above.

## Delete & history

- **Delete (irreversible):** `DELETE /v1/campaigns/{id}` → `{}`. Confirm first; prefer Pause if the user only wants to stop spending.
- **Change log:** `GET /v1/campaigns/{id}/change-log` → `{ "entries": [ { "action": "CREATED|LAUNCHED|PAUSED|RESUMED|UPDATED|ENDED", "timestamp" } ] }` — use this to explain "why/when did my campaign change." (`GET /v1/campaigns/{id}/status-history` is a legacy equivalent.)

## Errors

| Code | Meaning / fix |
| --- | --- |
| `CAMPAIGN_NOT_FOUND` | Wrong or deleted id — re-list campaigns |
| `ACCOUNT_NOT_FOUND` | No Google Ads account — run the install-and-create-account recipe |
| `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` | 5 live already — pause one, then Launch/Resume |
| `CAMPAIGN_DAILY_BUDGET_TOO_HIGH` | Budget over account max — lower within daily-budget-boundaries |
| Fields vanished after an update (targeting, assets, name) | The `PATCH` body was partial — it replaced what it named and dropped the rest. Re-`GET`, rebuild the full entity, `PATCH` it back, and verify by reading again |
| 5xx with no actionable message on a `SMART` update | A field the Smart handler hard-requires was omitted — `smartCampaign.adGroups` / `url` / `languageCode` / `businessName` (and `phone` for call ads). Re-`GET` and resend the full entity |
| An update was rejected for a read-only field | Drop only the field the error names (`status`, `resourceName`, `createdDate`, `updatedDate`, `actionDate`, `reportingKey`) and resend the rest of the entity |
| `CUSTOM_CHARGES_SUBSCRIPTION_EXPIRED` / `…_AUTO_RENEWAL_OFF` | Renew / re-enable auto-renewal (Resume accepts `turnAutoRenewOn`) |

## References

- [Campaign Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/introduction)
- [Get Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/get-campaign) — read this before every update
- [Update Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/update-campaign)
