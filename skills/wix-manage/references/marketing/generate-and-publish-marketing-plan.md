---
name: "Generate a Marketing Plan and Schedule Its Posts"
description: "End-to-end flow to generate an AI-powered social media marketing plan for a site and schedule its generated posts for publishing, using the Wix Marketing Plan API. Recommends configuring marketing settings (goal, tone, cadence, content pillars) before the first generation, generates the plan asynchronously, polls until it's ready, then schedules the DRAFT posts. Includes generating posts for additional activities. Use for 'generate a marketing plan', 'create a social media plan/calendar', or 'schedule my plan's posts' requests."
---
# RECIPE: Generate a Marketing Plan and Schedule Its Posts

This recipe generates a site's AI marketing plan — a schedule of marketing activities (social campaigns, blog posts, emails) from today through the end of next month — and schedules the social posts it generates. Generation is **asynchronous and non-deterministic**: you fire it, poll until it's ready, then act on the results.

Base URL for all endpoints: `https://www.wixapis.com/promote/marketing-plan-service/v1`.

**Prerequisites:**
- The site must be **published** — generation draws on the published site. This isn't validated at call time; an unpublished site yields a `FAILED` plan or an `ACTIVE` plan with no posts. Verify before generating.
- For posts to be **scheduled/published**, the target channels must be connected through the Publisher (see the [Create and Publish a Social Media Post](https://dev.wix.com/docs/api-reference/business-management/marketing/skills) recipe for the connect flow). Drafts for unconnected channels silently stay as drafts (STEP 4).

---

## STEP 1 (recommended before your first plan): Tailor the plan with marketing settings

For a first-time plan, configure marketing settings **before** generating (STEP 2), so the first plan reflects the brand's goal, voice, and cadence. Settings are optional — the service applies per-site defaults if you skip this — but they're read **only at generation time**, so a plan generated with defaults won't change until you regenerate. After a plan exists, changing settings requires a regenerate (STEP 2) to take effect.

**API Endpoint:** `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-settings`

Both `marketingSettings` and `fieldMask` are **required**. `fieldMask` lists the paths to write, and **every path in `fieldMask` must be present** in `marketingSettings` (otherwise the call fails with `INVALID_FIELD_MASK_ERROR`).

**Language and location cannot be set here.** If the request targets a language or a place ("posts in Spanish", "customers near Berlin"), those are site-derived, read-only fields on marketing settings — never put `language`, `targetLocations`, or `businessLocation` in the request, and never tell the user this call changed them. Set the fields that do belong here (goal, tone, audience description), and direct the user to the site-level settings for the rest — see **What you can't set here** below.

```json
{
  "marketingSettings": {
    "settings": {
      "marketingPlanGoal": { "goalKey": "BOOST_SALES" },
      "marketingTools": ["SOCIAL_MARKETING"],
      "topics": { "included": ["handmade ceramics", "studio life"], "excluded": ["politics"] },
      "toneOfVoice": "warm and playful",
      "pointOfView": "SECOND_PERSON",
      "businessProfile": { "valueProposition": "hand-thrown stoneware for everyday rituals", "targetAudience": "design-conscious home cooks" }
    },
    "overrides": {
      "socialMarketing": { "frequency": { "interval": "WEEK", "count": 3 } }
    }
  },
  "fieldMask": [
    "settings.marketingPlanGoal",
    "settings.marketingTools",
    "settings.topics",
    "settings.toneOfVoice",
    "settings.pointOfView",
    "settings.businessProfile",
    "overrides.socialMarketing.frequency"
  ]
}
```

**What each field shapes.** Generation has two stages, and fields feed different stages:
- **The activities** (what to post about, and when): `marketingPlanGoal` (`goalKey` ∈ `DRIVE_TRAFFIC`, `BRAND_AWARENESS`, `BOOST_SALES`, `COLLECT_LEADS`, or `customGoal` free text), `topics.included`/`topics.excluded` (content pillars), `businessProfile` (`valueProposition`, `targetAudience`, `businessGoal`), `calendar.ids` (which calendars feed the plan), and per-tool cadence `overrides.<socialMarketing|emailMarketing|blogs>.frequency` (`{ interval: WEEK | MONTH | YEAR, count: 1–30 }`).
- **The post drafts** (captions and images): `toneOfVoice` (free text), `pointOfView` (`FIRST_PERSON`/`SECOND_PERSON`/`THIRD_PERSON`), `customContentGuidelines` (free text), `imageGuidelines` (free text), and `businessProfile.targetAudience`.
- `marketingTools` must include `SOCIAL_MARKETING` for social post drafts to be generated (also `BLOGS`, `EMAIL_MARKETING`).

**`socialChannels` does not limit channels.** The plan generates post drafts for **all** supported channels; `settings.socialChannels` is only a hint to the caption generator, not a filter. To avoid publishing to a channel, simply don't schedule (or connect) it in STEP 4 — don't rely on `socialChannels` to exclude it. Supported channels: `FACEBOOK`, `INSTAGRAM`, `LINKEDIN`, `PINTEREST`, `GBP`, `TIKTOK`, `TWITTER` (X, sunset — no longer functional after **July 31, 2026**).

**What you can't set here (site-derived, read-only).** Several inputs that shape the plan are **not** part of marketing settings and can't be changed through this endpoint — they come from the site, and setting them via Upsert Marketing Settings has no effect:
- **Language / region** — from the site's Language & Region settings (`settings.language` is read-only here). The plan's activities and captions are generated in the site language, so "write my posts in French" means changing the site language, not marketing settings.
- **Business / target locations** — from the site's SEO business-location settings (`settings.businessLocation` / `settings.targetLocations` are read-only here).
- **Industry, SEO summary, and published site content** (products, blog posts, events) — from the published site itself.

To change any of these, edit them at the site level (or tell the user where: Language & Region for language, SEO business-location settings for locations), then (re)generate the plan (STEP 2) so it picks them up.

To fetch selectable values at runtime, call `GET .../marketing-settings/plan-goal-options` (goals) and `GET .../marketing-settings/defaults` (the site's default goal, channels, and frequency); point-of-view values are the fixed enum above. (Two fields are accepted but currently ignored by generation: `settings.imageGenerationSettings` and `topics.coreTopic`.)

**Note — settings only take effect on (re)generation.** Editing settings never changes an existing plan on its own. To apply changes to an existing plan, regenerate it (STEP 2, `regenerate-marketing-plan`). **If you changed `topics`, use `RegenerateMarketingPlanWithKeywordResearch` instead** (`POST .../marketing-plan/regenerate-marketing-plan-with-keyword-research`) so keyword research reruns for the new content pillars.

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

**API Endpoint:** `GET https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan?timeframe.startDate=2026-07-01T00:00:00.000Z&timeframe.endDate=2026-08-31T23:59:59.999Z` (example dates — compute the timeframe from today's date through the end of next month)

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

`PlanStatus` values: `NEVER_CREATED`, `GENERATING` (keep polling), `ACTIVE` (ready), `INACTIVE` (auto-deactivated after ~6 weeks idle — and calling this endpoint on a stale plan can itself trigger the transition; regenerate to reactivate), `FAILED` (retry with STEP 2).

Posts are generated automatically only for the **near-term** activities (how far ahead depends on the site's premium plan). Later activities have no `items` yet — see STEP 5 to generate them.

---

## STEP 4: Schedule the draft posts

Collect the `id` of every `item` whose `status` is `DRAFT` from the activities you want to publish. **Before scheduling, show the user what will be published** — each draft's caption and media (render the image inline if the surface supports it, otherwise post its URL as a clickable link) — and get their approval. The drafts are AI-generated and scheduling publishes them, so never schedule content the user hasn't reviewed. Skip `TWITTER` drafts whose activity date falls after **July 31, 2026** — X is sunset then, and a post scheduled past the cutoff will never publish.

**API Endpoint:** `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan/schedule-drafts`

`draftIds` are item IDs; 1–20 per call:

```json
{ "draftIds": ["834dc801-3e5c-416a-bd14-b130a95d100e"] }
```

**Expected response:** the scheduled items (`status` now `SCHEDULED`):

```json
{ "items": [ { "id": "834dc801-3e5c-416a-bd14-b130a95d100e", "status": "SCHEDULED", "channel": { "name": "INSTAGRAM" } } ] }
```

**Check the response — scheduling can partially and silently succeed:**
- Only `DRAFT` items are scheduled; non-draft IDs are silently ignored.
- **Only drafts for Publisher-connected channels are scheduled; drafts for unconnected channels are silently skipped and stay `DRAFT` — with no error.** A `200` does not mean everything was scheduled. **Diff the returned `items` against the `draftIds` you sent:** any id not returned as `SCHEDULED` is still a draft. Tell the user which channels those drafts belong to and that the channel needs connecting — connect it via the [Create and Publish a Social Media Post](https://dev.wix.com/docs/api-reference/business-management/marketing/skills) recipe's connect flow, then reschedule those ids.
- Requires the site's plan to include the schedule-posts premium feature; otherwise the call returns `FAILED_PRECONDITION` (advise upgrading the social media marketing plan).

The scheduled posts are managed by the Publisher and appear on the site's Social Media Marketing page.

---

## STEP 5 (optional): Generate posts for more activities

For activities that have no `items` yet, generate their posts, then schedule them.

1. **Generate** — `POST https://www.wixapis.com/promote/marketing-plan-service/v1/marketing-plan/generate-social-posts` (1–20 activity IDs; returns `{}` immediately, async):

   ```json
   { "marketingActivityIds": ["b3f9d2e1-7a4c-4d68-9f02-1c5e8a6b4d30"] }
   ```

   Note: this generates drafts for **all** supported channels (it ignores `socialChannels`) and doesn't re-check `SOCIAL_MARKETING` in `marketingTools`.

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
| `INVALID_FIELD_MASK_ERROR` on Upsert Marketing Settings | A `fieldMask` path is missing from `marketingSettings` | Include every `fieldMask` path in the `marketingSettings` body |
| Language, region, or location "won't change" via Upsert Marketing Settings | Those fields are read-only here (site-derived) | Change them in the site's Language & Region / SEO business-location settings, then regenerate |
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
