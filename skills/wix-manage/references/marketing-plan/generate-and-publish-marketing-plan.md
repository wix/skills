---
name: "Generate a Marketing Plan and Schedule Its Posts"
description: "End-to-end flow to generate an AI-powered social media marketing plan for a site and schedule its generated posts for publishing, using the Wix Marketing Plan API. Optionally configures marketing settings (goal, channels, tone, content pillars, frequency) first, generates the plan asynchronously, polls until it's ready, then schedules the DRAFT posts. Includes generating posts for additional activities. Use for 'generate a marketing plan', 'create a social media plan/calendar', or 'schedule my plan's posts' requests."
---
# RECIPE: Generate a Marketing Plan and Schedule Its Posts

This recipe generates a site's AI marketing plan — a schedule of marketing activities (social campaigns, blog posts, emails) from today through the end of next month — and schedules the social posts it generates. Generation is **asynchronous and non-deterministic**: you fire it, poll until it's ready, then act on the results.

Base URL for all endpoints: `https://www.wixapis.com/promote/marketing-plan-service/v1`.

**Prerequisites:**
- The site must be **published** — generation draws on the published site. This isn't validated at call time; an unpublished site yields a `FAILED` plan or an `ACTIVE` plan with no posts. Verify before generating.
- For posts to be **scheduled/published**, the target channels must be connected through the Publisher (see the [Publish or Schedule a Social Media Post](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/skills) recipe). Drafts for unconnected channels stay as drafts.

---

## STEP 1 (optional): Tailor the plan with marketing settings

Settings are optional — sensible defaults apply if unset. Configure them only to customize the output. Skip to STEP 2 to generate with defaults.

**API Endpoint:** `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-settings`

Both `marketingSettings` and `fieldMask` are **required**. `fieldMask` lists the paths to write, and **every path in `fieldMask` must be present** in `marketingSettings` (otherwise `FAILED_PRECONDITION`).

```json
{
  "marketingSettings": {
    "settings": {
      "marketingPlanGoal": { "goalKey": "BOOST_SALES" },
      "socialChannels": ["INSTAGRAM", "FACEBOOK", "TIKTOK"],
      "marketingTools": ["SOCIAL_MARKETING"],
      "pointOfView": "SECOND_PERSON",
      "frequency": { "interval": "WEEK", "count": 3 },
      "topics": { "included": ["handmade ceramics", "studio life"], "excluded": ["politics"] }
    }
  },
  "fieldMask": [
    "settings.marketingPlanGoal",
    "settings.socialChannels",
    "settings.marketingTools",
    "settings.pointOfView",
    "settings.frequency",
    "settings.topics"
  ]
}
```

Key fields:
- `marketingPlanGoal.goalKey`: `DRIVE_TRAFFIC`, `BRAND_AWARENESS`, `BOOST_SALES`, or `COLLECT_LEADS` (or use `customGoal` free text instead).
- `socialChannels`: `FACEBOOK`, `INSTAGRAM`, `LINKEDIN`, `PINTEREST`, `GBP`, `TIKTOK`, `TWITTER`. `TWITTER` (X) is being sunset — it's no longer functional after **July 31, 2026**, so don't include it in a plan whose posts would publish on or after that date.
- `marketingTools`: must include `SOCIAL_MARKETING` for social post drafts to be generated (also `BLOGS`, `EMAIL_MARKETING`).
- `pointOfView`: `FIRST_PERSON`, `SECOND_PERSON`, `THIRD_PERSON`.
- `frequency`: `{ interval: WEEK | MONTH | YEAR, count: 1–30 }`.
- `topics.included` / `topics.excluded`: content pillars to focus on or avoid.

To fetch the selectable values at runtime instead of hardcoding them, call `GET .../marketing-settings/plan-goal-options` and `GET .../marketing-settings/point-of-view-options`; `GET .../marketing-settings/defaults` returns the site's default goal, channels, and frequency.

**Note:** Settings shape the plan only at generation time. If a plan already exists, changing settings requires a regenerate (STEP 2) to take effect. If you changed `topics`, use `RegenerateMarketingPlanWithKeywordResearch` (`POST .../marketing-plan/regenerate-marketing-plan-with-keyword-research`) instead.

---

## STEP 2: Generate the plan

**API Endpoint:** `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan/generate-marketing-plan`

No body is required:

```json
{}
```

**Expected response** — generation runs in the background:

```json
{ "status": "GENERATING" }
```

If the site already has a plan and you want to refresh it, call `POST .../marketing-plan/regenerate-marketing-plan` instead (same response shape).

---

## STEP 3: Poll until the plan is ready

Poll this endpoint until `status` is `ACTIVE` (ready) or `FAILED`. Poll about every **5 seconds**, and stop after ~15 minutes as a safety timeout.

**API Endpoint:** `GET https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan?timeframe.startDate=2026-07-01T00:00:00.000Z&timeframe.endDate=2026-08-31T23:59:59.999Z`

`timeframe` is optional; omit it to return all activities from today onward.

**Expected response when ready:**

