---
name: "Generate and Read a Wix Site's Content Plan"
description: Generate an SEO content plan and read its blog post topics, or troubleshoot an existing content plan flow stuck at KEYWORD_RESEARCH while polling GetContentPlanFlow. Use this recipe for both generation and stalled-flow questions: it explains the intentional pause, the Create Content Plan release request, missing flow IDs, and the exact public API paths and response fields.
---

# Generate and Read a Wix Site's Content Plan

A **content plan** is a set of suggested blog post briefs, including titles,
keywords, and the existing site pages they support. A **content plan flow** is
the asynchronous job that generates those briefs. Its `contentPlanFlowId` is
a flow UUID, distinct from the site's ID, and its `status` reports progress.
Generation creates briefs, not published posts.

For a new plan, the workflow is: **trigger → check status → release → check
status → read briefs**. `KEYWORD_RESEARCH` means keyword research is complete
and the job is waiting for Create Content Plan to generate the briefs.
Polling alone does not release that pause.

All paths below are relative to `https://www.wixapis.com/promote/seo/v1`.
Use the selected site's authorization context. Trigger and Create Content Plan
are writes requiring **Manage SEO Settings**; execute them when the user has
requested generation or explicitly confirmed it.

Retain the site ID supplied with the request. A missing site-context result is
missing descriptive information, not proof that the site ID is invalid or that
the caller lacks access. Do not replace the selected site with one from a site
list. When the user requested generation and the API client can scope requests
to that site, proceed with step 1 using its existing authorization. Let an
actual API authorization error determine whether access is blocked; never
switch credentials or sites to get around one. If the client cannot scope a
request to the selected site, report that specific limitation without claiming
the site belongs to another account.

## Choose the request path before calling an API

For a request to **generate a new plan**, follow the generation sequence below.
An **existing flow** is a job already started by a previous trigger, including
one discussed earlier in the conversation. To resume it or read its results,
reuse its ID instead of triggering a replacement.

For an existing flow, first look for its actual `contentPlanFlowId` in the
conversation or a previous trigger/status response:

- **Missing ID:** If the user reports `KEYWORD_RESEARCH`, explain the intentional
  pause and ask for the flow ID. End the turn without an API call. For example:
  “Keyword research is complete, but generation needs a Create Content Plan
  request to continue. Please send the flow ID from your trigger or status
  response so I can release that flow.” A site ID is not a flow ID, even though
  both are UUIDs. Never submit a placeholder or guess a collection endpoint to
  find the parked flow. Ask only for the actual flow ID; do not offer a fresh
  flow or a different site as an alternative to recovering it. Missing site
  metadata does not change this troubleshooting answer.
- **Known ID:** Check that flow with the single GET in step 2. At
  `KEYWORD_RESEARCH`, release it once when completion is requested, then follow
  steps 4–5. At `SUCCESS`, go directly to step 5; do not release it again just
  to read results. For an in-progress status, continue separate checks.

The exact status URL is
`https://www.wixapis.com/promote/seo/v1/content-plan-flows/{contentPlanFlowId}`.
Do not use `GET /content-plan-flows` without an ID or build URLs from service
names. Omitted-ID retrieval selects a previous successful flow, not the parked
flow; it cannot recover a missing active flow ID.

Only Trigger and Create Content Plan write data in the generation path. Do not
change the site's business profile, name, description, categories, or publication
state to accelerate it. Those are separate tasks requiring real user data and
authorization. `CREATED` can mean queued work, not missing setup.

Keep every call scoped to the selected site. Do not invent business information
to satisfy prerequisites. Missing descriptive site context alone is not a
generation prerequisite and does not require the user to choose another site.

## Polling without losing progress

**One API execution makes one HTTP request and returns.** The sequence below
is a series of separate calls, with a decision after each response. It is not
one code block containing the entire workflow. Never wrap API calls in a
`for`/`while` loop, a timer, or a function that polls until a target status.

Retain each response's flow ID before the next call. Wait between status checks
using the client's supported waiting capability, outside the API execution;
do not assume timers exist inside that execution or busy-wait there.

Keep checking while work progresses. If waiting cannot continue, report the
flow ID and last observed status as incomplete; do not claim success or merely
promise to finish later. Identify trigger and release as writes if asked
whether an execution changes data.

## The exact call sequence

### 1. Trigger

```
POST /content-plan-flows/trigger
{}
```

Response:

```json
{ "contentPlanFlowId": "<flow-uuid>" }
```

`<flow-uuid>` and other angle-bracket values in these examples are placeholders;
substitute actual returned values before making requests. Return this response
and end this execution here. Save the ID before making any status request.
Do not append step 2 to the trigger script.
See [Trigger Content Plan Generation Flow](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-content-plan-flow-v1/trigger-content-plan-generation-flow).

