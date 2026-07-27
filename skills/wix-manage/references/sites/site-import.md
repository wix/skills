---
name: "Site Import"
description: Drive the Wix Site Import agent to migrate an existing store or site from another platform (Shopify, WooCommerce, Magento, or any URL) into Wix. Use this skill whenever the user wants to import, migrate, or clone a store/site into Wix, mentions moving off Shopify/WooCommerce/Magento, or gives a source store URL and asks to bring it into Wix. Covers starting the import, polling progress, answering the agent's mid-import questions, handling deploy/failure/auth-expiry states, and sending post-deploy follow-up changes.
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

Base URL: `https://www.wixapis.com/site-import`. All calls are scoped to the
signed-in Wix user's account (use the Wix API tool available in this
environment for auth — never handle credentials directly). A full import
typically takes 15–60 minutes.

Example: Start is `POST https://www.wixapis.com/site-import/v1/imports`;
all endpoint paths below are relative to the base URL.

## Calling the API (important — read before your first call)

This API is **deliberately not listed in the public Wix REST documentation**,
so do NOT search the Wix docs / API spec for it — the search will come up
empty every time. That is expected and is NOT a reason to stop, ask the user
for "special permissions", or switch to a different import product. This
skill is the documentation; the endpoints below are real and live.

**Call `ExecuteWixAPI` immediately — no preamble.** Never announce "let me
load Wix tooling", "checking auth", or anything similar before the first
call. The Wix MCP connection is already established; there is nothing to set
up. If Start returns an error, handle it per the Rules section below —
**never probe other endpoints** (e.g. site-properties, site-list) as an auth
check. Those calls reveal nothing useful and create confusion.

With the Wix MCP in Claude, call them through `ExecuteWixAPI` using
`wix.request` with `scope: "account"` and the **full URL**. Cite
`sourceDocUrls: ["user-provided"]` (the user supplied this skill). Set
`hasMutations: true` for Start/Reply/Cancel and `false` for Poll.

In environments with a different Wix connector (e.g. ChatGPT), use its
account-level API tool the same way — the `ManageWixSite` tool accepts
`{method, url, body}` with the full URL directly.

Platform quirk: if the chat UI shows a rendering error like *"Failed to load
MCP app: HTML exceeds the maximum supported size"*, that is the connector's
optional visual widget failing to display — NOT the API call. If the tool
result contains the JSON, the call succeeded: continue normally and never
report it to the user as a failure.

**Every call goes through that tool, from your side of the conversation.**
Never call this API from an artifact, a web page, or any browser/client-side
code — those run in a sandboxed frame and fail with CORS. Do not build
monitoring dashboards, status widgets, or any UI for this flow: the entire
experience is plain chat — tool calls plus short messages. If an approach
fails, quietly switch to plain tool-call polling; never present the user a
menu of technical workarounds.

Example — Start:

```js
async () => {
  return await wix.request({
    scope: "account",
    method: "POST",
    url: "https://www.wixapis.com/site-import/v1/imports",
    body: { request: "Import https://example-store.com into a new Wix site" },
  });
}
```

Example — Poll:

```js
async () => {
  return await wix.request({
    scope: "account",
    method: "GET",
    url: "https://www.wixapis.com/site-import/v1/imports/<importId>?includeRecentActivity=true",
  });
}
```

Example — Poll fetching a review document (add `artifactIds`):

```js
async () => {
  return await wix.request({
    scope: "account",
    method: "GET",
    url: "https://www.wixapis.com/site-import/v1/imports/<importId>?includeRecentActivity=true&artifactIds=mapping-summary,mapping-plan",
  });
}
```

## Scope — this skill drives the import service, nothing else

While an import is the task at hand, ALL site-creation work goes through this
API. Never fall back to other site-building tools (site-builder/template/AI
site-generation tools from your Wix connector) to "compensate" — not when the
import is slow, and especially not when it FAILS.

**Status comes ONLY from this API's Poll endpoint.** Never call
`WixSiteBuilder`, `CreateSiteFromTemplate`, `pullSiteCreationJob`, or any
other connector tool to "check on the build" — `WixSiteBuilder` in particular
STARTS a new site build on every call, even when the prompt asks for status;
"checking" with it silently creates sites the user never asked for. A failed import ends with a
clear failure report and a full stop; the user must never discover a
different site in their account that they didn't ask for. If an alternative
(e.g. building an original site instead of importing) makes sense, propose it
AFTER reporting the failure and act only on the user's explicit yes. If you
already know the import agent refused the source (see `message`), don't
retry the same source with other tools — relay the reason and let the user
decide.

## Before starting an import

This creates real infrastructure and will eventually write to the user's Wix
account. Before calling **Start**, confirm with the user:
- The source URL and platform are correct
- They understand this will run for up to ~60 minutes and may ask them
  questions mid-way

Also confirm before calling **Cancel** — it's a mutating, irreversible action
on a running job.

## What the user sees (presentation rules)

You are the user experience; the API is plumbing. Keep the protocol invisible:

