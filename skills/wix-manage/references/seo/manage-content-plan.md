---
name: "Generate and Read a Wix Site's Content Plan"
description: Trigger an AI-generated SEO content plan for a Wix site, poll the generation to completion, read and optionally edit the keyword research, then read the blog post briefs it produced. The flow is asynchronous and parks mid-way until explicitly released.
---

# Generate and Read a Wix Site's Content Plan

Use the public **SEO Content Plan APIs** to ask Wix's AI to generate an SEO
content plan for the authenticated site, then read and optionally edit the
keyword research and blog post briefs it produces. The API selects the site
from the caller's authorization context; never ask for or send a site ID.

Writing keyword research requires the **Manage SEO Settings** permission.
Reading flows and candidates requires the same permission.

## The one rule that must never be skipped

**The flow parks at `KEYWORD_RESEARCH` and never finishes on its own.** After
triggering generation and polling until `KEYWORD_RESEARCH`, you must call
**Create Content Plan** to advance it to `CONTENT_PLAN` and then `SUCCESS`.
An agent that only polls will wait forever.

## The loop: trigger, poll, release, poll, read

Exactly this sequence, every time:

1. **Trigger** the generation.
2. **Poll** `GetContentPlanFlow` with the returned flow ID until `status` reaches `KEYWORD_RESEARCH`.
3. **Release** the flow by calling `CreateContentPlan` with the flow ID.
4. **Poll** again until `status` reaches `SUCCESS`.
5. **Read** the results: `ListBlogPostCandidates` for briefs, `ListKeywordResearchItems` for keywords.

Do not skip step 3. Do not call `ListBlogPostCandidates` before `SUCCESS`.

## The three services

All paths are relative to `https://www.wixapis.com/promote/seo/v1`.

| Service | What it tracks | Methods |
|---|---|---|
| Content Plan Flow | The generation job | Trigger, Get (poll), Cancel |
| Blog Post Candidate | The deliverable briefs | List, Create Content Plan (releases the flow) |
| Keyword Research | The keyword rows the briefs are built from | List, Update (single, field-masked), Bulk Update |

## REST request and response shapes

Build requests from these shapes. Do not search API schemas.

### Trigger Content Plan Generation Flow — `POST /content-plan-flows/trigger`

No request body needed for external callers. `origin` is set to `AGENT` by the
server automatically.

```json
POST /content-plan-flows/trigger
{}
```

Response:
```json
{ "contentPlanFlowId": "a1b2c3d4-..." }
```

### Get Content Plan Flow — `GET /content-plan-flows/{contentPlanFlowId}`

No request body. Returns the flow with its `status`. Omit the ID to get the
site's most recent successful flow (useful for picking up a plan generated in
the dashboard).

Status values in order: `CREATED` → `SITE_ANALYSIS` → `KEYWORD_RESEARCH` →
`CONTENT_PLAN` → `SUCCESS`. Terminals: `FAIL`, `CANCELED`,
`PENDING_REQUIREMENTS`.

```json
{
  "contentPlanFlow": {
    "id": "a1b2c3d4-...",
    "status": "KEYWORD_RESEARCH",
    "createdAt": "2026-01-15T10:30:00Z",
    "updatedAt": "2026-01-15T10:31:45Z",
    "origin": "AGENT",
    "keywordResearchId": "e5f6g7h8-..."
  }
}
```

### Cancel Content Plan Flow — `POST /content-plan-flows/{contentPlanFlowId}/cancel`

No request body. Moves the flow to `CANCELED`.

### Create Content Plan — `POST /create-content-plan`

Releases the flow past `KEYWORD_RESEARCH`. On a `SUCCESS` flow, regenerates
under a new flow ID.

```json
POST /create-content-plan
{ "contentPlanFlowId": "a1b2c3d4-..." }
```

Response includes `success`, `contentPlanFlowId` (may differ on regeneration),
and `message` on failure.

Check `success` in the response. If `false`, read `message` for the reason.
Common failures:
- `FLOW_NOT_READY_FOR_CONTENT_PLAN` — the flow is not at a status this method can act on
- `CONTENT_PLAN_FLOW_NOT_FOUND` — bad flow ID
- `CONTENT_PLAN_FLOW_CANCELED` — someone canceled the flow mid-generation

### List Blog Post Candidates — `GET /content-plan-flows/{contentPlanFlowId}/blog-post-candidates`

Returns briefs: title, keyword, SERP data, page URL. Set
`includeOnlyUnmarked=true` to skip candidates already turned into posts.
Omit `contentPlanFlowId` to read the latest successful flow.

```json
{
  "blogPostCandidates": [
    {
      "id": "flow123_candidate456",
      "briefData": {
        "h1Title": "10 Best Coffee Beans for Home Brewing",
        "keyword": "best coffee beans",
        "mainKeyword": "coffee beans",
        "pageUrl": "/blog/coffee-guide"
      }
    }
  ],
  "pagingMetadata": { "cursors": { "next": "..." } }
}
```

### List Keyword Research Items — `GET /content-plan-keyword-research-items`

