---
name: "Generate and Read a Wix Site's Content Plan"
description: Trigger an AI content plan for a Wix site, poll to completion, and read the blog post briefs. The flow parks mid-way and must be explicitly released — this recipe tells you when and how.
---

# Generate and Read a Wix Site's Content Plan

Trigger, poll, release, poll, read. That is the full loop. The API is
asynchronous — generation takes minutes — and the flow **parks at
`KEYWORD_RESEARCH` until you explicitly release it**.

All paths are relative to `https://www.wixapis.com/promote/seo/v1`.
The API selects the site from the caller's authorization context.
Writing requires the **Manage SEO Settings** permission.

## The exact call sequence

### 1. Trigger

```
POST /content-plan-flows/trigger
{}
```

Returns `{ "contentPlanFlowId": "..." }`. Hold this ID.

### 2. Poll until KEYWORD_RESEARCH

```
GET /content-plan-flows/{contentPlanFlowId}
```

Status walks: `CREATED` → `SITE_ANALYSIS` → `KEYWORD_RESEARCH`. Poll every
few seconds. This takes 1–5 minutes.

**Stop polling and act on these terminal states:**
- `PENDING_REQUIREMENTS` — the site has no business description or category.
  Tell the user what is missing. Do not retry.
- `FAIL` — the pipeline failed. Trigger a new flow to retry.
- `CANCELED` — someone canceled the flow.

### 3. Release the flow

```
POST /create-content-plan
{ "contentPlanFlowId": "..." }
```

This advances the flow past `KEYWORD_RESEARCH`. Check `success` in the
response. If `false`, read `message`.

**Without this call the flow waits forever.**

### 4. Poll until SUCCESS

Same GET as step 2. Status walks `CONTENT_PLAN` → `SUCCESS`.

### 5. Read the briefs

```
GET /content-plan-flows/{contentPlanFlowId}/blog-post-candidates
```

Returns blog post briefs: title, keyword, page URL. Report each one.

## Editing keywords (optional)

After step 2, before or after step 3, read the keywords:

```
GET /content-plan-keyword-research-items
```

Edit one keyword (field-masked, only `keyword` and `main_keyword` writable):

```
PATCH /keyword-research-items/{itemId}
{
  "keywordResearchId": "...",
  "item": { "id": "...", "keyword": "new keyword" },
  "fieldMask": "keyword"
}
```

**Copy-on-write:** the response may carry a different `keywordResearchId`.
Always use the one from the response for the next write. Edits are not
durable across generations.

## What this recipe adds over the docs

The published reference documents each method. This recipe adds:

1. **The parking gate.** The docs say `KEYWORD_RESEARCH` is a status. This
   recipe says: the flow stops there until you call Create Content Plan.
   Without that call, polling runs forever.

2. **PENDING_REQUIREMENTS handling.** A blank site or one without business
   data reaches this state. The correct action is to tell the user, not to
   retry or wait.

3. **Copy-on-write on keyword edits.** The `keywordResearchId` can change
   on the first write. Use the one from the response.

## Do not

- Poll forever without calling Create Content Plan (step 3).
- Read candidates before `SUCCESS`.
- Retry after `PENDING_REQUIREMENTS`.
- Ask for a site ID.
- Retry after a 403 — the caller lacks **Manage SEO Settings**.
