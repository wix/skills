# Feedback — relay the user's Wix Headless experience to Wix

A tiny, optional capability: send the **user's** feedback about the Wix Headless *building
experience* to Wix. It posts to Wix's internal `#headless-user-feedback` channel, attributed to the
authenticated user. Use it to close the loop when the skill itself, the APIs, the docs, or the
tooling got in the user's way — the signal is how Wix improves the headless flow.

This is **not** support, and not for the user's own site content. It is meta-feedback about *using
Wix Headless*.

## When to offer it (user-approved only — never auto-send)

Sending is always the user's call. Offer once, in plain prose, in any of these situations; send only
after an explicit yes:

- The user **explicitly asks** to send feedback / report something to Wix ("tell Wix that…", "report
  this", "send feedback"). Then just confirm the wording and send.
- The user **complains, is frustrated, or reports a Wix bug** in the course of the work ("this API is
  broken", "the docs are wrong", "why is this so hard"). Acknowledge, then offer to pass it on.
- **The run hit substantial friction** — repeated API failures, wrong/missing docs, a tooling dead
  end, or a workaround you had to invent. When you notice the pattern, offer: *"This tripped us up a
  few times — want me to send it to Wix as headless feedback?"*

Do **not** send on a single transient error, on the user's behalf without a yes, or more than once
for the same issue. When unsure, ask rather than send.

## Compose a useful message

The channel receives only free text plus the user's id, so a bare sentence is low-signal. Send a
**summary of the whole run**, not just the last error — you have the full session context that Wix
does not. Structure it in three layers — **provenance → narrative → attribution** — so Wix can
triage and route without chasing you.

**1. Provenance** — labelled lines, omit any that don't apply:

```
Agent / model: <e.g. Claude Code · Opus, Cursor, … / whatever you are>
Wix tooling used: <MCP tools, Wix CLI, REST via curl, … or other/none>
Platform / products: <headless, Velo, … · storefront, bookings, events, …>
Project type / frontend: <managed | self-managed | stripe | other> · <Astro | …>
Metasite / siteId: <id> · Public clientId (app id): <id>
Links: <any relevant URL helps — dashboard/editor, live or preview site, a docs page you read, a GitHub repo/PR, anything else useful>
Skill area(s): <recipe/file(s) involved, e.g. inline-recipes/setup-bookings.md STEP 5>
Other ids: <service / product / checkout / etc. ids created this run, as relevant>
```

**2. Narrative:**

- **User intent + run summary** — what the user set out to build and the arc of the session in a
  few sentences: what worked cleanly vs. what fought back.
- **Friction points** — the heart of it. Walk the flow and list every place something got in the
  way, each with specifics: the step/endpoint, the HTTP status and error message, the gap, the
  workaround you had to invent, and what you expected instead (minimal repro where there is one).
  Include the ones you recovered from — a silent retry that eventually worked is exactly the
  signal Wix wants.

**3. Attribution** — for each significant friction point, your best diagnosis of where the fault
lives, tagged with one of: **API behavior** (does the wrong thing) · **API schema** (shape/types
wrong or misleading) · **API reference docs** · **docs articles / examples** (missing, wrong, or no
working example) · **Wix harness** (CLI, MCP tools, auth flow…) · **this skill's recipes** ·
**other / unsure** — plus whether you *confirmed* it or are *assuming*. Don't force a tag; a wrong
route is worse than "unsure".

**Bottom line** — one or two sentences naming the single most important problem and its impact.
Lead with what was worst and don't soften it, bury it under what worked, or hedge diplomatically —
but keep a **professional register**: a concise engineering assessment, not a persona, jokes, or
theatrics.

Write it as a scannable few paragraphs or a short bulleted list — thorough on the friction, distilled
from the conversation rather than a raw transcript dump, and professional throughout. Confirm the
final wording with the user before sending. **Never include secrets** — no bearer tokens, refresh
tokens, API keys, or credentials — and no personal data beyond what the feedback needs.

## Send it

This call identifies **you** (the human account), not a site, so it needs a **user-scoped** bearer —
mint it with **no `--site` flag**: `npx @wix/cli@latest token`. Do **not** reuse the
`token --site "$SITE_ID"` bearer that `AUTHENTICATION.md` mints for the content APIs: that token
carries a `metaSiteId` and the feedback service reads it as the site's app/visitor identity, so it
can't resolve a user and rejects the message as anonymous (see the `500` case below). Send **only the
bearer**, **no `wix-site-id` header**. If the CLI isn't logged in yet (e.g. feedback comes up before
any site exists), authenticate first (`AUTHENTICATION.md` §1), then run `token` (no `--site`).

```bash
TOKEN=$(npx @wix/cli@latest token)   # NO --site: user-scoped, or the send is rejected as anonymous
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/mcp-serverless/v1/headless-feedback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"<composed feedback>"}'
```

- **Success = `HTTP_STATUS:200`** with an empty body `{}`. Tell the user it was sent.
- **`500` `"Unable to determine target user id, anonymous messages are not allowed"`** — you sent a
  **site-scoped** token (minted with `--site`). Re-mint **without** `--site`
  (`npx @wix/cli@latest token`) and retry once.
- **`401`/`403`** — the CLI session expired or the token isn't user-identifiable; re-authenticate
  (`AUTHENTICATION.md` §1), re-mint (no `--site`), retry once. If it still fails, surface the response
  and stop — do not loop.

## Hard rules

- ✅ Send only after an explicit user yes — offering is fine, sending unprompted is not.
- ✅ One submission per issue; never spam the channel with retries or duplicates.
- ✅ Compose a specific, factual message; confirm the wording first.
- ❌ Never include tokens, secrets, credentials, or unnecessary personal data in the message.
- ❌ Never use this for the user's site content or as a support channel — it's headless-experience feedback.
