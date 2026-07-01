---
name: "Create and Publish a Social Media Post (with AI generation)"
description: "End-to-end flow to create a social media post — optionally generating it with AI — and publish or schedule it to a site's connected channel (Instagram, Facebook, LinkedIn, TikTok, Pinterest, YouTube, Google Business Profile) using the Wix Publisher API. Can generate a full per-channel post from a free-text idea or from the site's own assets (products, blog posts, events, bookings, coupons, categories), generate caption/title suggestions, and edit an existing image with AI. Then confirms the channel is connected, checks premium quota, creates a draft, and publishes now or schedules it. Use for 'create a post', 'generate a post from my product/idea', 'write a caption', 'edit a post image with AI', 'post to Instagram/Facebook/TikTok', or 'schedule a post'."
---
# RECIPE: Create and Publish a Social Media Post (with AI generation)

This recipe creates a post — called an **item** — and publishes it to one of a site's connected social channels, or schedules it for a future date. You can generate the post content with AI (STEP 3) or bring your own. Each item targets a single channel, and its `type` and content must match a combination the channel supports.

Base URL for all endpoints: `https://www.wixapis.com/social-publisher/v1`.

**Prerequisites:**
- The target channel must be connected by the site owner (verified in STEP 1; connect it in STEP 1.5 if not).
- Media must be a publicly accessible URL. Images edited in STEP 3c already are.
- AI generation (STEP 3) is optional. Skip it if the user supplies their own caption and media.

**Flow:** STEP 1 confirm the channel is connected (connect if needed) → STEP 2 check premium features → STEP 3 generate content (optional) → STEP 4 pick channel/type → STEP 5 create the draft → STEP 6 publish or schedule. Checking connection and premium first avoids generating content for a channel that can't receive it or an action the plan doesn't allow.

---

## STEP 1: Confirm the channel is connected

Determine the target channel from the request (`INSTAGRAM`, `FACEBOOK`, `YOUTUBE`, `LINKEDIN`, `PINTEREST`, `GBP`, `TIKTOK`), then get the account to publish to and confirm the channel is connected. Do this first — you can't publish to an unconnected channel, and connecting is an interactive step best surfaced up front.

**API Endpoint:** `GET https://www.wixapis.com/social-publisher/v1/accounts?channelName=INSTAGRAM`

**Expected response:**

```json
{
  "accounts": [
    { "channelName": "INSTAGRAM", "instagram": { "id": "17841405822304914", "username": "janes.pottery", "settings": { "default": true } } }
  ]
}
```

**Decision point:**
- **Accounts returned** → use the account object's `id` as `channel.accountId` in STEP 5. If several are returned, pick `settings.default: true` or ask the user.
- **`accounts` is empty** → the channel isn't connected. Offer to connect it (STEP 1.5) instead of just stopping.

Note the extra IDs some channels need in STEP 5: Facebook `facebook.page.id`, Pinterest `pinterest.board.id`, Google Business Profile `gbp.location.id`.

### STEP 1.5: Connect the channel (only if not connected)

Ask the user if they'd like to connect the channel now. If yes, run the OAuth connect flow — the site owner must authorize in their browser; it can't be completed server-side alone.

1. **Get the authorization URL** — `GET https://www.wixapis.com/social-publisher/v1/INSTAGRAM/connect-url` (path segment is the channel name):

   ```json
   { "connectUrl": "https://www.instagram.com/oauth/authorize?client_id=...&redirect_uri=...&state=..." }
   ```

2. **Surface `connectUrl` to the user** and ask them to open it and authorize the channel. The channel's OAuth redirect completes the connection server-side.

3. **Poll the connection status** — `GET https://www.wixapis.com/social-publisher/v1/INSTAGRAM/long-lived-token-status` every few seconds until `status` is `VALID`:

   ```json
   { "status": "VALID" }
   ```

   `status` values: `NEVER_CREATED` (not connected yet — keep waiting for the user to authorize), `VALID` (connected — proceed), `INVALID` (connection expired — reconnect with the same flow), `DISCONNECTED` (was disconnected — reconnect).

4. **Re-run STEP 1** (`List Accounts`) to get the now-connected account's `id` for `channel.accountId`.

If the user declines to connect, stop: the post can't be published to an unconnected channel.

---

## STEP 2: Check premium features

