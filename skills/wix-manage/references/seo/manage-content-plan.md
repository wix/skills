---
name: "Generate and Read a Wix Site's Content Plan"
description: Generate an SEO content plan and read its blog post topics, or troubleshoot an existing content plan flow stuck at KEYWORD_RESEARCH while polling GetContentPlanFlow. Use this recipe for both generation and stalled-flow questions: it explains the intentional pause, the Create Content Plan release request, missing flow IDs, and the exact public API paths and response fields.
---

# Generate and Read a Wix Site's Content Plan

## Choose the request path before calling an API

For a request to **generate a new plan**, follow the generation sequence below.
For a request about an **existing flow**, use this branch instead; do not start
the generation sequence or make a discovery call to look for the flow.

`KEYWORD_RESEARCH` is an intentional pause, even after ten minutes. Explain
that Create Content Plan (step 3) releases the existing flow; do not cancel it
or trigger a replacement just because it is parked.
First check whether the conversation or a prior response contains the actual
`contentPlanFlowId`:

- **Missing ID:** Explain the intentional pause and ask for the existing flow
  ID. End the turn without making a status or release call. You can name the
  release endpoint, `POST https://www.wixapis.com/promote/seo/v1/create-content-plan`,
  but do not execute an example request. Placeholder text such as
  `<YOUR_FLOW_ID>` is never an API argument.
- **Known ID:** Use that actual flow UUID in the step 3 request's
  `contentPlanFlowId` field to release the existing flow when requested.

For example, when the user reports a flow parked at `KEYWORD_RESEARCH` but
provides only a site ID, the next action is a reply, not an API call:

> That status is an intentional pause. Create Content Plan releases the
> existing flow. Please send the content plan flow ID from your trigger or
> status response so I can use it in the release request.

The user's reported status is enough to explain the pause; checking it first
requires the very flow ID that is missing. A site ID is not a flow ID, even
though both have UUID format.
Do not guess a collection endpoint to discover the active flow.

The complete status URL is
`https://www.wixapis.com/promote/seo/v1/content-plan-flows/{contentPlanFlowId}`.
Use this exact public base path and substitute the known ID. Do not call
`GET /content-plan-flows` without an ID or construct a URL from a service name.

Trigger, poll, release, poll, read. That is the full loop. The API is
asynchronous — generation takes minutes — and the flow **parks at
`KEYWORD_RESEARCH` until you explicitly release it**.

All paths are relative to `https://www.wixapis.com/promote/seo/v1`.
The API selects the site from the caller's authorization context.
Writing requires the **Manage SEO Settings** permission.

For a generation request, the only writes in this workflow are Trigger and
Create Content Plan. Do not update the site's business profile, name,
description, categories, or publication state to try to accelerate generation.
Those are separate tasks requiring the user's actual data and authorization.
`CREATED` can persist while work is queued; it does not justify setup changes
or extra discovery calls. Continue checking the same flow without modifying
the site.

Keep every call scoped to the site the user selected. If site context cannot
be resolved, report the lookup failure and request clarification; do not
substitute another available site or change its business information. Missing
context is not proof that the selected site does not exist or belongs to a
different account. Say that its context could not be retrieved; do not claim
that the user's site ID is invalid or offer replacement sites. Likewise, unmet
prerequisites do not authorize switching sites or inventing business data.

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

Returns `{ "contentPlanFlowId": "..." }`. Return this response and end this
execution here. Save the ID in the conversation before making any status
request. Do not append step 2 to the trigger script.

### 2. Poll until KEYWORD_RESEARCH

```
GET /content-plan-flows/{contentPlanFlowId}
```

Execute this GET once and return its response. This execution contains no
`for`/`while` loop and no timer. Repeat it as a separate call when another
status check is needed. Keep the response compact: flow ID and status suffice.

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

Same single-GET execution as step 2, returning after each check. Status walks
`CONTENT_PLAN` → `SUCCESS`. Read candidates in a subsequent execution after
observing `SUCCESS`.

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

### Present the result

Start with the flow ID, observed `SUCCESS` status, and returned candidate count.
Use a compact table with one row per topic: suggested title, target keyword,
main keyword, and supporting page URL. Include the actual returned URL as a
link; do not merely say that each brief contains a URL. Avoid repeating SEO
titles and descriptions unless requested. If the answer must be shortened,
label the displayed subset and total explicitly instead of claiming to show all
topics. These are AI-generated suggestions; do not promise rankings or traffic.
Assess the returned topics before recommending them: if they are repetitive,
mostly restate the site name, or lack a clear connection to the site's business,
say so plainly. Successful generation does not establish editorial quality.
Still show the actual results; do not silently replace weak titles with invented
ones or call them optimized without evidence. Explain what business context
would help assess or refine them, without modifying the site's settings.

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

2. **PENDING_REQUIREMENTS handling.** This explicit status signals unmet
   prerequisites. Report it and identify the missing requirement only from
   evidence; do not infer it from a queued `CREATED` status or fill in business
   information on the user's behalf.

3. **Copy-on-write on keyword edits.** The `keywordResearchId` can change
   on the first write. Use the one from the response.

## Do not

- Poll forever without calling Create Content Plan (step 3).
- Read candidates before `SUCCESS`.
- Retry after `PENDING_REQUIREMENTS`.
- Ask for a site ID.
- Retry after a 403 — the caller lacks **Manage SEO Settings**.