- **Show the `importId` to the user once, right after Start succeeds** — one
  short sentence, e.g. "Your import ID is `abc123` — keep it handy in case
  you need to check back." Never show raw JSON, HTTP status codes, artifact
  ids, or `sourcePlatform`/`sourceConfidence` values.
- **Write for a non-technical audience.** No jargon: no "endpoint", "API",
  "poll", "HTTP", "429", "rate limit", "headers", "JSON", "scraping",
  "session". Translate events into outcomes a shopkeeper understands —
  "the source store limits how fast it can be read, so this step is taking a
  minute" instead of "hit Cloudflare rate limit (HTTP 429)".
- **Monitor autonomously — never ask the user whether to keep monitoring.**
  Once started, poll every ~30 seconds until a terminal status arrives. The
  user does not need to say "keep going" or "check again" — that is the
  default behavior. If the user sends a message about something else, handle
  it and then resume polling. Quiet means low-noise, never uninformed: the
  user should always know what stage their import is in. Match your
  environment:
  - **If you can keep working between user messages** (background polling),
    poll continuously and speak up only on meaningful milestones: the source
    platform is identified, a plan step completes, the agent asks a question,
    the site deploys, or something fails. A short update every few minutes is
    plenty; never narrate each poll ("let me poll again", "retrying") or
    transient errors — retry those silently.
  - **If you can only act while answering a message** (turn-based clients):
    before ending each turn, poll a few times and close with one concrete
    update of what the import is doing right now. On EVERY later user message,
    poll first and answer with current specifics. **Do not end a turn with a
    question asking whether to keep checking** — just keep checking.
- **Status answers must be substantive.** When the user asks how it's going,
  never answer with a bare "still in progress". While the import is running,
  the poll's `message` field is a ready-made plain-language progress line
  ("Now: Importing products (2 of 6 steps done) — Latest update: …") — relay
  it (lightly rephrased is fine), and add anything fresh from `recentActivity`
  / `todos`. If `message` is empty it's still early — say the import is
  setting up and check again on the next message.
- **Never announce or describe the monitoring itself.** No "background monitor
  is live", no feature lists of your polling/alerts/badges — the user asked
  for a site import, not a monitoring product. After the one-sentence start
  message, stay silent until the first milestone.
- **Keep every routine update to 1–3 short sentences.** No headers, no emoji
  walls, no bullet lists for ordinary progress — save structure for the final
  result or a question that needs a decision.
