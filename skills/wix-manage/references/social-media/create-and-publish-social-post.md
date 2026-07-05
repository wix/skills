---
name: "Create and Publish a Social Media Post (with AI generation)"
description: "End-to-end flow to create a social media post — optionally generating it with AI — and publish or schedule it to a site's connected channel (Instagram, Facebook, LinkedIn, X/Twitter, TikTok, Pinterest, YouTube, Google Business Profile) using the Wix Publisher API. Can generate a full per-channel post from a free-text idea or from the site's own assets (products, blog posts, events, bookings, coupons, categories), generate caption/title suggestions, and edit an existing image with AI. Then confirms the channel is connected, checks premium quota, creates a draft, and publishes now or schedules it. Use for 'create a post', 'generate a post from my product/idea', 'write a caption', 'edit a post image with AI', 'post to Instagram/Facebook/TikTok', or 'schedule a post'."
---
# RECIPE: Create and Publish a Social Media Post (with AI generation)

This recipe creates a post — called an **item** — and publishes it to one of a site's connected social channels, or schedules it for a future date. You can generate the post content with AI (STEP 3) or bring your own. Each item targets a single channel, and its `type` and content must match a combination the channel supports.

Base URL for all endpoints: `https://www.wixapis.com/social-publisher/v1`.

**Prerequisites:**
- The target channel must be connected by the site owner (verified in STEP 1; connect it in STEP 1.5 if not).
- Post media must be a **Wix Media Manager URL** (`static.wixstatic.com`); see **Media handling** in STEP 4. Images edited in STEP 3c are already hosted there.
- AI generation (STEP 3) is available on every site — it is **not** plan-gated. Offer it by default; skip it only if the user brings their own caption and media.

**Flow:** STEP 1 confirm the channel is connected (connect if needed) → STEP 2 check premium features → STEP 3 generate content (offer this proactively) → STEP 4 pick channel/type → STEP 5 create the draft → STEP 6 publish or schedule. Checking connection and premium first avoids generating content for a channel that can't receive it or an action the plan doesn't allow.

**Not covered here:** editing or analyzing already-published posts, post analytics/insights, or connecting a channel as a standalone goal (connection is handled here only as a precondition for publishing).

---

## STEP 1: Confirm the channel is connected

Determine the target channel from the request (`INSTAGRAM`, `FACEBOOK`, `YOUTUBE`, `LINKEDIN`, `PINTEREST`, `GBP`, `TIKTOK`, `TWITTER`), then get the account to publish to and confirm the channel is connected. `TWITTER` (X) is available only through **July 31, 2026** — see the cutoff rule in STEP 4 and STEP 6. Do this first — you can't publish to an unconnected channel, and connecting is an interactive step best surfaced up front.

**API Endpoint:** `GET https://www.wixapis.com/social-publisher/v1/accounts?channelName=INSTAGRAM`

(Channel-name placement differs by endpoint: `accounts` and `features` take it as a **query** param; `connect-url` and `long-lived-token-status` take it as a **path** segment.)

**Expected response:**

```json
{
  "accounts": [
    { "channelName": "INSTAGRAM", "instagram": { "id": "17841405822304914", "username": "janes.pottery", "settings": { "default": true } } }
  ]
}
```