Returns keyword rows: keyword, page, search volume, competition, cluster.
Always returns the site's most recent promoted research.

```json
{
  "keywordResearchItems": [
    {
      "id": "kw-abc-123",
      "keyword": "best coffee beans",
      "pageId": "page-1",
      "pageUrl": "/blog/coffee-guide",
      "searchVolume": 12100,
      "competition": 45,
      "primary": true,
      "clusterName": "coffee brewing"
    }
  ],
  "keywordResearchId": "e5f6g7h8-...",
  "mainKeywordMap": { "page-1": "kw-abc-123" }
}
```

### Update Keyword Research Item — `PATCH /keyword-research-items/{item.id}`

Single item, field-masked. Only `keyword` and `main_keyword` are writable.

```json
PATCH /keyword-research-items/{itemId}
{
  "keywordResearchId": "e5f6g7h8-...",
  "item": { "id": "kw-abc-123", "keyword": "organic coffee beans" },
  "fieldMask": "keyword"
}
```

**Copy-on-write:** the first edit to AI-generated research creates a copy.
The response may carry a different `keywordResearchId`. Always use the one
from the response for the next write.

**Edits are not durable across generations.** A later completed generation
produces fresh research that shadows the edited copy.

### Bulk Update Keyword Research Items — `POST /bulk/keyword-research-items/update`

Same item shape as Update, no field mask. Per-entry results via
`itemMetadata.originalIndex`. Check `bulkActionMetadata.totalFailures`; if
non-zero, inspect each result's `itemMetadata` and retry only the failed
entries.

```json
POST /bulk/keyword-research-items/update
{
  "keywordResearchId": "e5f6g7h8-...",
  "items": [
    { "id": "kw-abc-123", "keyword": "organic coffee beans" },
    { "id": "kw-def-456", "mainKeyword": true }
  ]
}
```

## Worked example: generate a content plan and read the briefs

The user asks: *"Generate a content plan for my site and show me the blog
topics."*

**Step 1 — trigger.**

```
POST https://www.wixapis.com/promote/seo/v1/content-plan-flows/trigger
{}
```

Response: `{ "contentPlanFlowId": "flow-abc-123" }`

**Step 2 — poll until KEYWORD_RESEARCH.**

```
GET https://www.wixapis.com/promote/seo/v1/content-plan-flows/flow-abc-123
```

Poll every few seconds. Status walks: `CREATED` → `SITE_ANALYSIS` →
`KEYWORD_RESEARCH`. This takes a few minutes (AI pipeline).

**Step 3 — release the flow.**

```
POST https://www.wixapis.com/promote/seo/v1/create-content-plan
{ "contentPlanFlowId": "flow-abc-123" }
```

Check `success: true`.

**Step 4 — poll until SUCCESS.**

Same GET, same flow ID. Status walks `CONTENT_PLAN` → `SUCCESS`.

**Step 5 — read the briefs.**

```
GET https://www.wixapis.com/promote/seo/v1/content-plan-flows/flow-abc-123/blog-post-candidates
```

Report each brief: title, target keyword, page URL.

## Common agent mistakes — do not make these

- **Polling forever without calling Create Content Plan.** The flow parks at
  `KEYWORD_RESEARCH`. Only step 3 moves it.
- **Reading candidates before SUCCESS.** The briefs are not ready until the
  flow reaches `SUCCESS`.
- **Ignoring `PENDING_REQUIREMENTS`.** This means the site has no business
  description or category. Surface this to the user and stop. The flow will
  not proceed until the site data is provided.
- **Discarding the `keywordResearchId` from a write response.** The copy-on-
  write pattern means the ID can change. Always use the one from the response.
- **Retrying a 403.** Stop after the first `PERMISSION_DENIED`. The caller
  lacks **Manage SEO Settings**.
- **Sending a site ID.** The API selects the site from the authorization
  context. There is no site ID parameter.

## Recovery rules

- **`PENDING_REQUIREMENTS`:** the site needs a business description and
  category before generation can proceed. Tell the user what is missing and
  stop. Do not retry or cancel.
- **`FAIL`:** the AI pipeline failed. Trigger a new flow to retry. Each
  trigger creates a new flow with a new ID.
- **`CANCELED`:** someone called Cancel. No recovery needed unless the
  generation is still wanted, in which case trigger a new flow.
- **`FLOW_NOT_READY_FOR_CONTENT_PLAN`:** the flow is not at `KEYWORD_RESEARCH`
  or `SUCCESS`. Check the current status and act accordingly.
- **Permission denied:** stop after the first 403. The caller lacks **Manage
  SEO Settings**. Do not retry with a different request.

## What this API does not do

- **Mark candidates as used.** Marking happens through the Blog app when a
  real post is created. `includeOnlyUnmarked` reflects only what Blog has
  marked; track what you have written on your side.
- **Add or delete keywords.** Public writes can only update existing keyword
  rows. The dashboard can add/delete via an internal method.
- **Create blog posts.** This API produces briefs. Writing the actual blog
  post is done through the Blog API or the user's own tooling.

This recipe is self-contained for the common flows. Build every request from
the shapes above.