```json
{
  "status": "ACTIVE",
  "marketingActivities": [
    {
      "marketingActivityId": "b3f9d2e1-7a4c-4d68-9f02-1c5e8a6b4d30",
      "date": "2026-07-08T09:00:00.000Z",
      "title": "Summer collection launch",
      "description": "Announce the new handmade ceramic mugs summer collection with a 20% launch discount.",
      "items": [
        {
          "id": "834dc801-3e5c-416a-bd14-b130a95d100e",
          "channel": { "name": "INSTAGRAM", "accountId": "17841405822304914" },
          "type": "POST",
          "status": "DRAFT",
          "instagramPost": {
            "mediaWrapper": { "media": [ { "type": "IMAGE", "url": "https://static.wixstatic.com/media/....jpg" } ] },
            "caption": "Summer collection just dropped! Shop the look now. #summerstyle #newarrivals"
          }
        }
      ]
    }
  ]
}
```

`PlanStatus` values: `NEVER_CREATED`, `GENERATING` (keep polling), `ACTIVE` (ready), `INACTIVE` (deactivated after long inactivity — regenerate to reactivate), `FAILED` (retry with STEP 2).

Posts are generated automatically only for the **near-term** activities (how far ahead depends on the site's premium plan). Later activities have no `items` yet — see STEP 5 to generate them.

---

## STEP 4: Schedule the draft posts

Collect the `id` of every `item` whose `status` is `DRAFT`, from the activities you want to publish, then schedule them.

**API Endpoint:** `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan/schedule-drafts`

`draftIds` are item IDs; 1–20 per call:

```json
{ "draftIds": ["834dc801-3e5c-416a-bd14-b130a95d100e"] }
```

**Expected response:** the scheduled items (`status` now `SCHEDULED`):

```json
{ "items": [ { "id": "834dc801-3e5c-416a-bd14-b130a95d100e", "status": "SCHEDULED", "channel": { "name": "INSTAGRAM" } } ] }
```

Behavior:
- Only `DRAFT` items are scheduled; non-draft IDs are silently ignored.
- Only drafts for channels connected through the Publisher are scheduled; drafts for unconnected channels are silently skipped and stay drafts.
- Requires the site's plan to include the schedule-posts premium feature; otherwise the call returns `FAILED_PRECONDITION`.

The scheduled posts are managed by the Publisher and appear on the site's Social Media Marketing page.

---

## STEP 5 (optional): Generate posts for more activities

For activities that have no `items` yet, generate their posts, then schedule them.

1. **Generate** — `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan/generate-social-posts` (1–20 activity IDs; returns `{}` immediately, async):

   ```json
   { "marketingActivityIds": ["b3f9d2e1-7a4c-4d68-9f02-1c5e8a6b4d30"] }
   ```

2. **Poll** — `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-activity-posts` with the same activity IDs until posts appear:

   ```json
   { "marketingActivityIds": ["b3f9d2e1-7a4c-4d68-9f02-1c5e8a6b4d30"] }
   ```

   Response: `{ "marketingActivities": [ { "marketingActivityId": "...", "items": [ { "id": "...", "status": "DRAFT", ... } ] } ] }`.

3. **Schedule** — collect the new `DRAFT` item IDs and call `schedule-drafts` as in STEP 4.

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| Plan `status: FAILED`, or `ACTIVE` with no posts | Site not published, or `SOCIAL_MARKETING` not enabled in settings | Publish the site; ensure `settings.marketingTools` includes `SOCIAL_MARKETING`, then regenerate (STEP 2) |
| `FAILED_PRECONDITION` on Upsert Marketing Settings | A `fieldMask` path is missing from `marketingSettings` | Include every `fieldMask` path in the `marketingSettings` body |
| `FAILED_PRECONDITION` on Schedule Drafts | Plan lacks the schedule-posts premium feature | Advise upgrading the social media marketing plan |
| `FAILED_PRECONDITION` / `PLAN_ALREADY_GENERATING_ERROR` on Regenerate | A generation is already in progress | Wait for STEP 3 to reach `ACTIVE` or `FAILED` before regenerating |
| Drafts remain `DRAFT` after Schedule Drafts | Their channels aren't connected through the Publisher | Connect those channels (Publisher Accounts API), then reschedule |
| Polling never reaches `ACTIVE` | Generation stuck or very slow | Stop after ~15 minutes and retry generation |
| `GetSocialMarketingPlan` returns `INACTIVE` with no activities | Plan auto-deactivated after long inactivity | Call generate/regenerate (STEP 2) to reactivate |

## References

- [Marketing Plan API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/introduction)
- [Marketing Plan API sample flows](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/sample-flows)
- [Generate Marketing Plan](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/marketing-plan-v1/generate-marketing-plan)
- [Get Social Marketing Plan](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/marketing-plan-v1/get-social-marketing-plan)
- [Schedule Drafts](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/marketing-plan-v1/schedule-drafts)
- [Generate Social Posts](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/marketing-plan-v1/generate-social-posts)
- [Get Marketing Activity Posts](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/marketing-plan-v1/get-marketing-activity-posts)
- [Upsert Marketing Settings](https://dev.wix.com/docs/api-reference/business-management/marketing/marketing-plan/marketing-settings-v1/upsert-marketing-settings)
