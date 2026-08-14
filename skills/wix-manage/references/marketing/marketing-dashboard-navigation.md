---
name: "Marketing Dashboard Navigation"
description: "Builds direct links to Wix marketing dashboard pages on manage.wix.com — the social posts hub (drafts, scheduled and published posts across connected channels), post design templates, saved designs, and the email marketing pages (campaigns list, campaign templates, campaign analytics). Pairs each main marketing entity (social post item, connected social account, marketing-plan post, email campaign) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Marketing Dashboard Navigation

Build direct links into the marketing pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

Marketing pages are split across **two apps** with two URL namespaces:

- **Social Media Marketing** (`f27ff649-0249-4a0c-9438-841cbbfd2514`) — social posts, design templates. Routes under `social-marketing-web/`.
- **Email Marketing** (`135c3d92-0fea-1f9d-2ba5-2a1dfb04297e`) — email campaigns. Routes under `email-marketing/`.

Older links (`social-marketing`, `social-marketing/my-posts`, `shoutout`) redirect to the current routes.

## Social Posts Pages (Social Media Marketing)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Social posts hub | `social-marketing-web` | Draft, scheduled, and published social posts across connected channels; create a new post |
| Design templates | `social-marketing-web/design-templates` | Post design template gallery |
| My designs | `social-marketing-web/my-designs` | Saved post designs |

Posts created or scheduled via the Publisher API (see [Create and Publish a Social Media Post](./create-and-publish-social-post.md)) and posts generated from an AI marketing plan (see [Generate a Marketing Plan](./generate-and-publish-marketing-plan.md)) all appear on the social posts hub.

## Email Marketing Pages (Email Marketing)

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Email marketing home | `email-marketing` | Email marketing hub |
| My campaigns | `email-marketing/my-campaigns` | All email campaigns (sent, scheduled, drafts) |
| Campaign templates | `email-marketing/template-list` | Start a campaign from a template |
| Campaign analytics | `email-marketing/analytics` | Campaign statistics |

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Social post (item) | Publisher API Item — created via `POST /social-publisher/v1/items`, published/scheduled via `POST /social-publisher/v1/publish-by-id` | `social-marketing-web` |
| Connected social account | `GET /social-publisher/v1/accounts?channelName={CHANNEL}` | `social-marketing-web` |
| Marketing-plan post | `GET /promote/marketing-plan-service/v1/marketing-plan?timeframe.startDate=...&timeframe.endDate=...` · `POST /promote/marketing-plan-service/v1/marketing-activity-posts` | `social-marketing-web` (scheduled posts land on the hub) |
| Email campaign | `GET /email-marketing/v1/campaigns` · `GET /email-marketing/v1/campaigns/{campaignId}` | `email-marketing/my-campaigns` |

Example — after scheduling a social post, hand back the hub link:

```
Scheduled your Instagram post for tomorrow 9:00.
See it here: https://manage.wix.com/dashboard/{metaSiteId}/social-marketing-web
```