### 2. Poll until KEYWORD_RESEARCH

```
GET /content-plan-flows/{contentPlanFlowId}
```

Execute this GET once and return its response. This execution contains no
`for`/`while` loop and no timer. Repeat it as a separate call when another
status check is needed. Keep the response compact: flow ID and status suffice.

Example response, showing the public flow fields (optional fields may be absent):

```json
{
  "contentPlanFlow": {
    "id": "<flow-uuid>",
    "createdAt": "2026-09-08T10:00:00.000Z",
    "updatedAt": "2026-09-08T10:01:00.000Z",
    "status": "KEYWORD_RESEARCH",
    "origin": "AGENT",
    "summaryId": "<summary-uuid>",
    "keywordResearchId": "<keyword-research-uuid>"
  }
}
```

Read `contentPlanFlow.status`, not a top-level `status`. If it is missing,
inspect the response instead of silently looping. Always use this generation's
flow ID; if it stays `CREATED`, report the ID and observed status without
inventing missing business prerequisites.
See [Get Content Plan Flow](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-content-plan-flow-v1/get-content-plan-flow).

`contentPlanFlow.status` is a string enum. Status checks may skip intermediate
states; decide from the returned value rather than requiring every transition.
Typical status progression: `CREATED` → `SITE_ANALYSIS` → `KEYWORD_RESEARCH`
→ (release) → `CONTENT_PLAN` → `SUCCESS`.

| Status | Meaning and next action |
| --- | --- |
| `CREATED` | Queued or starting. Check the same flow again; do not change site settings. |
| `SITE_ANALYSIS` | Analyzing site pages. Continue separate checks. |
| `SITE_SUMMARY` | Summarizing existing content. Continue separate checks. |
| `KEYWORD_RESEARCH` | Waiting for Create Content Plan. Release once when generation is requested. |
| `CONTENT_PLAN` | Generating briefs. Continue separate checks; do not release again. |
| `SUCCESS` | Ready. Read candidates in step 5. |
| `PENDING_REQUIREMENTS` | Missing business information. Stop polling and report the actual unmet requirement from evidence. Do not invent or update business data, or repeatedly trigger replacements. |
| `FAIL` | Generation failed. Report the flow ID and failure; do not silently start a replacement. |
| `CANCELED` | Canceled and cannot be resumed. Report it and stop. |
| `UNKNOWN` | No usable status. Inspect the response and report uncertainty instead of guessing progress. |

Check every few seconds using separate calls. Completion time varies.

### 3. Release the flow

```
POST /create-content-plan
{ "contentPlanFlowId": "<flow-uuid>" }
```

Successful response:

```json
{
  "success": true,
  "contentPlanFlowId": "<flow-uuid>"
}
```

Failure response fields (the diagnostic text comes from the API):

```json
{
  "success": false,
  "message": "<reason returned by the API>"
}
```

The response fields are `success` (boolean), `message` (failure reason, only
when `success` is false), and `contentPlanFlowId` (flow UUID when returned).
Check `success` as well as the HTTP status. If false, report `message` and stop;
a successful HTTP response alone is not a completed plan.

On success, retain the returned `contentPlanFlowId` for the next status check
and candidate read. This response is not the list of briefs: continue to steps
4 and 5. Do not call release again to retrieve results; on an already successful
flow it regenerates a plan under a new flow ID.
See [Create Content Plan](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-blog-post-candidate-v1/create-content-plan).

### 4. Poll until SUCCESS

Same single-GET execution and nested response as step 2, using the release
response's flow ID and returning after each check. Typical status progression:
`CONTENT_PLAN` → `SUCCESS`. Read candidates in a subsequent execution after
observing `SUCCESS`.

### 5. Read the briefs

```
GET /content-plan-flows/{contentPlanFlowId}/blog-post-candidates
```

Example response showing the fields needed to display one topic:

```json
{
  "blogPostCandidates": [
    {
      "id": "<candidate-id>",
      "briefData": {
        "h1Title": "How to Care for Handmade Ceramic Mugs",
        "keyword": "ceramic mug care",
        "mainKeyword": "handmade ceramic mugs",
        "pageUrl": "https://www.example.com/mugs"
      }
    }
  ],
  "pagingMetadata": { "count": 1, "cursors": {}, "hasNext": false }
}
```

This is illustrative data, not the user's results. Candidates can contain
additional fields; see the linked reference for the full contract. Omitting
`paging` returns all candidates in a single response. Each candidate's brief
fields are nested under `briefData`, not at the candidate's top level. Map them
directly:

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

## Do not

- Poll forever without calling Create Content Plan (step 3).
- Read candidates before `SUCCESS`.
- Retry after `PENDING_REQUIREMENTS`.
- Ask for a site ID.
- Retry after a 403 — the caller lacks **Manage SEO Settings**.