- On start, two short sentences: (1) the import is underway and you'll keep
  them posted, mentioning the detected platform when it helps ("Looks like a
  Shopify store — I'll migrate the catalog accordingly"); (2) share the
  `importId` ("Your import ID is `<id>` — keep it handy."). Never say
  "confidence", "sandbox", "execution", or "session".
- Progress updates come from `recentActivity` `TEXT` entries and the `todos`
  checklist, rephrased in plain language ("setting up your product catalog"),
  never echoed verbatim.
- Ask `NEEDS_INPUT` questions conversationally, as if they were your own.
- On `DEPLOYED`, lead with the live URL, then the agent's closing summary
  **rewritten for a non-technical reader**: what the user got (pages,
  products, look & feel), any honest limitations in plain words ("the buy
  buttons aren't connected to a real checkout yet"), and 2–3 short follow-up
  offers they can answer in one sentence (those become Reply messages). Leave
  out how it was built — frameworks, SDKs, workarounds, and anything from the
  jargon list have no place in the final message either.
- On `FAILED` / `AUTH_EXPIRED` / `SESSION_EXPIRED`, explain what happened and
  what you'll do next in plain words — no codes, no id dumps.
- **A failure is the headline, never a footnote.** The moment a poll returns
  `FAILED`, your very next message leads with that fact and the reason (from
  `message`) — never bury it, never keep talking as if work is ongoing, and
  never paper over it with work done by other tools (see Scope above).

## Endpoints

**There is exactly ONE id in this API: the `importId`, and it never changes.**
Requests and responses carry nothing else — the service resolves everything
from the signed-in user.

1. **Start** — `POST /v1/imports`
   Body: `{"request": "<natural language; MUST include the source store URL>"}`
   Returns: `importId` (keep it — it's the import's id) and detected
   `sourcePlatform`/`sourceConfidence`.

2. **Poll** — `GET /v1/imports/{importId}?includeRecentActivity=true`
   Returns: `status`, `deployUrl`, `message`, `options[]` (only when status is
   `NEEDS_INPUT`), `recentActivity[]`, `recentActivityCount`, `todos[]`,
   `artifacts[]`.
   **Always pass `includeRecentActivity=true`** — you need the activity feed to
   narrate progress, and it is withheld unless asked for.
   To read a review document, add `&artifactIds=mapping-plan,mapping-gaps` (see
   "Review documents" below).

3. **Reply** — `POST /v1/imports/{importId}/reply`
   Body: `{"message": "<answer or follow-up>"}`
   Returns the **SAME `importId`** (it is stable for the import's lifetime) —
   keep polling it. The agent continues the same conversation with full
   context.

4. **Cancel** — `POST /v1/imports/{importId}/cancel`
   Body: `{}`. Only meaningful while status is `IMPORTING`.

## How to run the flow

- After Start, poll every ~30 seconds while `status` is `IMPORTING` —
  quietly, per the presentation rules above: polling is background work, not
  conversation. **Never pause to ask the user whether to keep monitoring —
  just keep going.** If the user sends another message in the meantime, handle
  it, then resume polling. Only stop when a terminal status arrives
  (`DEPLOYED`, `FAILED`, `CANCELLED`) or the user explicitly cancels.
- Track progress from two fields (source material for your milestone updates,
  not a transcript to relay):
  - `recentActivity`: up to 20 entries `{kind, text}`, oldest first —
    `TEXT` entries are the agent's own messages, `TOOL_USE` entries are short
    labels of actions it took. It's a rolling window: track which entries you
    have already covered so an update never repeats them. **Only returned when
    you pass `includeRecentActivity=true`** — `recentActivityCount` tells you
    how many entries were available either way.
  - `todos`: the agent's plan, `{content, status, activeForm}` with status
    `PENDING | IN_PROGRESS | COMPLETED`. Each poll returns the full latest
    snapshot — replace your tracked list, don't append. `activeForm`
    (e.g. "Importing products") describes the in-progress item.
  - Empty `recentActivity`/`todos` in the first polls is normal.
- Act on `status`:
  - `IMPORTING` — keep polling.
  - `NEEDS_INPUT` — the agent is blocked on a decision. The question IS
    `message`; show it (and `options` if present) to the user, collect their
    answer (an option or free text), send it via Reply, then keep polling the
    same `importId`. If `message` says review documents are
    available, read them FIRST (see "Review documents" below) — the decision
    usually depends on what is in them.
  - `DEPLOYED` — terminal success. Deliver `deployUrl` (already verified
    reachable server-side) and `message` per the presentation rules above.
  - `FAILED` — terminal. `message` usually contains the agent's own
    explanation of what happened and what it needs — relay it in plain words.
  - `AUTH_EXPIRED` — recoverable, but **NOT a success and nothing is live**
    (golden rule 1). The user's Wix session expired mid-import. Tell the user
    the secure connection to their account expired and you're restarting the
    import, then call Start again with the same request — work done so far is
    preserved and the import continues.
  - `CANCELLED` — terminal; stopped by Cancel.
- Follow-up changes after a deploy ("make the header blue", "also import the
  blog"): send them via Reply on the import's `importId` — same mechanics as
  answering a question. This works while the import environment is alive
  (~60 minutes idle).
- If Reply returns `409 { "code": "SESSION_EXPIRED" }`, the environment was
  reclaimed and the conversation cannot resume — tell the user and offer to
  start a fresh import.

### Review documents

At the approval gates the agent writes review documents — the mapping plan and
its summary, the gaps list, the execution plan, the completion summary. These
are the substance the user is approving, and **they exist only in the API
response**: the user has no way to open a file.

- Every poll returns `artifacts[]` as a **list of what is available**:
  `{id, title, format, contentBytes}` — with `content` **empty**. This is
  deliberate: the documents are large and most polls don't need them.
- To read one, poll again with `&artifactIds=<id>[,<id>]`. Those come back with
  `content` filled in (Markdown or JSON). Fetch only what you need.
- **When `message` announces review documents, fetch them and tell the user
  what's in them** — summarized in plain language, before asking them to
  approve. Never answer "the plan is in a file I can't read", and never relay
  a filename as something the user should open: fetching it is your job.
- On `DEPLOYED`, the completion summary is available the same way if you want
  detail beyond `message`.

## Rules

- There is a **single** `importId` for the whole import — assigned at Start,
  returned unchanged by Reply, and the only id you ever track.
- Never invent a `deployUrl` — only report the one returned with `DEPLOYED`.
- Treat `NEEDS_INPUT` and `AUTH_EXPIRED` as normal turns of the conversation,
  not errors.
- **Site Import is available to some accounts, not all users yet** (limited,
  gradual rollout). If Start returns a `404` (or any response signalling the
  API is not available for this account) or a `403` with
  `"code": "NOT_ENABLED"`, this account is not in the rollout: tell the user
  plainly that **site import isn't supported on their account yet, and they
  can contact Wix support** to ask about access — then stop. Do not retry, do
  not work around it, and do not fall back to another site-creation tool.
- Any other `403` on Start means the caller is not authorized — tell the user
  plainly and stop. **Never probe other Wix endpoints** (site-properties,
  site-list, or anything else) to "verify auth" — those calls add no
  diagnostic value and just create noise. The Wix MCP connection is either
  working or it isn't; a 403 on Start is its own answer. A `400` means a
  required field is missing (`request`/`message` must be 1–20000 chars).
- **The user cannot open files.** They see only what you tell them. If a
  message mentions a document by filename, that filename is meaningless to
  them — fetch the document with `artifactIds` and read it to them instead
  (see "Review documents" above).
