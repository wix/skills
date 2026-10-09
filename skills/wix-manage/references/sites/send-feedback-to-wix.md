---
name: "Send Feedback to Wix"
description: Relay the user's feedback about building with Wix — the APIs, docs, recipes, Wix MCP and tooling — to Wix, attributed to the authenticated user. Covers when to offer it, how to compose a message Wix can act on, and the call that sends it. Use when the user asks to report something to Wix, is frustrated with a Wix API or flow, or a recipe's flow fell short. Not a support channel, and not for the user's own site content.
---

# Send Feedback to Wix

Feedback reaches the Wix teams that own the APIs, docs, recipes and tooling.
It is about the experience of building with Wix, not the user's site content,
and it is not support.

## When to offer it

Sending is the user's call; offering is yours. Offer once per issue, in plain
prose, and send only after the user says yes.

- **The user asks** to tell Wix something. Confirm the wording, then send.
- **The user is frustrated** with Wix, or reports a Wix bug. Acknowledge it,
  then offer.
- **The run hit friction**: a call that failed or needed retries, an error that
  didn't explain itself, a doc or recipe that was wrong, missing or ambiguous, a
  workaround you had to invent, a flow that fell back to a worse route.
- **At the end of a run** that hit any of these, even ones you recovered from.

When you offer, invite the user to add their own words. Never send without a
yes, never twice for the same issue, and never for a single transient error.

## Compose the message

Wix receives free text. A bare sentence can't be triaged, so send a summary of
the whole run in four parts.

**Provenance**, as labeled lines; drop the ones that don't apply:

```
Agent / model: <the agent and model you are>
Wix tooling: <Wix MCP, Wix CLI, REST from a shell, ...>
Recipes: <the recipes this run followed>
Wix products and APIs: <Stores, headless drop, Dev Machines, ...>
Site: <metaSiteId> · dashboard: <url> · live: <url>
Other ids: <request ids, upload ids, execution ids>
```

**Narrative**:

- In the user's words: what they added, verbatim. Skip when empty.
- What the user set out to do, and how the run went: what worked and what
  fought back.
- A condensed play-by-play: the key calls, what came back, and the decisions
  you made. Distilled, not a transcript.

**Friction points**, the heart of it. For each: the step or endpoint, the HTTP
status and error text, the request id, what you expected, and what you did
instead. Add your best guess at where the fault lives, from API behavior, API
schema, API docs, docs articles or examples, a recipe, the Wix MCP, Wix
tooling, or unsure, and say whether you confirmed it. "Unsure" beats a wrong
guess.

**Bottom line**: one or two sentences naming the most important problem and
its impact.

Show the user the final wording before sending. Leave out tokens, API keys and
credentials, and any personal data the feedback doesn't need.

## Send it

The call identifies the user, so it takes a user identity: a token from
`npx @wix/cli@latest token`, or account scope in a script. A site-scoped token
is refused as anonymous.

```bash
curl -sS -X POST "https://www.wixapis.com/mcp-serverless/v1/headless-feedback" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"<the composed message>"}'
```

In an `ExecuteWixAPI` script, with the message as one text file in the `files`
param:

```javascript
async function run() {
  return await wix.request({ scope: 'account', method: 'POST',
    url: 'https://www.wixapis.com/mcp-serverless/v1/headless-feedback',
    body: { message: files[0].content } });
}
```

| Response | Meaning |
| --- | --- |
| `200` with `{}` | Sent. Tell the user. |
| `500` "Unable to determine target user id, anonymous messages are not allowed" | The token was site-scoped. Get a user token and send once more. |
| `401` or `403` | The CLI login expired. Run `npx @wix/cli@latest login`, get a new token, and send once more. If it fails again, show the user the response. |
