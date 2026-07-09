# Feedback — relay the user's building-with-Wix experience to Wix

A tiny, optional capability: send the **user's** feedback about the experience of *building with
Wix* to Wix, attributed to the authenticated user. Use it to close the loop when the skill itself,
the APIs, the docs, or the tooling got in the user's way — the signal is how Wix improves the
building flow.

This is **not** support, and not for the user's own site content. It is meta-feedback about
*building with Wix*.

## When to offer it (user-approved only — never auto-send)

Sending is always the user's call. Offer once, in plain prose, in any of these situations; send only
after an explicit yes:

- The user **explicitly asks** to send feedback / report something to Wix ("tell Wix that…", "report
  this", "send feedback"). Then just confirm the wording and send.
- The user **complains, is frustrated, or reports a Wix bug** in the course of the work ("this API is
  broken", "the docs are wrong", "why is this so hard"). Acknowledge, then offer to pass it on.
- **The run hit substantial friction** — repeated API failures, wrong/missing docs, a tooling dead
  end, or a workaround you had to invent. When you notice the pattern, offer: *"This tripped us up a
  few times — want me to send it to Wix as feedback?"*

When you offer, invite the user to add anything in their own words — whatever they give you goes
into the message verbatim, in its own "In the user's words" section.

Do **not** send on a single transient error, on the user's behalf without a yes, or more than once
for the same issue. When unsure, ask rather than send.

## Compose a useful message

Wix receives only free text, so a bare sentence is low-signal. Send a
**summary of the whole run**, not just the last error — you have the full session context that Wix
does not. Structure it in three layers — **provenance → narrative → attribution** — so Wix can
triage and route without chasing you.

**1. Provenance** — labelled lines. A starting point, not a schema: omit lines that don't apply,
add any field or value that would help Wix understand the run:

```
Agent / model: <e.g. Claude Code · Opus, Cursor, … / whatever you are>
Wix tooling used: <MCP tools, Wix CLI, REST via curl, … or other/none>
Platform / hosting: <headless, Velo, Wix-hosted, self-hosted, …>
Wix areas / APIs: <account & site management, CMS, media, auth, … — whatever the run touched>
Wix products: <stores, bookings, events, blog, … or none — plain API work is a valid answer>
Project type / frontend: <managed | self-managed | stripe | other> · <Astro, Next.js, …>
Metasite / siteId: <id> · Public clientId (app id): <id>
Links: <any relevant URL helps — dashboard/editor, live or preview site, a docs page you read, a GitHub repo/PR, anything else useful>
Skill area(s): <recipe/file(s) involved, e.g. inline-recipes/setup-bookings.md STEP 5>
Other ids: <service / product / checkout / etc. ids created this run, as relevant>
```

**2. Narrative:**

- **In the user's words** — anything the user added when you offered, quoted verbatim (redact
  secrets only). Skip the section if they added nothing.
- **User intent + run summary** — what the user set out to build and the arc of the session in a
  few sentences: what worked cleanly vs. what fought back.
- **Conversation & agent flow** — a condensed play-by-play of how the session actually unfolded:
  the key user ↔ agent exchanges, and your own path through them — tool calls made, responses
  received, decisions taken and course-corrections. Distilled, not a transcript dump — enough for
  Wix to replay the flow.
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

This call identifies **you** (the human account), so it needs a **user-scoped** bearer — mint it
with the bare command: `npx @wix/cli@latest token`. The site-scoped bearer `AUTHENTICATION.md`
mints for the content APIs (`token --site …`) carries a `metaSiteId`, so the feedback service
resolves it to the site's app/visitor identity and rejects the send as anonymous (the `500` case
below). Send the bearer alone — the `Authorization` header is the only one this call needs beyond
`Content-Type`. If the CLI isn't logged in yet (e.g. feedback comes up before any site exists),
authenticate first (`AUTHENTICATION.md` §1), then run `token`.

```bash
TOKEN=$(npx @wix/cli@latest token)   # bare token command → user-scoped bearer
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/mcp-serverless/v1/headless-feedback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"<composed feedback>"}'
```

- **Success = `HTTP_STATUS:200`** with an empty body `{}`. Tell the user it was sent.
- **`500` `"Unable to determine target user id, anonymous messages are not allowed"`** — the token
  was site-scoped. Re-mint user-scoped (`npx @wix/cli@latest token`, bare) and retry once.
- **`401`/`403`** — the CLI session expired or the token isn't user-identifiable; re-authenticate
  (`AUTHENTICATION.md` §1), re-mint user-scoped, retry once. If it still fails, surface the response
  and stop — do not loop.

## Hard rules

- ✅ Offer proactively whenever the run warrants it; send only after an explicit user yes.
- ✅ One submission per issue; never spam with retries or duplicates.
- ✅ Compose a specific, factual message; confirm the wording first.
- ❌ Never include tokens, secrets, credentials, or unnecessary personal data in the message.
- ❌ Never use this for the user's site content or as a support channel — it's feedback about the experience of building with Wix.
