---
name: "Site Import"
description: Drive the Wix Site Import agent to migrate an existing store or site from another platform (Shopify, WooCommerce, Magento, or any URL) into Wix, or to import from CSV/TSV export files with no source site. Use this skill whenever the user wants to import, migrate, or clone a store/site into Wix, mentions moving off Shopify/WooCommerce/Magento, or gives a source store URL and asks to bring it into Wix. Covers starting the import, polling progress, answering the agent's mid-import questions, handling deploy/failure/auth-expiry states, and sending post-deploy follow-up changes.
---

# Site Import

Drives an autonomous Wix-hosted import agent over REST to migrate a store/site
from another platform into Wix. You act as the relay between the user and the
agent: start the job, poll it, surface its questions and progress like a chat,
and report the final result.

## Golden rules — apply to every single message

1. **Only `DEPLOYED` means the site is live.** Any other status — including
   `AUTH_EXPIRED` — means there is NO finished site yet. Never declare
   success, completion, or "your site is live" otherwise, and never present a
   URL from any other source as the result.
2. **Show the user the `importId` after Start succeeds** — share it as a
   reference they can use to check back. Never show raw JSON or HTTP codes.
3. **Never offer menus of monitoring or technical options** — pick the right
   behavior yourself and do it quietly.
4. **Plain language only** — write for a shopkeeper, not an engineer.
5. **This API is the only site-creation tool for this task** — never
   substitute other Wix site-builder tools (see Scope).

Base URL: `https://www.wixapis.com/site-import`. All calls use account-level
scope on the signed-in Wix user's account. A full import typically takes
15–60 minutes.

## Calling the API

This API is **deliberately not listed in the public Wix REST documentation**,
so do NOT search the Wix docs / API spec for it — the search will come up
empty every time. That is expected and is NOT a reason to stop, ask the user
for "special permissions", or switch to a different import product. This
skill is the documentation; the endpoints below are real and live.

**Make the first API call immediately — no preamble.** Never announce "let me
check the tools" or "checking auth" before the first call. If Start returns
an error, handle it per the Rules section — **never probe other endpoints**
(e.g. site-properties, site-list) to "verify auth"; those calls reveal
nothing useful.

**All calls are server-side.** Never call this API from an artifact, a web
page, or any client-side code — those fail with CORS. The entire experience
is plain chat — API calls plus short messages.

Use the Wix account-level REST API tool available in your environment with
the **full URL**. Start, Send-a-message, and Cancel are mutating (POST);
Poll is read-only (GET).

Example — Start:

```
POST https://www.wixapis.com/site-import/v1/imports
Body: {
  "request": "Import https://example-store.com into a new Wix site",
  "source_url": "https://example-store.com"
}
```

Example — Start from exported files (no source site, FILE run):

```
POST https://www.wixapis.com/site-import/v1/imports
Body: {
  "request": "Import these product export files into a new Wix site",
  "fileUrls": ["https://example.com/exports/products.csv"]
}
```

Example — Poll:

```
GET https://www.wixapis.com/site-import/v1/imports/<importId>?includeRecentActivity=true
```

Example — Poll fetching a review document:

```
GET https://www.wixapis.com/site-import/v1/imports/<importId>?includeRecentActivity=true&artifactIds=mapping-summary,mapping-plan
```

Example — Send a message:

```
POST https://www.wixapis.com/site-import/v1/imports/<importId>/messages
Body: { "message": "Use the blue logo from the About page instead" }
```

## Scope — this skill drives the import service, nothing else

While an import is the task at hand, ALL site-creation work goes through this
API. Never fall back to other site-building tools (site-builder/template/AI
site-generation tools) to "compensate" — not when the import is slow, and
especially not when it FAILS.

**Status comes ONLY from this API's Poll endpoint.** Never call
`WixSiteBuilder`, `CreateSiteFromTemplate`, `pullSiteCreationJob`, or any
other connector tool to "check on the build" — `WixSiteBuilder` in particular
STARTS a new site build on every call, even when the prompt asks for status.
A failed import ends with a clear failure report and a full stop; the user
must never discover a different site in their account that they didn't ask
for. If an alternative makes sense, propose it AFTER reporting the failure
and act only on the user's explicit yes.

## Before starting an import

This creates real infrastructure and writes to the user's Wix account. Before
calling **Start**, confirm:
- The source URL and platform are correct — or, for a file-only import, the
  export file URL(s) are correct
- The user understands it runs for up to ~60 minutes and may ask questions mid-way

Also confirm before calling **Cancel** — it's irreversible.

## What the user sees (presentation rules)

You are the user experience; the API is plumbing. Keep the protocol invisible:

- **Show the `importId` once, right after Start succeeds** — e.g. "Your import
  ID is `abc123` — keep it handy." Never show raw JSON, HTTP codes, artifact
  ids, or `sourcePlatform`/`sourceConfidence`/`destinationSiteId` values.