One call tells you what the site's plan allows — whether you can generate with AI and whether you can publish or schedule — so you fail fast before generating or creating anything.

**API Endpoint:** `GET https://www.wixapis.com/social-publisher/v1/features?featureTypes=AI_TOOLS&featureTypes=PUBLISH_POST&featureTypes=SCHEDULE_POST`

**Expected response:**

```json
{
  "features": [
    { "type": "AI_TOOLS", "enabled": true },
    { "type": "PUBLISH_POST", "enabled": true, "quotaInfo": { "limit": 30, "currentUsage": 4, "remainingUsage": 26, "period": "MONTH" } },
    { "type": "SCHEDULE_POST", "enabled": true, "quotaInfo": { "limit": 30, "currentUsage": 4, "remainingUsage": 26, "period": "MONTH" } }
  ],
  "monetizationEnabled": true
}
```

(To check a single feature instead, `GET /social-publisher/v1/features/{featureType}` returns `{ "featureData": {...}, "monetizationEnabled": ... }`.)

`quotaInfo` is present only when the feature is metered — when quotas don't apply, `monetizationEnabled` is `false` and each entry carries just `type` and `enabled`. `period` is one of `NO_PERIOD`, `MILLISECOND`, `SECOND`, `MINUTE`, `HOUR`, `DAY`, `WEEK`, `MONTH`, `YEAR` (`NO_PERIOD` means the quota doesn't reset).

**Decision point:**
- `AI_TOOLS` `enabled: false` → skip AI generation in STEP 3; have the user provide the caption and media themselves.
- The action you'll use — `PUBLISH_POST` (publish now) or `SCHEDULE_POST` (schedule) — `enabled: false` → the plan doesn't include it; advise upgrading the social media marketing plan.
- `monetizationEnabled: true` and that action's `quotaInfo.remainingUsage` is `0` → quota exhausted; tell the user when it resets (`period`, unless `NO_PERIOD`) or to upgrade.
- Otherwise → proceed. When `monetizationEnabled` is `false`, quotas aren't enforced; rely on `enabled`.

---

## STEP 3: Generate the post content with AI (optional)

Pick the approach that fits the request. Only generate if STEP 2 showed `AI_TOOLS` `enabled: true`; otherwise skip this step and have the user provide the content.

### 3a. Generate a full post — from an idea and/or the site's own assets

Produces ready-to-use, per-channel payloads that drop straight into STEP 5. This is the best default for "create a post about …".

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/generate-post-data`

- `userInput` — free-text idea to base the post on.
- `siteAssets` — the site's own content to ground the post in, as `{ "id": "<asset-guid>", "type": "<asset-type>" }`. **Exactly one asset per call** (multiple assets aren't supported yet). Supported `type` values: `STORES_PRODUCT`, `STORES_CATEGORY`, `STORES_COUPON`, `BLOG_POST`, `EVENT`, `BOOKINGS_SERVICE`. Get the asset's `id` from that app's own API (for example, query Wix Stores products to get a `STORES_PRODUCT` id).
- `media` — candidate images to include, as `{ "type": "IMAGE", "url": "<public-url>" }` (images only).
- `channels` — which channels to generate for. Omit to get one result for each of `INSTAGRAM`, `FACEBOOK`, `LINKEDIN`, `PINTEREST`, `GBP`, and `TIKTOK`.

Provide `userInput`, `siteAssets`, or both.

**Scope:** this method produces standard image-**post** payloads for the six channels above only. It does **not** generate YouTube content or story/reel/video formats — for those, use 3b (caption) and 3c (image edit) and assemble the content object yourself in STEP 5.

**Example — from an idea + an image, for Instagram and Facebook:**

```json
{
  "userInput": "Announce our new summer collection of handmade ceramic mugs with a 20% discount this week",
  "media": [{ "type": "IMAGE", "url": "https://static.wixstatic.com/media/cf2434_4b3a2d8eb7f54bc89c0d4524430a2af3~mv2.jpg" }],
  "channels": ["INSTAGRAM", "FACEBOOK"]
}
```

**Example — from a site asset (a Stores product):**

```json
{
  "siteAssets": [{ "id": "f1e4c0a2-9b87-4d31-a6e5-2c8b7f0d1a93", "type": "STORES_PRODUCT" }],
  "channels": ["INSTAGRAM"]
}
```

**Expected response** — one entry per channel, each holding a channel-specific payload (`instagramPost`, `facebookPost`, …) shaped exactly like the content in STEP 5:

```json
{
  "results": [
    {
      "channelName": "INSTAGRAM",
      "instagramPost": {
        "mediaWrapper": { "media": [{ "type": "IMAGE", "url": "https://static.wixstatic.com/media/cf2434_...~mv2.jpg" }] },
        "caption": "New summer collection: handmade ceramic mugs ☀️🍶 20% off this week! #HandmadeMugs #CeramicLove"
      }
    }
  ]
}
```

Use the payload for your chosen channel as the content object in STEP 5. Review it with the user before publishing.

### 3b. Generate only a caption or title

Use when the user just wants caption suggestions to place into a post.

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/generate-text`

