---
name: "Recipe: Recommendation Tracking"
description: Standalone skill for persisting recommendations to the database and tracking their lifecycle. Loads recommendation history for context, persists new recommendations as PROPOSED, and tracks every merchant action (approve, reject, modify, execute). Active by default — disabled via session text instruction.
layer: tracking
references:
  - name: "API: Recommendation Tracking"
    path: ecommerce/api-recommendation-tracking.md
    load: true
---
# Recommendation Tracking

> **Before executing this skill**, read these referenced skills with `ReadFullDocsArticle`:
> - [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking)

## Activation Gate

This skill is **ACTIVE by default** for all recommendation flows.

**SKIP this entire skill if ANY of these conditions are true:**
- The session text contains `SKIP_TRACKING` or an instruction like "don't track changes", "no tracking", "skip tracking"
- The user explicitly says they don't want recommendations saved to the database

**When SKIPPED:** Do not query history, do not persist recommendations, do not call any tracking API. Generate and present recommendations without any database interaction. Proceed as if this skill does not exist.

**When ACTIVE:** Execute all phases below in order.

---

## Phase 1: Load recommendation history

**Run this FIRST, before generating any new recommendations.**

Query the tracking database for existing recommendations on this site. This gives the LLM context about what was already proposed, applied, rejected, or failed — so it can make better decisions.

Call `CallWixSiteAPI` with:

```
url: https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/query
method: POST
siteId: <siteId>
body: {
  "query": {
    "filter": {},
    "cursorPaging": { "limit": 50 }
  }
}
```

### Interpreting the history

Use the returned recommendations to inform your analysis:

| State | What it means | How to use it |
|---|---|---|
| `PROPOSED` | Recommendation was suggested but merchant hasn't acted | Don't re-propose the same recommendation — ask about the pending one |
| `APPROVED` | Merchant agreed but it hasn't been applied yet | Continue with execution |
| `EXECUTING` | Application is in progress | Don't generate new recommendations for the same scope |
| `DONE` | Successfully applied | Don't re-propose — it's already done. Consider complementary recommendations |
| `FAILED` | Application was attempted but failed | Offer to retry or suggest alternative approach |
| `REJECTED` | Merchant declined | Do NOT re-propose rejected recommendations. If `rejectionPermanent` is true, never suggest this action type again for this site |
| `EXPIRED` | Recommendation timed out | Can re-propose if still relevant with fresh data |

### History context injection

Summarize the history for the domain skill:

```
RECOMMENDATION HISTORY:
- [DONE] "15% Off Electronics" (discounts) — applied 2026-05-08
- [REJECTED] "Free Shipping Over $50" (shipping) — rejected: "threshold too low", permanent: false
- [PROPOSED] "Bundle Deal: Buy 2 Get 10% Off" (discounts) — pending since 2026-05-09
```

This context helps the domain skill:
- Avoid re-proposing rejected recommendations
- Build on what was already applied
- Reference pending recommendations instead of creating duplicates

**If query returns no recommendations:** This is a fresh session. Proceed to Phase 2 after recommendations are generated.

---

## Phase 2: Persist new recommendations

**Run this AFTER the domain skill generates recommendations and BEFORE presenting them to the merchant.**

Every new recommendation must be saved to the database as PROPOSED before the merchant sees it.

Call `CallWixSiteAPI` with:

```
url: https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/batch-create
method: POST
siteId: <siteId>
body: {
  "agenticRecommendations": [
    {
      "title": "<recommendation title>",
      "reasoning": "<recommendation reasoning>",
      "domain": "<domain: shipping, discounts, etc.>",
      "urgency": "<CRITICAL|HIGH|MEDIUM|LOW>",
      "advice": {
        "action": "<action type>",
        "params": <params object from recommendation>,
        "successCriteria": "<how to verify success>"
      }
    }
  ],
  "conversationId": "<conversationId>"
}
```

**Map each recommendation directly** into the `agenticRecommendations` array. Pass ALL items verbatim — do not filter, skip, or transform any fields.

**Save the `id` and `revision`** from each result in the response. Attach these to each recommendation when presenting to the merchant — they're needed for all subsequent state transitions.

---

## Phase 3: Track merchant actions

**Run this on EVERY merchant response** that relates to a tracked recommendation.

### Merchant approves → Apply the change

Execute these state transitions in sequence before and after applying:

```
1. Approve:      POST .../agentic-recommendations/{id}/approve      body: { "revision": "<current>" }
2. MarkExecuting: POST .../agentic-recommendations/{id}/mark-executing body: { "revision": "<from step 1>" }
3. Apply the domain change (create discount, shipping option, etc.)
4a. On success:  POST .../agentic-recommendations/{id}/mark-done   body: { "revision": "<from step 2>", "executionResult": { "status": "SUCCESS", "summary": "..." } }
4b. On failure:  POST .../agentic-recommendations/{id}/mark-failed body: { "revision": "<from step 2>", "executionResult": { "status": "FAILURE", "summary": "...", "error": "..." } }
```

**Always use the `revision` from the previous API response** — never reuse a stale revision.

### Merchant rejects

```
POST .../agentic-recommendations/{id}/reject
body: {
  "revision": "<current>",
  "reason": "<merchant's reason>",
  "permanent": false
}
```

Set `permanent: true` only if the merchant explicitly says they never want this type of recommendation again (e.g., "I never want free shipping suggestions").

### Merchant wants modifications

```
PATCH .../agentic-recommendations/{id}
body: {
  "agenticRecommendation": {
    "id": "<id>",
    "revision": "<current>",
    "advice": { <updated advice object> }
  },
  "fieldMask": { "paths": ["advice"] }
}
```

The recommendation stays PROPOSED — re-present the modified version to the merchant.

### Error recovery

| Error | Recovery |
|---|---|
| `VERSION_MISMATCH` | Query to get the latest revision, retry the operation |
| `INVALID_STATE_TRANSITION` | Query to see current state, adjust the flow accordingly |
| `RECOMMENDATION_SUPPRESSED` | This action type was permanently rejected. Do not retry — inform the merchant |
| `RECOMMENDATION_NOT_FOUND` | The recommendation was deleted. Create a new one if needed |

---

## Rules

- **Every recommendation must be persisted (Phase 2) before presenting to the merchant**
- **Every merchant action must update the tracking state (Phase 3)**
- **Never skip the EXECUTING state** — always call MarkExecuting before applying a change
- **Always use the latest revision** from the previous API response
- **Respect rejection history** — never re-propose permanently rejected recommendations
- **Track ALL outcomes** — both success (MarkDone) and failure (MarkFailed)
