---
name: "Marketing Recipes"
description: "Social and email marketing — generate, publish and schedule social posts to connected channels, build an AI marketing plan with its content calendar, and link to the marketing dashboard pages. Use for anything users call social media, posts, campaigns, marketing, promotion, Instagram, Facebook, LinkedIn, or email marketing."
---

# Marketing Recipes

Publishing needs a channel the site owner has already connected, so establish that before composing anything. Use **Create and Publish a Social Media Post** for a single post — generated with AI or supplied by the user, published now or scheduled. Use **Generate a Marketing Plan and Schedule Its Posts** when the user wants an ongoing plan rather than one post; configure the marketing settings (goal, tone, cadence, content pillars) first, since they shape everything the plan generates.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Create and Publish a Social Media Post (with AI generation)](https://dev.wix.com/docs/api-reference/business-management/marketing/skills/create-and-publish-a-social-media-post-with-ai-generation)
**Technical:** End-to-end flow to create a social media post, optionally generating it
with AI, and publish or schedule it to a site's connected channel (Instagram, Facebook,
LinkedIn, X/Twitter, TikTok, Pinterest, YouTube, Google Business Profile) using the Wix
Publisher API. Can generate a full per-channel post from a free-text idea or from the
site's own assets (products, blog posts, events, bookings, coupons, categories),
generate caption/title suggestions, and edit an existing image with AI. Settles the post
content with you first, then confirms the channel is connected, checks premium quota,
creates a draft, and publishes now or schedules it. Use for 'create a post', 'generate a
post from my product/idea', 'write a caption', 'caption ideas/suggestions', 'edit a post
image with AI', 'post to Instagram/Facebook/TikTok', 'connect my
Instagram/Pinterest/LinkedIn', or 'schedule a post'.

### [Generate a Marketing Plan and Schedule Its Posts](https://dev.wix.com/docs/api-reference/business-management/marketing/skills/generate-a-marketing-plan-and-schedule-its-posts)
**Technical:** End-to-end flow to generate an AI-powered social media marketing plan for
a site and schedule its generated posts for publishing, using the Wix Marketing Plan
API. Recommends configuring marketing settings (goal, tone, cadence, content pillars)
before the first generation, generates the plan asynchronously, polls until it's ready,
then schedules the DRAFT posts. Includes generating posts for additional activities. Use
for 'generate a marketing plan', 'create a social media plan/calendar', or 'schedule my
plan's posts' requests.

### [Marketing Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/marketing/skills/marketing-dashboard-navigation)
**Technical:** Builds direct links to Wix marketing dashboard pages on manage.wix.com —
the social posts hub (drafts, scheduled and published posts across connected channels),
post design templates, saved designs, and the email marketing pages (campaigns list,
campaign templates, campaign analytics). Pairs each main marketing entity (social post
item, connected social account, marketing-plan post, email campaign) with its read API
so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when
the user asks where something is in the Wix dashboard, wants a direct link to a
dashboard page, or you need a dashboard URL to include with the result of an API
operation.