`userInput` is required. Options: `channelName`, `tone` (e.g. `professional`, `playful`), `languageCode` (ISO 639-1, e.g. `en`), and `additionalContent` (`url`, `withHashtags`, `addLinkInBio`).

```json
{
  "userInput": "A summer sale on handmade ceramic mugs, 20% off this week",
  "channelName": "INSTAGRAM",
  "tone": "playful",
  "languageCode": "en",
  "additionalContent": { "withHashtags": true }
}
```

**Expected response:** `{ "results": [ { "caption": "…", "title": "…" } ] }`. Put the chosen `caption` (and `title` where the channel uses one) into the content object in STEP 5.

### 3c. Edit an image with AI

Transforms an existing **source image** according to a text prompt (e.g. add a sale banner to a product photo, restyle a background). This is AI image-to-image editing — it requires a source image and does **not** generate an image from a prompt alone. Runs asynchronously.

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/generate-image`

Both `userInput` (prompt) and `imageUrl` (the source image to edit) are required:

```json
{
  "userInput": "Add a bright summer-sale banner to the product photo",
  "imageUrl": "https://static.wixstatic.com/media/cf2434_source-product-photo.jpg"
}
```

**Response:** `{ "status": "OK", "executionId": "b7c2f0a1-4e6d-4a8b-9c3f-2d5e1a7b0c94" }`.

**Poll** for the result: `GET https://www.wixapis.com/social-publisher/v1/generated-image/{executionId}` about every few seconds until `status` is `READY` or `FAILED`:

```json
{ "status": "READY", "imageUrl": "https://static.wixstatic.com/media/cf2434_generated-image.jpg", "fileId": "cf2434_abc123def456~mv2.jpg" }
```

`status` values: `IN_PROGRESS` (keep polling), `READY` (use `imageUrl` — and `fileId` — as the post media), `FAILED`. A `404 GENERATED_IMAGE_NOT_FOUND` means the `executionId` is invalid or expired. The generated image is also saved to the site's "Social Marketing AI Media" Media Manager folder.

---

## STEP 4: Choose the channel and type

For the connected channel from STEP 1, pick the item `type` and the matching content object (from STEP 3's output or the user's own content).

| Channel (`channel.name`) | `type` | Content object | Main content fields |
| --- | --- | --- | --- |
| `INSTAGRAM` | `POST` | `instagramPost` | `caption`, `imageUrl`/`videoUrl` or `mediaWrapper` (media **required**) |
| `INSTAGRAM` | `STORY` | `instagramStory` | `mediaWrapper` (media required) |
| `FACEBOOK` | `POST` | `facebookPost` | `caption`, `pageId`, `imageUrl`/`videoUrl`/`link` or `mediaWrapper` |
| `FACEBOOK` | `REEL` | `facebookReel` | `description`, `pageId`, `videoUrl` or `mediaWrapper` |
| `FACEBOOK` | `STORY` | `facebookStory` | `pageId`, `mediaWrapper` |
| `YOUTUBE` | `VIDEO` | `youtubeVideo` | `title`, `description`, `videoUrl`, `channelId` |
| `YOUTUBE` | `SHORT` | `youtubeShort` | `title`, `description`, `videoUrl`, `channelId` |
| `LINKEDIN` | `POST` | `linkedinPost` | `caption`, `authorId`, `mediaWrapper` or `linkMetadata` |
| `PINTEREST` | `POST` | `pinterestPost` | `title`, `description`, `boardId`, `link`, `mediaWrapper` |
| `GBP` | `POST` | `gbpPost` | `locationId`, `description` and/or `mediaWrapper`, optional `callToAction` |
| `TIKTOK` | `POST` | `tiktokPhoto` | `title`, `description`, `privacyLevel`, `mediaWrapper` |
| `TIKTOK` | `VIDEO` | `tiktokVideo` | `description`, `privacyLevel`, `mediaWrapper` |