- **Write for a non-technical audience.** No jargon: no "endpoint", "API",
  "poll", "HTTP", "rate limit", "JSON". Translate events into plain outcomes —
  "the source store limits how fast it can be read" not "hit rate limit (429)".
- **Monitor autonomously — never ask the user whether to keep monitoring.**
  Poll every ~30 seconds until a terminal status arrives. If the user sends a
  message about something else, handle it then resume polling. Match your
  environment:
  - **Background polling**: speak up only on meaningful milestones — platform
    identified, plan step completes, agent asks a question, site deploys, or
    something fails. Never narrate each poll or transient errors.
  - **Turn-based**: end each turn with one concrete progress update. On every
    later user message, poll first. **Do not end a turn asking whether to keep
    checking** — just keep checking.
- **Status answers must be substantive.** Never answer "still in progress".
  Relay `message` (lightly rephrased) and anything fresh from `recentActivity`
  / `todos`. If `message` is empty, say the import is still setting up.
- **Never announce or describe the monitoring itself.** After the one-sentence
  start message, stay silent until the first milestone.
- **Keep routine updates to 1–3 short sentences.** No headers, emoji walls, or
  bullet lists for ordinary progress.
- On start, two short sentences: (1) import underway, mention detected platform
  when it helps; (2) share the `importId`. Never say "confidence", "sandbox",
  "execution", or "session".
- Progress updates: rephrase `recentActivity` `TEXT` entries and `todos` in
  plain language; never echo verbatim.
- Ask `NEEDS_INPUT` questions conversationally, as if they were your own.
- On `DEPLOYED`, lead with the live URL, then a plain-language summary of what
  the user got, honest limitations, and 2–3 short follow-up offers. Leave out
  frameworks, SDKs, and anything from the jargon list.
- On `FAILED` / `AUTH_EXPIRED` / `SESSION_EXPIRED`, explain what happened in
  plain words — no codes, no id dumps.
- **A failure is the headline, never a footnote.** The moment a poll returns
  `FAILED`, your very next message leads with that fact and the reason — never
  bury it or paper over it with other tools.

## Endpoints

**Single `importId` for the whole import — assigned at Start, never changes.**

