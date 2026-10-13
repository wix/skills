# Feedback: relay the user's building-with-Wix experience to Wix

A small, optional step: send the user's feedback about the experience of building with Wix to Wix,
attributed to the authenticated user. It closes the loop when this skill, the shipped code, the
APIs, the docs or the tooling got in the way. It is not support and not about the user's site
content; it is feedback about building with Wix.

## When to offer it

Sending is always the user's call. Offering is not: default to offering, in plain prose, once per
issue, in any of these cases, and send only after an explicit yes.

- The user asks to send feedback or report something to Wix. Confirm the wording and send.
- The user complains, is frustrated, or reports a Wix bug while you work. Acknowledge, then offer.
- The run hit friction, even once. Friction is anything that cost more turns than it should have,
  whether or not it ended in an error: a confusing error, a doc that was wrong or missing, a seed
  step that failed and had to be re-run, a shipped file that did not cover what the brief needed, a
  playbook line you had to read the source to understand, a contract you had to discover by trial,
  a slow install or a flaky call you retried, a workaround you had to invent, a platform gate the
  brief did not anticipate (a plan restriction, a missing payment method), a step where you were
  unsure what the skill wanted. Offer in the moment: "That tripped us up; want me to send it to Wix
  as feedback?"
- At the close of every run, before the live URL and the dashboard link, run a self-check over the
  whole session. Friction you shrugged off or silently retried past is still signal. If anything
  qualifies, offer before you sign off. Skip the offer only when the run was clean end to end.

When you offer, invite the user to add anything in their own words; it goes into the message
verbatim under "In the user's words". Never send on a single transient error, never without a yes,
never twice for the same issue. When unsure, ask.

## Compose the message

Wix receives free text, so a bare sentence is low signal. Send a summary of the whole run in three
layers, so Wix can triage without chasing you.

**Provenance**, as labelled lines; drop what does not apply, add what helps:

```
Agent / model: <Claude Code / Opus, Cursor, Codex, ...>
Skill: wix-headless-kit <version from .agents/skills/wix-headless-kit/SKILL.md or skills-lock.json> · run kind: <create | connect | attach | iterate | reference mode | migration preview>
Stack: <astro | react | lib | static | port> · verticals: <storefront, blog, ...> · capabilities: <media-upload, site-search, none>
Wix tooling used: <Wix CLI, wix-manage recipes, wix-docs, REST via curl>
Wix products: <Stores, Bookings, Events, Blog, Forms, ...>
Site: <siteId> · public clientId: <appId> · dashboard: <url> · live: <url>
Skill files involved: <templates/<vertical>/seed/seed-<v>.mjs, templates/<vertical>/INSTRUCTIONS.md, install/setup.mjs, ...>
Other ids: <product / service / form / event ids created this run, as relevant>
```

**Narrative:**

- In the user's words: what they added when you offered, verbatim, secrets redacted. Skip when empty.
- User intent and run summary: what they set out to build and the arc of the session in a few
  sentences, what worked and what fought back.
- Conversation and agent flow: a condensed play-by-play, the key exchanges, the scripts and calls
  you ran, what came back, the decisions and course corrections. Distilled, not a transcript.
- Friction points: the heart of it. Every place something got in the way, each with the step or
  endpoint, the status and message, the gap, the workaround and what you expected instead, with a
  minimal repro where there is one. Include the ones you recovered from.

**Attribution**, per significant friction point, your best diagnosis tagged with one of: API
behavior, API schema, API reference docs, docs articles or examples, Wix harness (CLI, auth, hosting),
this skill's shipped code, this skill's playbook, other or unsure; and whether you confirmed it or
are assuming. A wrong route is worse than "unsure".

**Bottom line**: one or two sentences naming the single most important problem and its impact,
worst first, plainly, in a professional register.

Confirm the final wording with the user before sending. Never include secrets (no bearer tokens,
refresh tokens, API keys, credentials) and no personal data beyond what the feedback needs.

## Send it

The call identifies the human account, so it needs a user-scoped bearer from the bare token
command, not the site-scoped one the seeds use (`token --site` carries a metaSiteId and the service
rejects it as anonymous).

```bash
TOKEN=$(npx @wix/cli@latest token)
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/mcp-serverless/v1/headless-feedback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"<composed feedback>"}'
```

- `HTTP_STATUS:200` with `{}`: sent. Tell the user.
- `500` "Unable to determine target user id, anonymous messages are not allowed": the token was
  site-scoped. Re-mint with the bare command and retry once.
- `401` or `403`: the CLI session expired. `npx @wix/cli@latest login` (surface the URL and code to
  the user), re-mint, retry once. If it still fails, show the response and stop.

## Rules

- Offer whenever the run warrants it; send only after an explicit yes.
- One submission per issue; no retries beyond the one named above, no duplicates.
- Specific and factual; wording confirmed first.
- No tokens, secrets, credentials or unnecessary personal data in the message.
- Not for the user's site content and not a support channel.
