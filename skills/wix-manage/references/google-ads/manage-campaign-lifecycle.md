---
name: "Manage Campaign Lifecycle"
description: "Manages the lifecycle of existing Google Ads campaigns on a Wix site: list and get campaigns, launch (first activation) vs resume (reactivate after a pause), pause a running campaign — optionally with a scheduled auto-resume date and a resume reminder — update a campaign's name/budget/targeting, change the daily budget, delete a campaign permanently, and read its status history and change log. Use when the user wants to 'pause my Google ad', 'resume my campaign', 'stop the campaign for now', 'change my daily budget', 'rename the campaign', 'delete this campaign', 'list my Google Ads campaigns', or 'why did my campaign status change'. Requires an existing Google Ads account and campaign. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Manage Campaign Lifecycle

Operate on campaigns that already exist: list/get them, launch, pause, resume, update settings and budget, delete, and inspect history. To *create* a campaign, use [Create a Smart Campaign](create-smart-campaign.md) or [Create a Performance Max Campaign](create-performance-max-campaign.md).

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`.

> **Launch and Resume start real spend; Delete is irreversible.** Confirm with the user before launching, resuming, or deleting. Pausing/updating budget is reversible but still changes a live campaign — say what you're changing.

**Launch vs Resume — the key distinction:**
- **Launch** activates a campaign for the **first time** (from `DRAFT`/`PAUSED`-as-created to `LIVE`).
- **Resume** reactivates a campaign that was live and then explicitly **paused**.

Both move it to `LIVE` and both count against the **5-live-campaigns-per-site** limit.

---

## Find campaigns

**List all campaigns** for the site:

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/campaigns' -H 'Authorization: <AUTH>'
```

```json
{ "campaigns": [
  { "id": "c9d8e7f6-a5b4-3210-fedc-ba9876543210", "campaignType": "SMART", "status": "LIVE", "name": "Spring Bakery Promotion", "budget": { "amountMicros": "15000000" } },
  { "id": "d1e2f3a4-b5c6-7890-abcd-ef1234567891", "campaignType": "PERFORMANCE_MAX", "status": "PAUSED", "name": "Summer Sale PMAX", "budget": { "amountMicros": "30000000" } }
] }
```

**Get one campaign** by id (its `status` and `budget` are synced live from Google on each read): `GET /v1/campaigns/{campaignId}`.

**Campaign statuses** (`status` is read-only and can change without your action — e.g. policy or billing): `DRAFT`, `LIVE`, `PAUSED`, `LEARNING` (PMAX Leads, ~28 days post-launch), `IN_REVIEW` (payment setup finalizing), `DISAPPROVED` (policy), `NOT_SERVING` (budget), `ENDED`, `ERROR`.

---

## Launch a campaign (first activation)

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/launch' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'
```

Returns the campaign with `status: "LIVE"`.

## Pause a running campaign

Stops ad delivery immediately; all settings and data are preserved. Optional fields let you schedule the comeback:

- `scheduledResumeDate` (ISO 8601) — the campaign auto-resumes at this time (fires a `CampaignAutoResumed` event). Pass `null` to cancel an existing scheduled resume.
- `resumeReminderDate` — sends a dashboard reminder to resume.
- `turnAutoRenewOff` — also disables subscription auto-renewal.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/pause' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "scheduledResumeDate": "2024-04-15T08:00:00.000Z" }'
```

Returns the campaign with `status: "PAUSED"`. To pause with no auto-resume, send `{}`.

## Resume a paused campaign

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/resume' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'
```

Pass `{ "turnAutoRenewOn": true }` to re-enable subscription auto-renewal at the same time. Returns the campaign `LIVE`. Fails with `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` if 5 are already live — pause another first.

---

## Update a campaign

`UpdateCampaign` is a **partial update** — send only the fields you're changing (plus the required `id` and `accountId`). Only those fields are pushed to Google Ads.

```bash
curl -X PATCH 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaign": {
      "id": "c9d8e7f6-a5b4-3210-fedc-ba9876543210",
      "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Summer Bakery Promotion",
      "budget": { "amountMicros": "20000000" }
    }
  }'
```

Budget is in micros (`20000000` = $20.00/day). Over the account max → `CAMPAIGN_DAILY_BUDGET_TOO_HIGH`; check `GET /v1/campaign/daily-budget-boundaries` (returns `minimumDailyBudget`/`maximumDailyBudget` in micros).

**Just changing the daily budget?** A `UpdateCampaign` with only `id`, `accountId`, and `budget.amountMicros` is the standard way for a single campaign.

---

## Delete a campaign (irreversible)

Permanently deletes the campaign — it cannot be recovered. **Confirm with the user**, and if they only want to stop spending, pause instead.

```bash
curl -X DELETE 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}' -H 'Authorization: <AUTH>'
```

Returns `{}`.

---

## Inspect history

**Change log** — full event history (`CREATED`, `CREATED_AS_LIVE`, `LAUNCHED`, `PAUSED`, `RESUMED`, `UPDATED`, `ENDED`) in chronological order. Use this to explain "why/when did my campaign change":

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/change-log' -H 'Authorization: <AUTH>'
```

```json
{ "entries": [
  { "action": "CREATED",  "timestamp": "2024-03-15T10:30:00.000Z" },
  { "action": "LAUNCHED", "timestamp": "2024-03-20T08:00:00.000Z" },
  { "action": "PAUSED",   "timestamp": "2024-03-25T12:00:00.000Z" }
] }
```

`GET /v1/campaigns/{campaignId}/status-history` is a legacy equivalent (returns `{status, updatedDate}` rows) — prefer the change log.

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `NOT_FOUND` / `CAMPAIGN_NOT_FOUND` | Wrong id, or the campaign was deleted | Re-list campaigns and use a current id |
| `NOT_FOUND` / `ACCOUNT_NOT_FOUND` on List/Get | No Google Ads account | Run [install-and-create-account](install-and-create-account.md) |
| `FAILED_PRECONDITION` / `ACCOUNT_CANCELED` on List | Account was canceled | Campaigns can't be listed; surface to the user |
| `FAILED_PRECONDITION` / `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` on Launch/Resume | 5 live campaigns already | Pause one, then retry |
| `INVALID_ARGUMENT` / `CAMPAIGN_DAILY_BUDGET_TOO_HIGH` on Update | Budget over the account max | Lower it within `daily-budget-boundaries` |
| `FAILED_PRECONDITION` / `CUSTOM_CHARGES_SUBSCRIPTION_EXPIRED` or `…_AUTO_RENEWAL_OFF` on Launch/Resume | Pay-as-you-go subscription expired or auto-renew off | Renew / re-enable auto-renewal, then retry (Resume accepts `turnAutoRenewOn`) |

## References

- [Campaign Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/introduction)
- [Launch Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/launch-campaign)
- [Pause Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/pause-campaign)
- [Resume Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/resume-campaign)
- [Update Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/update-campaign)
- [Delete Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/delete-campaign)
- [Get Campaign Change Log](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/get-campaign-change-log)
