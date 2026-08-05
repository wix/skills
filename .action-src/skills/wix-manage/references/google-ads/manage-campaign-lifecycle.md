---
name: "Manage Campaign Lifecycle"
description: "Manages existing Google Ads campaigns on a Wix site: list/get, launch (first activation) vs resume (reactivate after a pause), pause a running campaign — optionally with a scheduled auto-resume date — update name/budget/targeting, change the daily budget, delete permanently, and read status history / change log. Use when the user wants to 'pause my Google ad', 'resume my campaign', 'stop the campaign', 'change my daily budget', 'rename the campaign', 'delete this campaign', 'list my Google Ads campaigns', or 'why did my campaign status change'. Requires an existing Google Ads account and campaign. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Manage Campaign Lifecycle

Operate on campaigns that already exist. Base URL: `https://www.wixapis.com/google-ads/v1`; `<AUTH>` = `Authorization` header, and body calls also need `Content-Type: application/json`.

**Answer directly.** When the user asks *how* to do something, give the endpoint, an example request, and the key behavior right away — use `{campaignId}` as a placeholder rather than asking which campaign. Only pause to confirm when you are about to **execute** a launch, resume, or delete on the user's behalf (those spend money or are irreversible); explaining how never requires confirmation.

> **Launch vs Resume — the key distinction.** **Launch** activates a campaign for the *first time* (`POST /v1/campaigns/{campaignId}/launch`). **Resume** reactivates one that was live and then *paused* (`POST /v1/campaigns/{campaignId}/resume`). Both move it to `LIVE` and both count against the **5-live-campaigns-per-site** cap.

## Read

- **List:** `GET /v1/campaigns` → `{ "campaigns": [ { "id", "campaignType", "status", "name", "budget": { "amountMicros" } } ] }`
- **Get one:** `GET /v1/campaigns/{campaignId}` — `status` and `budget` are synced live from Google on each read.

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

## Update (partial) & change budget

`PATCH /v1/campaigns/{id}` — send only the fields you're changing, plus the required `id` and `accountId`. Budget is in **micros** (`20000000` = $20.00/day).

```bash
curl -X PATCH 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}' -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "campaign": { "id": "...", "accountId": "...", "name": "New name", "budget": { "amountMicros": "20000000" } } }'
```

Changing only the daily budget = the same call with just `id`, `accountId`, and `budget.amountMicros`. Over the account max → `CAMPAIGN_DAILY_BUDGET_TOO_HIGH` (check `GET /v1/campaign/daily-budget-boundaries`, returns min/max in micros).

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
| `CUSTOM_CHARGES_SUBSCRIPTION_EXPIRED` / `…_AUTO_RENEWAL_OFF` | Renew / re-enable auto-renewal (Resume accepts `turnAutoRenewOn`) |

[Campaign Service docs](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/introduction)
