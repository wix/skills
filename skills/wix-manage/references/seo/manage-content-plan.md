---
name: "Generate and Read a Wix Site's Content Plan"
description: "Generate an SEO content plan for a Wix site, read suggested blog post topics and keywords, or diagnose and continue an existing stalled generation flow, including requests with missing flow identifiers."
---

# Generate and Read a Wix Site's Content Plan

A content plan contains suggested blog post briefs, not published posts.
`contentPlanFlowId` identifies the generation job, not the site.

For an existing job, require its `contentPlanFlowId` before any API call. Ask
for it; if no user can answer, report incomplete and stop. A site ID, an ID-less
flow GET or the latest successful flow cannot identify the user's job. Explain
that continuation follows [step 3](#3-check-research-and-release-once): check the
flow's own `keywordResearchId` research for `SUCCESS`, then release once only if
a fresh flow read still shows `KEYWORD_RESEARCH`.

`KEYWORD_RESEARCH` means research has started, not finished. Some flows advance
automatically; `CONTENT_PLAN` or `SUCCESS` needs no release. Polling alone does
not release a flow that is waiting for Create Content Plan.

Use the selected site's authorization context. Writes require **Manage SEO
Settings**; execute them when the user requests the change or confirms it. Never
change business data or publication state just to accelerate generation.

Use only IDs and values that the API returned or the user supplied; every example
value is a placeholder. If a request tool needs `siteId`, use the selected or
supplied site ID, never `contentPlanFlowId`.

Each path below is the endpoint shown on its linked public reference, except
Get Site Keyword Research, whose own page is not public yet (see
[step 3](#read-the-matching-research)). All use the
`https://www.wixapis.com/seo-content-plan-service/v1` base. Every call here was
sent live on this base. Trigger, Get Content Plan Flow, Get Site Keyword
Research, List Blog Post Candidates and List Keyword Research Items returned
data. Create Content Plan and Update Keyword Research Item were sent with IDs
that match no record and returned the service's own errors (for example
`CONTENT_PLAN_FLOW_NOT_FOUND`), not a missing-route error. A `404` on one of
these paths is an error to report, not a reason to try another base.

## 1. Trigger or inspect an existing flow

For new generation, trigger once:

```
POST https://www.wixapis.com/seo-content-plan-service/v1/content-plan-flows/trigger
{}
```

Response: `{ "contentPlanFlowId": "<flow-uuid>" }`. Save the ID.
[Trigger Content Plan Generation Flow](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-content-plan-flow-v1/trigger-content-plan-generation-flow).

For an existing flow, apply the entry gate above. Keep its ID, last observed
status and release history for a later resume.

## 2. Read status with bounded waiting

```
GET https://www.wixapis.com/seo-content-plan-service/v1/content-plan-flows/{contentPlanFlowId}
```

Read nested `contentPlanFlow.status`. Example:

```json
{
  "contentPlanFlow": {
    "id": "<flow-uuid>",
    "status": "KEYWORD_RESEARCH",
    "keywordResearchId": "<research-uuid>"
  }
}
```

Pacing:

1. The first check needs no pause. Set an end time with a supported clock: five
   minutes by default, or a shorter runtime limit or user-requested window.
2. Between checks, wait about 15 seconds with the client's supported delay. Use
   a separate wait or scheduling tool if one exists. Only if you run code
   yourself and have no such tool, put one awaited sleep of about 15 seconds in
   that code, before its single GET (for example,
   `await new Promise(r => setTimeout(r, 15000))` in JavaScript or
   `time.sleep(15)` in Python). A sleep that is not awaited does not pause. With
   neither a wait tool nor code execution, go to step 4. Sending checks back to
   back with no pause is not pacing. This is client pacing, not an API rate
   limit or a completion-time promise.
3. **Each execution makes one HTTP request and returns.** Before each later
   check, confirm the pause fits the window and wait once. Then read the clock
   again: if the window has ended, go to step 4 without sending. Otherwise send
   one GET and read its result. Never loop requests, busy-wait, or use API or doc calls as a
   pause; request counts and frozen `updatedAt` values do not measure time.
4. If no usable clock or waiting exists, or the window ends, report incomplete
   with the saved ID, status and release history. Expiry does not prove failure.
   End the turn for a later requested resume; do not restart automatically.

| Observed status | Action |
| --- | --- |
| `CREATED`, `SITE_ANALYSIS`, `SITE_SUMMARY` | Continue paced checks within the window. |
| `KEYWORD_RESEARCH` | Follow [Check research and release once](#3-check-research-and-release-once), within the same monitoring window. |
| `CONTENT_PLAN` | Continue paced checks; skip release. |
| `SUCCESS` | Stop waiting and read candidates. |
| `PENDING_REQUIREMENTS` | Stop; report the unmet requirement. Never invent site data. |
| `FAIL`, `CANCELED` | Report the ID and result, then stop. |
| Missing or unrecognized status | Report uncertainty; do not silently poll. |

[Get Content Plan Flow](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-content-plan-flow-v1/get-content-plan-flow).

## 3. Check research and release once

Create Content Plan is an action on Blog Post Candidate, distinct from the
flow-status read. It requires matching research `SUCCESS`; elapsed time at this
stage proves neither readiness nor failure.

1. No `keywordResearchId` on the flow: report it missing and stop; do not guess it.
2. Read **that exact research** (below), not the latest research. Not `SUCCESS`
   yet: pause, then read again.
3. Research `SUCCESS`: read the same flow again, with no extra delay.
4. Flow still `KEYWORD_RESEARCH` with the same research ID: [release once](#release-once).
   `CONTENT_PLAN` or `SUCCESS`: skip release and follow the status. A changed
   research ID: check the new research; the old success does not authorize it.

### Read the matching research

```
GET https://www.wixapis.com/seo-content-plan-service/v1/site-keyword-research?keywordResearchId={keywordResearchId}
```

Require `siteKeywordResearch.id` and `contentPlanFlowId` to match the flow being
followed, then read `status`. Never omit the query ID: the ID-less read returns
the latest successful research, not this job's. Keyword-list items are not a
research-status check.

Minimal matching response:

```json
{
  "siteKeywordResearch": {
    "id": "<research-uuid>",
    "status": "SUCCESS",
    "contentPlanFlowId": "<flow-uuid>"
  }
}
```

This check is the published procedure: the [Create Content Plan reference](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-blog-post-candidate-v1/create-content-plan)
says to poll Get Site Keyword Research with the flow's `keywordResearchId` until
`SUCCESS`, then re-read the flow before releasing, and the
[Get Content Plan Flow reference](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-content-plan-flow-v1/get-content-plan-flow)
says the same.

Get Site Keyword Research itself is a BETA method with no public reference page
of its own. It requires `wix-seo.read`. The query parameter, response fields and
statuses above match its API definition and live responses on this base.

**Fallback:** if this call fails, is unavailable, or returns a response without
the matching `id`, `contentPlanFlowId` and a `status` shown above, do not
release. Keep paced flow reads only: a flow that reaches `CONTENT_PLAN` or
`SUCCESS` needs no release; one still at `KEYWORD_RESEARCH` when the window ends
is reported incomplete with its IDs. This follows the Create Content Plan
reference, which requires research `SUCCESS` before release.

### Release once

When the user requested generation or continuation, and no release has already
been attempted for this flow, call Create Content Plan **once**:

```
POST https://www.wixapis.com/seo-content-plan-service/v1/create-content-plan
{ "contentPlanFlowId": "<flow-uuid>" }
```

Minimal response examples:

```json
{ "success": true, "contentPlanFlowId": "<returned-flow-uuid>" }
```

```json
{ "success": false, "message": "<failure-message>" }
```

Record the attempt before sending. Concurrent/repeated calls can duplicate plans.
If release history is uncertain, ask rather than send another POST. Check HTTP
status and response `success`; `false` requires reporting `message`, not claiming
completion. On HTTP `428` with application code
`FLOW_NOT_READY_FOR_CONTENT_PLAN` (listed in the Create Content Plan reference's
errors), inspect the error and make a paced
status recheck; do not retry the POST in a loop. Other errors or an
uncertain response require reporting the attempt, not repeating it.

On success, retain the returned `contentPlanFlowId` and monitor it with the same
bounded, single-request approach. A different returned ID is a separate flow;
explain that and never claim the original completed. Completion still requires
observed `SUCCESS` and returned candidates. Do not release an already successful
flow to recover it: that action regenerates a separate plan.
[Create Content Plan](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-blog-post-candidate-v1/create-content-plan).

### Edge cases

| Situation | Action |
| --- | --- |
| Research briefly not found | The flow can link the ID before its research record exists. Read again after a pause within the window, then inspect the flow if it persists; do not release or restart. |
| Research `FAIL`, `CANCELED`, `REVERTED`, missing/unknown status, or mismatched IDs | Stop and report the result; no release or replacement. |
| Get Site Keyword Research unavailable | Keep the error and IDs. Continue paced flow reads only: `CONTENT_PLAN`/`SUCCESS` needs no release; still `KEYWORD_RESEARCH` when the window ends means report incomplete, because readiness cannot be verified. Never release from flow status or keyword-list items. |
| Authorization denied or other error | Report the specific error and keep the IDs; no private fallback or readiness guess. |

## 4. Read and present briefs

Only after observing `SUCCESS` for the same flow:

```
GET https://www.wixapis.com/seo-content-plan-service/v1/content-plan-flows/{contentPlanFlowId}/blog-post-candidates
```

Omit `paging` to return all candidates. Read titles and keywords from `briefData`:

```json
{
  "blogPostCandidates": [{
    "id": "<candidate-id>",
    "briefData": {
      "h1Title": "How to Care for Handmade Ceramic Mugs",
      "keyword": "ceramic mug care",
      "mainKeyword": "handmade ceramic mugs",
      "pageUrl": "https://www.example.com/mugs"
    }
  }],
  "pagingMetadata": { "count": 1, "hasNext": false }
}
```

The final reply must give the flow ID, observed completion and count,
followed by a table with **Title | Keyword | Main keyword | Supporting URL**.
Populate all four columns from `briefData`, with clickable supporting URLs;
a titles-only or titles/main-keywords table is incomplete. Label any shortened subset.
Absent fields are unavailable; do not invent them. `pageUrl` supports an existing
page, not a newly published post. Explain weak or repetitive results honestly;
successful generation does not establish editorial quality or promise rankings.
[List Blog Post Candidates](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-blog-post-candidate-v1/list-blog-post-candidates).

## Editing keywords after completion (optional)

After observed flow `SUCCESS`, read research once:

```
GET https://www.wixapis.com/seo-content-plan-service/v1/content-plan-keyword-research-items
```

No parameters are required; omit optional `paging` for all items. Match returned
`keywordResearchId` to the completed flow and use returned `keywordResearchItems`
item IDs before editing. A mismatch or HTTP `404` is not permission to edit or
retry immediately. This is a post-completion read, not a pre-completion readiness
test.
The list is site-scoped and returns the latest research, not per-research status.
Its reserved `contentPlanFlowId` query field is ignored; it cannot target an older
flow or prove that flow's readiness.
[List Keyword Research Items](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-keyword-research-v1/list-keyword-research-items).

Only `keyword` and `mainKeyword` are writable, using a field mask.
Set `mainKeyword: true` to promote an existing item. Whether `false` demotes one
is not verified; do not rely on it, and read the item back after any change.
[Update Keyword Research Item](https://dev.wix.com/docs/api-reference/business-management/seo/content-plan-keyword-research-v1/update-keyword-research-item).

List uses `content-plan-keyword-research-items`, while Update uses
`keyword-research-items/{itemId}`. Preserve that difference. Use the returned
`item.id` for `{itemId}` and the same value in the Update body.

```
PATCH https://www.wixapis.com/seo-content-plan-service/v1/keyword-research-items/{itemId}
{
  "keywordResearchId": "<research-uuid>",
  "item": { "id": "<item-id>", "keyword": "new keyword" },
  "fieldMask": "keyword"
}
```

The copy-on-write response can return a new `keywordResearchId`; use it for the
next write. Edits do not persist across generations.