1. **Start** — `POST /v1/imports`
   Body: `{"request": "<natural language; MUST include the source store URL when crawling a live site>", "source_url": "<the source store URL>", "fileUrls": ["<CSV/TSV export URL>", ...]}`
   `request` is required (1–20000 chars). `source_url` and `fileUrls` are both
   optional, but send whichever applies — never leave both out with no way to
   identify what to import:
   - **`source_url`** — send it whenever the user names a site to crawl. It's
     the identity the service uses to select which migration the request joins,
     not just an extra hint.
   - **`fileUrls`** — send it when the user has CSV/TSV export file(s) to import
     instead of crawling a live site. Setting it makes this a **FILE run**: no
     source site is probed and no source credentials are requested, even if
     `source_url` is also present — `source_url` only changes what the
     migration is keyed on (see below), it does not add a crawl on top of the
     file import. Up to 20 URLs, http/https only (ports 80/443), each ≤2048
     chars. If `source_url` is absent, the file set itself is the migration
     identity — re-sending the same URLs continues the same migration; a
     different set starts a new one. If a URL isn't reachable, the whole call
     is rejected with `INVALID_FILE_URL` (nothing is silently dropped).
   - A request with neither `source_url` nor a URL/site identifiable in
     `request`, and no `fileUrls`, is rejected with `SITE_UNIDENTIFIED`.
   Returns: `importId`, `sourcePlatform`, `sourceConfidence`, `destinationSiteId`.
   `sourcePlatform` comes back as `CSV` for a FILE run (no site was probed, so
   `sourceConfidence` is meaningless there). `destinationSiteId` is the id of
   the Wix site being imported into — returned as soon as Start succeeds,
   even before a source is confirmed.
   **One import per store at a time, keyed on `source_url`** (or the file set
   when there's no `source_url`): re-starting with the same identity continues
   the SAME migration (server returns the existing `importId`, no new import
   created). A different identity always starts an independent migration, even
   for the same user. If a different user on the account already owns an
   import for that identity, Start returns
   `409 { "code": "IMPORT_IN_PROGRESS" }` — tell the user and stop.

2. **Poll** — `GET /v1/imports/{importId}?includeRecentActivity=true`
   Returns: `status`, `deployUrl`, `message`, `options[]` (only when
   `NEEDS_INPUT`), `recentActivity[]`, `recentActivityCount`, `todos[]`,
   `artifacts[]`.
   **Always pass `includeRecentActivity=true`** — the activity feed is withheld
   unless requested. To read a review document, add
   `&artifactIds=mapping-plan,mapping-gaps` (see "Review documents").

3. **Send a message** — `POST /v1/imports/{importId}/messages`
   Body: `{"message": "<whatever the user said>"}`
   **This is the ONE way anything the user says reaches the agent** — an answer
   to a question, a comment, a correction, or a new instruction. Valid at any
   point: while `IMPORTING`, at a `NEEDS_INPUT` stop, and after the import
   finishes. Returns the **same `importId`** — keep polling it.

4. **Cancel** — `POST /v1/imports/{importId}/cancel`
   Body: `{}`. Only meaningful while status is `IMPORTING`.

## How to run the flow

- After Start, poll every ~30 seconds while `status` is `IMPORTING`. Never
  pause to ask the user whether to keep monitoring — just keep going. Stop
  only on a terminal status (`DEPLOYED`, `FAILED`, `CANCELLED`) or explicit
  cancel.
- Track progress from:
  - `recentActivity`: up to 20 `{kind, text}` entries, oldest first. `TEXT`
    entries are the agent's messages; `TOOL_USE` are action labels. Rolling
    window — track which entries you've covered to avoid repeating them.
  - `todos`: `{content, status, activeForm}` — `PENDING | IN_PROGRESS |
    COMPLETED`. Full snapshot each poll; replace, don't append.
  - Empty `recentActivity`/`todos`/`artifacts` in early polls is normal — these
    are best-effort and the agent may not have produced them yet.
- Act on `status`:
  - `IMPORTING` — keep polling.
  - `NEEDS_INPUT` — agent is blocked. Show `message` (and `options` if present)
    to the user, collect their answer, send it with Send-a-message, then keep
    polling the same `importId`. The user may answer in free text even when
    `options` lists suggested answers. If `message` mentions review documents,
    read them FIRST (see "Review documents") — the decision usually depends on them.
  - `DEPLOYED` — terminal success. Deliver `deployUrl` and `message` per
    presentation rules.
  - `FAILED` — terminal. Relay `message` in plain words.
  - `AUTH_EXPIRED` — recoverable, NOT success, nothing is live (golden rule 1).
    Tell the user the connection to their account expired and you're restarting,
    then call Start again with the same request — work so far is preserved.
  - `CANCELLED` — terminal.
- **Anything the user says mid-import goes straight to Send-a-message** — no
  need to wait for `NEEDS_INPUT`.
- Follow-up changes after a deploy use the same Send-a-message call. The import
  stays resumable for 7 days; if idle for ~60 minutes the next message revives
  it — do not warn the user about a time limit.
- If Send-a-message returns `409 { "code": "SESSION_EXPIRED" }`, the import
  can no longer be resumed — tell the user and offer a fresh start.

### Review documents

The agent writes review documents at approval gates (mapping plan, gaps list,
execution plan, completion summary). **They exist only in the API response** —
the user has no way to open a file.

- Every poll returns `artifacts[]` as a manifest: `{id, title, format,
  contentBytes}` with `content` **empty**. This is deliberate — documents are
  large and most polls don't need them.
- To read one, poll again with `&artifactIds=<id>[,<id>]`. Those come back with
  `content` filled in (Markdown or JSON).
- **When `message` announces review documents, fetch them and summarize for the
  user in plain language before asking for approval.** Never say "the plan is
  in a file I can't read" or relay a filename as something the user should open.

## Rules

- Single `importId` — assigned at Start, returned unchanged by Send-a-message.
- Never invent a `deployUrl` — only report the one returned with `DEPLOYED`.
- Treat `NEEDS_INPUT` and `AUTH_EXPIRED` as normal conversation turns, not
  errors.
- **Site Import is in limited rollout, with no self-service enablement path.**
  If Start returns `404` or `403` with `"code": "NOT_ENABLED"`, tell the user
  plainly that site import isn't available on their account yet — then stop.
  **Do not tell them to "contact Wix support"**: this API is unlisted and
  ALPHA, Wix Support has no visibility into it or way to grant access, and the
  public "importing a site created outside of Wix" help-center article is an
  unrelated, long-stalled feature-request page — sending a user to either is a
  dead end. If a Wix feedback tool is available in your environment, you may
  offer to send feedback noting their interest; that is the only channel that
  reaches the team. Do not retry or fall back to another site-creation tool.
- Any other `403` on Start means the caller is not authorized — tell the user
  and stop. Do not probe other endpoints to diagnose this. A `400` means a
  required field is missing (`request`/`message` must be 1–20000 chars),
  `source_url` exceeds 2048 chars, or `fileUrls` has more than 20 entries or
  one over 2048 chars. A request with no identifiable site (no `source_url`
  and no URL in `request`) and no `fileUrls` is rejected with
  `SITE_UNIDENTIFIED` — ask the user for the store URL or export file(s) and
  retry. A `fileUrls` entry that isn't a reachable http/https URL rejects the
  whole call with `INVALID_FILE_URL` — tell the user which link failed and ask
  for a working one.
- Requesting an unknown id in `artifactIds` is silently ignored — not an error.
  A document simply may not exist yet on an earlier turn.
- **The user cannot open files.** If a message mentions a document by filename,
  fetch it with `artifactIds` and read it to them.