**Decision point:**
- **One account returned** → use its `id` as `channel.accountId` in STEP 5.
- **Several accounts returned** (one per connected page/account) → pick the one with `settings.default: true`, or ask the user which page/account to post to, and use that `id` as `channel.accountId`. To **change the default** (what the dashboard's page picker does), call **Update Account Settings**: `PATCH https://www.wixapis.com/social-publisher/v1/{channelName}/settings` with the channel-specific default field:
  - Instagram → `{ "instagram": { "defaultAccountId": "<id>" } }`
  - Facebook → `{ "facebook": { "defaultPageId": "<id>" } }`
  - Pinterest → `{ "pinterest": { "defaultBoardId": "<id>" } }`
  - Google Business Profile → `{ "gbp": { "defaultLocationId": "<id>" } }`
  - TikTok → `{ "tiktok": { "defaultAccountId": "<id>" } }`
  - LinkedIn → `{ "linkedin": { "defaultChannelId": "<id>" } }`
- **`accounts` is empty** → the channel isn't connected — offer to connect it (STEP 1.5). If `long-lived-token-status` is already `VALID` but this still returns empty (or `NO_PAGES_FOR_USER`), the token was created but no Facebook Page with a linked Instagram **Business/Creator** account was granted during authorization — treat it as "not connected" and re-run STEP 1.5, telling the user to grant the Page.
- **A `400 USER_NOT_EXIST_FOR_CHANNEL` error** (instead of an empty list) → same meaning: **this channel** has no connected user. Treat it exactly like "not connected" and offer STEP 1.5.

**This call is per-channel — never generalize from it to the whole site.** `accounts?channelName=X` (empty *or* a `USER_NOT_EXIST_FOR_CHANNEL` error) tells you only about channel **X**. It says nothing about any other channel. Do **not** tell the user "you have no social accounts connected on this site" from a single-channel check — you have no basis for that. Scope every statement to the channel you actually queried (e.g. "Pinterest isn't connected yet"). If you genuinely need to know what else is connected, query the other channels.

Note the extra IDs some channels need in STEP 5: Facebook `facebook.page.id`, Pinterest `pinterest.board.id`, Google Business Profile `gbp.location.id`.

### STEP 1.5: Connect the channel (only if not connected)

Ask the user if they'd like to connect the channel now. If yes, run the OAuth connect flow — the site owner must authorize in their browser; it can't be completed server-side alone.

1. **Get the authorization URL** — `GET https://www.wixapis.com/social-publisher/v1/INSTAGRAM/connect-url` (path segment is the channel name):

   ```json
   { "connectUrl": "https://www.instagram.com/oauth/authorize?client_id=...&redirect_uri=...&state=..." }
   ```

   If this returns a `428 INELIGIBLE_FOR_FEATURE` ("metasite is ineligible for feature"), the site has **reached the number of channels its plan allows it to connect** — connecting *this* channel isn't blocked specifically; the plan caps *how many* channels can be connected, and that cap is used up (e.g. free plans allow only one connected channel, so a site that already has one connected can't add another). Reconnecting an already-connected channel is always free; only adding a *new* one counts against the cap. Stop the connect flow and explain this plainly: to connect another channel they can **upgrade the social media marketing plan** — otherwise they can post to the channel they **already have connected**.

**Do not suggest connecting a *different* new channel** (e.g. "connect Instagram or Facebook instead") — the cap applies to *any* new channel equally, so that hits the same 428. The cap being full means at least one channel is already connected; find out which by calling `List Accounts` for the other channels (or just ask the user), and offer to post to **that** channel. Also don't suggest disconnecting or switching the existing channel to free a slot. So the only real options are: upgrade, or use the channel that's already connected.

2. **Surface `connectUrl` to the user** and ask them to open it and authorize the channel. The channel's OAuth redirect completes the connection server-side.

3. **Poll the connection status** — `GET https://www.wixapis.com/social-publisher/v1/INSTAGRAM/long-lived-token-status` every few seconds, for up to ~2 minutes, until `status` is `VALID`:

   ```json
   { "status": "VALID" }
   ```

   `status` values: `NEVER_CREATED` (not connected yet — keep polling until the timeout), `VALID` (connected — proceed), `INVALID` (connection expired — reconnect with the same flow), `DISCONNECTED` (was disconnected — reconnect). If it's still not `VALID` after ~2 minutes, stop and tell the user the connection wasn't completed and they can retry.

4. **Re-run STEP 1** (`List Accounts`) to get the now-connected account's `id` for `channel.accountId`.

If the user declines to connect, stop: the post can't be published to an unconnected channel.

---

## STEP 2: Check premium features

One call tells you what the site's plan allows — whether you can publish or schedule — so you fail fast before creating anything. (AI generation is **not** gated by this call — see STEP 3 — so there's no need to check for it here.)

**API Endpoint:** `GET https://www.wixapis.com/social-publisher/v1/features?featureTypes=PUBLISH_POST&featureTypes=SCHEDULE_POST`

**Expected response:**

```json
{
  "features": [
    { "type": "PUBLISH_POST", "enabled": true, "quotaInfo": { "limit": 30, "currentUsage": 4, "remainingUsage": 26, "period": "MONTH" } },
    { "type": "SCHEDULE_POST", "enabled": true, "quotaInfo": { "limit": 30, "currentUsage": 4, "remainingUsage": 26, "period": "MONTH" } }
  ],
  "monetizationEnabled": true
}
```