Notes:
- Media items in `mediaWrapper.media[]` are `{ "type": "IMAGE" | "VIDEO", "url": "<public-url>" }`.
- Instagram and story types **require** media.
- `caption` is the text field for Instagram, Facebook, LinkedIn; `description` for YouTube, Pinterest, Google Business Profile, TikTok.
- `pageId` (Facebook), `boardId` (Pinterest), `locationId` (Google Business Profile) come from the account object in STEP 1.
- TikTok `privacyLevel` must be one of the account's `privacyLevelOptions` from STEP 1 (e.g. `PUBLIC_TO_EVERYONE`).
- `TWITTER` is no longer functional as of July 31, 2026 — don't publish to it.

---

## STEP 5: Create the draft item

Create the post as a draft. The response returns the draft's `id`, which STEP 6 publishes.

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/items`

Build the request from `item.channel` (`name` + the `accountId` from STEP 1), `item.type` (from the STEP 4 table), and exactly one channel-specific content object.

**Assembling the content object:**
- If you generated with **STEP 3a** (`generate-post-data`), the returned per-channel object (e.g. `instagramPost`) **is** the content object — pass it through as-is.
- Otherwise, build it from the STEP 4 table row for your channel + `type`: the text field (`caption` for Instagram/Facebook/LinkedIn, `description` for YouTube/Pinterest/GBP/TikTok), the media (`mediaWrapper`, or `imageUrl`/`videoUrl` for a single item), and any channel-specific fields — the ID from the STEP 1 account object (`pageId` for Facebook, `boardId` for Pinterest, `locationId` for GBP), plus `authorId` (LinkedIn), `privacyLevel` (TikTok, one of the account's `privacyLevelOptions`), and `title` where the channel uses one.
- Instagram and story types require media.

**Example — Instagram image post:**

```json
{
  "item": {
    "channel": { "name": "INSTAGRAM", "accountId": "17841405822304914" },
    "type": "POST",
    "instagramPost": {
      "imageUrl": "https://static.wixstatic.com/media/cf2434_4b3a2d8eb7f54bc89c0d4524430a2af3~mv2.jpg",
      "caption": "Summer collection just dropped! Shop the look now. #summerstyle #newarrivals"
    }
  }
}
```

For multiple media, use `mediaWrapper` instead of `imageUrl`/`videoUrl`:

```json
"instagramPost": { "mediaWrapper": { "media": [{ "type": "IMAGE", "url": "https://static.wixstatic.com/media/....jpg" }] }, "caption": "..." }
```

**Example — Facebook image post** (needs `pageId` from the STEP 1 account):

```json
{
  "item": {
    "channel": { "name": "FACEBOOK", "accountId": "1022334455667788" },
    "type": "POST",
    "facebookPost": {
      "pageId": "102938475610293",
      "imageUrl": "https://static.wixstatic.com/media/cf2434_4b3a2d8eb7f54bc89c0d4524430a2af3~mv2.jpg",
      "caption": "Summer sale is on — 20% off all handmade ceramic mugs this week!"
    }
  }
}
```

**Example — TikTok photo post** (needs `privacyLevel`; `description` is the text field):

```json
{
  "item": {
    "channel": { "name": "TIKTOK", "accountId": "7c9f0a12-4e6d-4a8b-9c3f-2d5e1a7b0c94" },
    "type": "POST",
    "tiktokPhoto": {
      "title": "Summer sale",
      "description": "20% off handmade ceramic mugs this week ☀️ #ceramics #handmade",
      "privacyLevel": "PUBLIC_TO_EVERYONE",
      "mediaWrapper": { "media": [{ "type": "IMAGE", "url": "https://static.wixstatic.com/media/cf2434_4b3a2d8eb7f54bc89c0d4524430a2af3~mv2.jpg" }] }
    }
  }
}
```

**Expected response** (abridged) — save `id`:

```json
{ "item": { "id": "ac01c174-5244-49df-8085-84d87cd0345a", "status": "DRAFT", "channel": { "name": "INSTAGRAM", "accountId": "17841405822304914" }, "type": "POST" } }
```

---

## STEP 6: Publish now or schedule

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/publish-by-id`

