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

Keep every call scoped to the site the user selected. If site context cannot
be resolved, report the lookup failure and request clarification; do not
substitute another available site or change its business information. Missing
context is not proof that the selected site does not exist. Likewise, unmet
prerequisites do not authorize switching sites or inventing business data.

## Troubleshooting an existing flow

`KEYWORD_RESEARCH` is an intentional pause, even after ten minutes. Explain
that Create Content Plan (step 3) releases the existing flow; do not cancel it
or trigger a replacement just because it is parked.

Use the existing `contentPlanFlowId` from the conversation or a prior response.
If it is unavailable, explain the release request and ask for that flow ID
before attempting a status check or release. A site ID is not a flow ID.
Do not guess a collection endpoint to discover the active flow.

The complete status URL is
`https://www.wixapis.com/promote/seo/v1/content-plan-flows/{contentPlanFlowId}`.
Use this exact public base path and substitute the known ID. Do not call
`GET /content-plan-flows` without an ID or construct a URL from a service name.

## Polling without losing progress

Treat each numbered step below as a separate API execution, not sections of
one script. Even a loop capped at 60 polls can outlive the execution timeout
and lose the returned flow ID. A polling script must issue one GET and return
`{ contentPlanFlowId, status }` immediately; decide the next action after that
response. Never embed the trigger, polling loops, release, and candidate read
in a single execution. Trigger and release are mutations: if the client asks
whether an execution changes data, identify them as writes, not read-only.

Generation waits on an external process. Do not put the entire generation in
one long-running function, an unbounded `while` loop, or a busy-wait. Trigger
once and return the flow ID immediately. Use separate, bounded status checks
for the same ID so each response is visible and you can act on its status.
A status check is one GET, not a loop that waits for a terminal state.
Use the client's supported waiting mechanism between checks; do not assume
that timers or sleep functions exist inside an API execution sandbox.

Continue across status checks while the flow is progressing. At
`KEYWORD_RESEARCH`, release it immediately once, then keep checking that same
flow until `SUCCESS` and read its candidates. Do not keep polling the parked
state instead of releasing it, or stop with only a promise to finish later.
If the client cannot continue waiting, report the flow ID and last observed
status honestly; that is an incomplete generation, not success.

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

The response is `{ "contentPlanFlow": { "id": "...", "status": "..." } }`.
Read `contentPlanFlow.status`, not a top-level `status`. A missing status is a
response-shape problem: inspect the response instead of silently looping.
`CREATED` alone does not identify a missing prerequisite. If the flow remains
there without progressing, report the stalled flow ID and observed status; do
not invent a missing business category or description.
Always send the trigger's ID when following this generation. The documented
omitted-ID behavior selects a previous successful flow, not the active flow;
it is not a way to discover the ID of a parked flow.
See [Get Content Plan Flow](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-content-plan-flow-v1/get-content-plan-flow).

Typical status progression: `CREATED` → `SITE_ANALYSIS` → `KEYWORD_RESEARCH`. Check every
few seconds using the bounded approach above. Completion time varies.

**Stop polling and act on these terminal states:**
- `PENDING_REQUIREMENTS` — the site has unmet prerequisites, such as missing
  business location information. Identify the actual missing prerequisite from
  available evidence; do not assume category or description is the cause.
  Report what needs completing and do not repeatedly trigger new flows.
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

Returns `{ "blogPostCandidates": [...] }`. Each candidate's brief fields are
nested under `briefData`, not at the candidate's top level. Map them directly:

```js
const topics = response.blogPostCandidates.map(candidate => ({
  id: candidate.id,
  title: candidate.briefData?.h1Title,
  keyword: candidate.briefData?.keyword,
  mainKeyword: candidate.briefData?.mainKeyword,
  supportingPageUrl: candidate.briefData?.pageUrl
}));
```

`pageUrl` identifies the existing site page the proposed post supports; it is
not the URL of a newly published blog post. Generation creates briefs, not
published posts. Do not read `candidate.title`, `candidate.keyword`, or
`candidate.pageUrl`, or infer missing data from those nonexistent top-level
fields. If a nested field is absent, report it as unavailable and inspect the
raw candidate before making another request. Report the actual returned
titles and available keywords/supporting page URLs. Do not invent briefs or
claim completion from the release response.
See [List Blog Post Candidates](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-blog-post-candidate-v1/list-blog-post-candidates).

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