`quotaInfo` is present only when the feature is metered — when quotas don't apply, `monetizationEnabled` is `false` and each entry carries just `type` and `enabled`. `period` is one of `NO_PERIOD`, `MILLISECOND`, `SECOND`, `MINUTE`, `HOUR`, `DAY`, `WEEK`, `MONTH`, `YEAR` (`NO_PERIOD` means the quota doesn't reset).

**Decision point:**
- The action you'll use — `PUBLISH_POST` (publish now) or `SCHEDULE_POST` (schedule) — `enabled: false` → the plan doesn't include it; advise upgrading the social media marketing plan.
- `monetizationEnabled: true` and that action's `quotaInfo.remainingUsage` is `0` → quota exhausted; tell the user when it resets (`period`, unless `NO_PERIOD`) or to upgrade.
- Otherwise → proceed. When `monetizationEnabled` is `false`, quotas aren't enforced; rely on `enabled`.

---

## STEP 3: Generate the post content with AI

AI generation works on **every** site — it isn't gated by the plan (no premium check applies), so offer it by default. Don't assume the user wants generation, and don't assume they'll write it themselves — **ask which**, and if generating, ask what to base it on. Lead with this branching question before doing anything else in this step:

1. **Do they already have the content, or want it generated?** e.g. "Do you already have the post text (paste it), or should I generate it for you?"
2. **If generating — from a free-text idea, or from one of the site's own assets?** e.g. "Should I write it from a one-line idea you give me, or build it around one of your products, blog posts, events, bookings, or coupons?"

Then follow the branch:
- **User has their own content** → skip generation; use their text as the content object in STEP 5 (still surface any media per STEP 6).
- **Generate from an idea** → 3a (or 3b for caption/title only) with their idea as `userInput`.
- **Generate from an asset** → 3a with the chosen asset as `siteAssets`.

Fall back to 3b/3c only when 3a doesn't fit (e.g. YouTube or a story/reel/video format).

**Get the subject from the user before generating — do not invent it.** Whichever generate branch they pick, the one thing you always need first is *what the post is about* — a one-line idea, or which specific asset. Wait for their answer, then pass it as `userInput` (their idea) and/or `siteAssets` (the asset they picked). Never fabricate a topic or generate a generic post about the business off your own assumption — a draft the user never described their intent for is the failure this step must avoid.