**Publish immediately** — omit `scheduledDate`:

```json
{ "id": "ac01c174-5244-49df-8085-84d87cd0345a" }
```

**Schedule for a future date** — include `scheduledDate` (ISO 8601, in the future; confirm `SCHEDULE_POST` in STEP 2):

```json
{ "id": "ac01c174-5244-49df-8085-84d87cd0345a", "scheduledDate": "2026-08-08T09:00:00.000Z" }
```

**Expected response:** the item with an updated `status`:
- `PUBLISHED` — live on the channel; `externalItemUrl` links to the post.
- `SCHEDULED` — will publish automatically at `scheduledDate`.
- `PROCESSING` — publishing in progress; final status follows asynchronously.
- `FAILED` — publishing failed; surface the error.

(The full `status` set is `DRAFT`, `SCHEDULED`, `PROCESSING`, `IN_QUEUE`, `PUBLISHED`, `CANCELED`, `FAILED`, `DELETED`.)

The post appears on the site's Social Media Marketing page in the dashboard. To reschedule a `SCHEDULED` item, call `POST https://www.wixapis.com/social-publisher/v1/items/{id}/reschedule` with body `{ "scheduledDate": "<new-date>" }` (the item moves to `SCHEDULED` at the new date). To cancel it, call `PATCH https://www.wixapis.com/social-publisher/v1/items/{id}/cancel` with an empty body `{}` (the item moves to `CANCELED`).

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| STEP 1 returns empty `accounts` | Channel not connected | Run STEP 1.5 to connect the channel, or ask the owner to connect it in the dashboard, then retry |
| `428 FAILED_PRECONDITION` / `NO_PAGES_FOR_USER` on List Accounts | Connected Facebook user has no pages | Ask the owner to connect a Facebook page |
| STEP 2 shows `AI_TOOLS` `enabled: false` (or an AI call is rejected) | Plan doesn't include AI tools | Skip AI generation; have the user provide content |
| Generate Image poll returns `404 GENERATED_IMAGE_NOT_FOUND` | `executionId` invalid or expired | Re-run Generate Image and poll the new `executionId` |
| STEP 2 shows the publish/schedule feature `enabled: false` or `remainingUsage: 0` | Plan doesn't allow the action, or quota used up | Advise upgrading, or wait for quota reset |
| `412 FAILED_PRECONDITION` / `INELIGIBLE_FOR_FEATURE` on publish or schedule | Site's plan doesn't cover publishing/scheduling this post | Check STEP 2 first; advise upgrading the plan |
| `429 RESOURCE_EXHAUSTED` / `PUBLISH_LIMIT_EXCEEDED` | Publishing rate limit hit | Back off and retry later |
| `UNSUPPORTED_CHANNEL` | Targeting a sunset channel (e.g. `TWITTER`, non-functional as of July 31, 2026) | Use a supported channel |
| Create item rejected for missing media | Instagram and story types require media (GBP needs `description` and/or media) | Provide a public image/video URL (or edit one from a source image in STEP 3c) |
| Reschedule/cancel returns `ITEM_NOT_EXISTS`, `ITEM_IS_PUBLISHED`, or `ITEM_IS_DELETED` | The item can't be rescheduled/canceled in its current state | Only reschedule/cancel items still in `SCHEDULED` status |
| Publish returns `status: FAILED` | Content/type mismatch or channel rejected the post | Verify the `type` + content object match the channel's supported combination and that media URLs are public |

## References

- [Publisher API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/introduction)
- [List Accounts](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/list-accounts)
- [Get Connect Url](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/get-connect-url)
- [Get Long Lived Token Status](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/get-long-lived-token-status)
- [Get Feature Data](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/premium-feature-v1/get-feature-data)
- [Generate Post Data](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/generate-post-data)
- [Generate Text](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/generate-text)
- [Generate Image](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/generate-image)
- [Get Generated Image](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/get-generated-image)
- [Create Draft Item](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/item-v1/create-draft-item)
- [Publish Item By ID](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/item-v1/publish-item-by-id)
- [Publisher API sample flows](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/sample-flows)
