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
does not. Structure it as:

- **Run summary** — the arc of the session in a few sentences: what the user set out to build
  (goal + capabilities: storefront, bookings, events, blog…), the project type, and how it went
  end to end (what worked cleanly vs. what fought back).
- **Friction points** — the heart of it. Walk the flow and list every place the skill, an API, the
  docs, or the tooling got in the way, each with specifics: the step/endpoint, the HTTP status and
  error message, the doc/tooling gap, and any workaround you had to invent. Include the ones you
  recovered from — a silent retry that eventually worked is exactly the signal Wix wants.
- **What was expected** — and a minimal repro where there is one.
- **Context** — `siteId`/metasite and public `clientId` when relevant, and the skill area(s).
- **The rant** — end with a short, candid, first-person take: in your own words as the agent that
  just did the work, say what was actually painful, confusing, or dumb about the experience. Don't
  sanitize it into corporate neutral — be blunt about the rough edges (a doc that lied, an endpoint
  that fails silently, a flow that took five tries). The honest, unvarnished voice is the point; it's
  the signal a tidy bug report loses. Stay factual and specific even while ranting — no secrets, no
  personal attacks, just the real friction told straight.

Aim for a scannable few paragraphs or a short bulleted list — thorough on the friction, but distilled
from the conversation, not a raw transcript dump. Keep it grounded in specifics. Confirm the final wording with the
user before sending. **Never include secrets** — no bearer tokens, refresh tokens, API keys, or
credentials — and no personal data beyond what the feedback needs.

## Send it

Reuse the authenticated session's bearer — the same `$TOKEN` minted per the project type's
`<TYPE_DIR>/AUTHENTICATION.md` (for `managed`, `npx @wix/cli@latest token --site "$SITE_ID"`). This
call is **not** site-scoped: send only the bearer, **no `wix-site-id` header**. If no token is in
hand yet (e.g. feedback comes up before any site exists), ensure an authenticated CLI session first
(`AUTHENTICATION.md` §1), then mint a token.

```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/mcp-serverless/v1/headless-feedback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"<composed feedback>"}'
```

- **Success = `HTTP_STATUS:200`** with an empty body `{}`. Tell the user it was sent.
- **`401`/`403`** — the CLI session expired or the token isn't user-identifiable; re-authenticate
  (`AUTHENTICATION.md` §1), re-mint, retry once. If it still fails, surface the response and stop —
  do not loop.

## Hard rules

- ✅ Send only after an explicit user yes — offering is fine, sending unprompted is not.
- ✅ One submission per issue; never spam the channel with retries or duplicates.
- ✅ Compose a specific, factual message; confirm the wording first.
- ❌ Never include tokens, secrets, credentials, or unnecessary personal data in the message.
- ❌ Never use this for the user's site content or as a support channel — it's headless-experience feedback.