The subject is a **hard gate**: do not call `generate-post-data` / `generate-text` until the user has told you, in their own words, what the post is about. Watch for this trap — if you asked for the account *and* the topic in one message and the user replies with just the account (e.g. "1" or "personal"), they have **not** given you a topic. Treat the topic as still missing: ask for it again and stop; do not proceed to generate. A short reply that answers only one of your questions is not permission to invent the rest. (Resolving *which* specific asset still comes from the site's query API per 3a, but *that they want an asset-based post, and which one* comes from the user.)

**Always produce the content by calling these endpoints — never write the caption or title yourself.** Once you have the subject, you **must call** `generate-post-data` (3a) or `generate-text` (3b) and present *its* output. Do not compose captions from your own language model and skip the API — the endpoints produce on-brand, per-channel, asset-grounded content that hand-written text can't match, and skipping them is a common failure of this recipe. The only time you don't call them is when the user pastes their own finished text.

### 3a. Generate a full post — from an idea and/or the site's own assets

Produces ready-to-use, per-channel payloads that drop straight into STEP 5. **This is the default** — lead with it for any "create a post" request, offering both the idea-based and asset-based paths.

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/generate-post-data`

- `userInput` — free-text idea to base the post on.
- `siteAssets` — the site's own content to ground the post in, as `{ "id": "<asset-guid>", "type": "<asset-type>" }`. **Exactly one asset per call** (multiple assets aren't supported yet). This recipe doesn't look assets up for you — resolve the `id` from the owning app's query API first, then pick the asset the user meant. The linked method docs are authoritative: read them for the exact request/response, or if an inline call stops working.

  | `type` | Owning app | Endpoint | Docs |
  | --- | --- | --- | --- |
  | `STORES_PRODUCT` | Wix Stores | `POST https://www.wixapis.com/stores/v3/products/query` (body `{ "query": {} }`) | [Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products) |
  | `STORES_CATEGORY` | Wix Stores | `POST https://www.wixapis.com/categories/v1/categories/query` — **requires** `treeReference`, e.g. `{ "treeReference": { "appNamespace": "@wix/stores" } }` | [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/query-categories) |
  | `STORES_COUPON` | Wix Stores | `POST https://www.wixapis.com/stores/v2/coupons/query` (body `{ "query": {} }`) | [Query Coupons](https://dev.wix.com/docs/api-reference/business-solutions/coupons/coupons/query-coupons) |
  | `BLOG_POST` | Wix Blog | `POST https://www.wixapis.com/blog/v3/posts/query` (body `{ "paging": { "limit": 10 } }`) | [Query Posts](https://dev.wix.com/docs/api-reference/business-solutions/blog/posts-stats/query-posts) |
  | `EVENT` | Wix Events | `POST https://www.wixapis.com/events/v3/events/query` (body `{ "query": { "paging": { "limit": 10 } } }` — `paging.limit` must be > 0) | [Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events) |
  | `BOOKINGS_SERVICE` | Wix Bookings | `POST https://www.wixapis.com/bookings/v2/services/query` (body `{ "query": {} }`) | [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services) |

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

**Expected response** — one entry per **requested** channel, each holding a channel-specific payload (`instagramPost`, `facebookPost`, …) shaped exactly like the content in STEP 5 (Instagram shown below; the two-channel request above also returns a `facebookPost` entry):

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

Use the payload for your chosen channel as the content object in STEP 5. Review it with the user before publishing — and review the **whole** payload, not just the caption. If the response includes an image or video in `mediaWrapper.media[]` (`generate-post-data` returns an AI-generated image when you pass no `media` of your own), you **must** surface that media to the user: display/render the image inline in the chat if the surface supports it, otherwise post the media URL as a clickable link. Either way the user must be able to see the media. A user should never be asked to approve a post whose image they haven't seen.

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

**Poll** for the result: `GET https://www.wixapis.com/social-publisher/v1/generated-image/{executionId}` about every few seconds, for up to ~2 minutes, until `status` is `READY` or `FAILED`:

```json
{ "status": "READY", "imageUrl": "https://static.wixstatic.com/media/cf2434_generated-image.jpg", "fileId": "cf2434_abc123def456~mv2.jpg" }
```

`status` values: `IN_PROGRESS` (keep polling; if still `IN_PROGRESS` after ~2 minutes, stop and report), `READY` (use `imageUrl` — and `fileId` — as the post media), `FAILED`. A `404 GENERATED_IMAGE_NOT_FOUND` means the `executionId` is invalid or expired. The generated image is also saved to the site's "Social Marketing AI Media" Media Manager folder.

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
| `TWITTER` (X) | `POST` | `twitterPost` | `caption`, `imageUrl`/`videoUrl`/`link` or `mediaWrapper` — **available only until July 31, 2026** (see STEP 6) |
| `PINTEREST` | `POST` | `pinterestPost` | `title`, `description`, `boardId`, `link`, `mediaWrapper` |
| `GBP` | `POST` | `gbpPost` | `locationId`, `description` and/or `mediaWrapper`, optional `callToAction` |
| `TIKTOK` | `POST` | `tiktokPhoto` | `title`, `description`, `privacyLevel`, `mediaWrapper` |
| `TIKTOK` | `VIDEO` | `tiktokVideo` | `description`, `privacyLevel`, `mediaWrapper` |

Notes:
- Media items in `mediaWrapper.media[]` are `{ "type": "IMAGE" | "VIDEO", "url": "<public-url>" }`.
- Instagram and story types **require** media (GBP needs `description` and/or media). No endpoint creates an image from text alone (STEP 3c only edits an existing image), so if the user has none, source one — see **Media handling** below.
- `caption` is the text field for Instagram, Facebook, LinkedIn, and X/Twitter; `description` for YouTube, Pinterest, Google Business Profile, and TikTok.
- `pageId` (Facebook), `boardId` (Pinterest), `locationId` (Google Business Profile) come from the account object in STEP 1.
- TikTok `privacyLevel` must be one of the account's `privacyLevelOptions` from STEP 1 — one of `PUBLIC_TO_EVERYONE`, `FOLLOWER_OF_CREATOR`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY`.
- Text length limits: Instagram `caption` ≤ 2200 (about 30 hashtags / 20 mentions); Pinterest `title` ≤ 100, `description` ≤ 800, `link` ≤ 2048; Google Business Profile `description` ≤ 1500; TikTok photo `title` ≤ 90 and `description` ≤ 4000, TikTok video `description` ≤ 2200. AI-generated captions/titles (STEP 3b) are ≤ 1000.
- GBP `callToAction` (optional) is one of `BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP`.
- `TWITTER` (X) works like any other channel **only through July 31, 2026**; after that it's no longer functional (see STEP 6). Treat an `UNSUPPORTED_CHANNEL` error as authoritative.

**Media handling.** Post media **must be a Wix Media Manager URL** — `static.wixstatic.com` for images, `video.wixstatic.com` for videos. Always use one, even for media that came from elsewhere. (The API only validates a generic URL and won't reject a non-Wix link, but don't rely on that: an external URL has to stay reachable when the post publishes — a real risk for scheduled posts — and skips the Media Manager processing channels expect. Treat a Wix URL as required.) In the content object, `url` is that Wix URL; `fileId` is derived from it.

Getting media into the Media Manager:
- **Already there** (a site asset's image, a STEP 3c generated image, or a previously uploaded file) → use its `static.wixstatic.com` `url` directly.
- **A public external URL** → import it; Wix fetches it server-side, no local download: `POST https://www.wixapis.com/site-media/v1/files/import` with `{ "url": "<external-url>", "mimeType": "image/jpeg", "displayName": "post.jpg" }`.
- **A local file (no public URL)** → `POST https://www.wixapis.com/site-media/v1/files/generate-upload-url`, then **`PUT` the raw file bytes to the returned `uploadUrl`** (set `Content-Type` to the file's MIME type); the response returns the file descriptor. See the Media Manager Upload API.

After import/upload the file returns `operationStatus: PENDING` — poll `GET https://www.wixapis.com/site-media/v1/files/{id}` until `operationStatus` is `READY`, then use its `static.wixstatic.com` `url` in the post.

---

## STEP 5: Create the draft item

Create the post as a draft. The response returns the draft's `id`, which STEP 6 publishes.

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/items`

Build the request from `item.channel` (`name` + the `accountId` from STEP 1), `item.type` (from the STEP 4 table), and exactly one channel-specific content object.

**Assembling the content object:**
- If you generated with **STEP 3a** (`generate-post-data`), the returned per-channel object (e.g. `instagramPost`) **is** the content object — pass it through as-is.
- Otherwise, build it from the STEP 4 table row for your channel + `type`: the text field (`caption` for Instagram/Facebook/LinkedIn, `description` for YouTube/Pinterest/GBP/TikTok), the media (`mediaWrapper`, or `imageUrl`/`videoUrl` for a single item), and any channel-specific fields — the ID from the STEP 1 account object (`pageId` for Facebook, `boardId` for Pinterest, `locationId` for GBP), plus `authorId` (LinkedIn), `privacyLevel` (TikTok, one of the account's `privacyLevelOptions`), and `title` where the channel uses one.
- Instagram and story types require media.

**Idempotency (retry safety).** To make create/publish safe to retry, set a stable, caller-defined `item.referenceId`. Publishing a second item with the same `referenceId` fails with `REFERENCE_ID_ALREADY_EXIST` instead of posting a duplicate — so if a call times out, retry with the **same** `referenceId` rather than risk double-posting.

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

**Confirm before publishing.** Publishing immediately is public and can't be undone (you can only delete the post afterward). Show the user the final content — **the caption *and* the media** — and the target channel, then get explicit confirmation before this call. If the post has an image or video, **display/render it inline in the chat** if the surface supports images, otherwise **post the media URL as a clickable link** — don't just describe it or show the caption alone. Either way the user must be able to see the actual image they're about to publish. Scheduling is reversible (reschedule/cancel), so a lighter confirmation is fine there, but still surface the media.

**API Endpoint:** `POST https://www.wixapis.com/social-publisher/v1/publish-by-id`

**Publish immediately** — omit `scheduledDate`:

```json
{ "id": "ac01c174-5244-49df-8085-84d87cd0345a" }
```

**Schedule for a future date** — include `scheduledDate` (ISO 8601, must be in the future; confirm `SCHEDULE_POST` in STEP 2). Compute it from the current date/time, resolving the user's relative wording ("next Monday 9am") in the site's timezone if known, otherwise UTC, and confirm the resolved date with the user:

```json
{ "id": "ac01c174-5244-49df-8085-84d87cd0345a", "scheduledDate": "<future-ISO-8601-datetime>" }
```

**X (Twitter) cutoff.** X is no longer functional after **July 31, 2026**. Don't publish to X once that date has passed, and don't schedule an X post with a `scheduledDate` after it — a post scheduled to fire past the cutoff won't be published.

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
| `400 USER_NOT_EXIST_FOR_CHANNEL` on List Accounts | The **queried channel** has no connected user (same as "not connected") | Treat as not-connected for that channel only; offer STEP 1.5. Don't conclude the whole site has no connected accounts — the check is per-channel |
| `428 INELIGIBLE_FOR_FEATURE` on Get Connect Url | Site has hit its plan's cap on **number of connected channels** (e.g. free = 1), not a channel-specific block | Explain the channel-count limit; offer to upgrade, or find the already-connected channel (List Accounts / ask) and offer to post there. Don't suggest connecting a *different* new channel (same cap), don't suggest disconnecting/switching, don't retry the connect flow |
| `FAILED_PRECONDITION` / `NO_PAGES_FOR_USER` on List Accounts | Connected Facebook/Instagram user has no page with a linked postable account | Ask the owner to grant a Facebook page (with a linked Instagram Business/Creator account) during authorization, then retry |
| Generate Image poll returns `404 GENERATED_IMAGE_NOT_FOUND` | `executionId` invalid or expired | Re-run Generate Image and poll the new `executionId` |
| STEP 2 shows the publish/schedule feature `enabled: false` or `remainingUsage: 0` | Plan doesn't allow the action, or quota used up | Advise upgrading, or wait for quota reset |
| `FAILED_PRECONDITION` / `INELIGIBLE_FOR_FEATURE` on publish or schedule | Site's plan doesn't cover publishing/scheduling this post | Check STEP 2 first; advise upgrading the plan |
| `429 RESOURCE_EXHAUSTED` / `PUBLISH_LIMIT_EXCEEDED` | Publishing rate limit hit | Back off and retry later |
| `ALREADY_EXISTS` / `REFERENCE_ID_ALREADY_EXIST` on publish | An item with the same `referenceId` already exists | Expected when safely retrying a publish that already succeeded — don't re-publish with a new `referenceId` |
| `FAILED_PRECONDITION` / `UNSUPPORTED_CHANNEL` | Targeting an unsupported channel, or X/Twitter after its July 31, 2026 cutoff | Use a supported channel; target X only before the cutoff |
| Create item rejected for missing media | Instagram and story types require media (GBP needs `description` and/or media) | Provide a public image/video URL (or edit one from a source image in STEP 3c) |
| Reschedule/cancel returns `ITEM_NOT_EXISTS`, `ITEM_IS_PUBLISHED`, or `ITEM_IS_DELETED` | The item can't be rescheduled/canceled in its current state | Only reschedule/cancel items still in `SCHEDULED` status |
| Publish returns `status: FAILED` | Content/type mismatch or channel rejected the post | Verify the `type` + content object match the channel's supported combination and that media URLs are public |

## References

- [Publisher API introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/introduction)
- [List Accounts](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/list-accounts)
- [Get Connect Url](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/get-connect-url)
- [Get Long Lived Token Status](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/get-long-lived-token-status)
- [Update Account Settings](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/account-v1/update-account-settings)
- [Get Feature Data](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/premium-feature-v1/get-feature-data)
- [Generate Post Data](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/generate-post-data)
- [Generate Text](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/generate-text)
- [Generate Image](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/generate-image)
- [Get Generated Image](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/generated-content-v1/get-generated-image)
- [Create Draft Item](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/item-v1/create-draft-item)
- [Publish Item By ID](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/item-v1/publish-item-by-id)
- [Reschedule Item](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/item-v1/reschedule-item)
- [Cancel Scheduled Item](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/item-v1/cancel-scheduled-item)
- [Media Manager: Import File](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file)
- [Media Manager: Generate File Upload URL](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/generate-file-upload-url)
- [Publisher API sample flows](https://dev.wix.com/docs/api-reference/business-management/marketing/social-media/sample-flows)
