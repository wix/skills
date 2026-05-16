# Wix Admin REST — Conventions

All admin API calls in this skill go directly to the public Wix REST API using a site-scoped admin token from `@wix/cli`. No MCP wrapper.

## Auth

Fetch a session admin token once and reuse it for every call:

```bash
TOKEN=$(npx @wix/cli token --site $SITE_ID)
```

`$SITE_ID` is the `siteId` from `wix.config.json`, passed into every subagent prompt. The token is scoped to that single site; it carries the admin privileges previously supplied by the Wix MCP wrapper. There's no separate login step beyond Wave 0's `npx @wix/cli login` (Wave 0 verifies this is already done).

## Call shape

| Element | Value |
|---|---|
| Base URL | `https://www.wixapis.com` |
| Auth header | `Authorization: Bearer $TOKEN` |
| Content type (POST/PATCH/PUT) | `Content-Type: application/json` |
| Method | Whatever the endpoint requires (`GET`/`POST`/`PATCH`/`PUT`/`DELETE`) |
| Body | A JSON object — shape per the endpoint's docs |

```bash
curl -fsSL -X POST 'https://www.wixapis.com/<path>' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ ... body ... }'
```

Adjust `-X` and drop `-d` (and the content-type header) for `GET`/`DELETE` bodyless calls.

`siteId` lives in the token, not the body — don't add a top-level `siteId` field unless the specific endpoint explicitly requires one (e.g. `apps-installer-service/v1/app-instance/install`, which still echoes it inside `tenant.id`).

## Prose-HTTP shorthand in reference docs

Recipes throughout this skill write calls in a compact prose-HTTP form for readability, e.g.

```
POST /blog/v3/posts/query
body: { "query": { "paging": { "limit": 1 } } }
```

Translate every such block into the full curl shape above before issuing the request. The base URL and `Authorization` / `Content-Type` headers are always implied.

## Tool-not-found recovery — no longer applies

Earlier versions of this skill used the Wix MCP `CallWixSiteAPI` wrapper, which required prefix discovery and tool-schema preloading. Both are gone: every admin call is now a plain HTTPS request, no MCP tool resolution.

If `curl` fails (network error, non-2xx response), surface the error and follow the per-endpoint recovery ladder in the matching recipe — do not retry on `tool not found`-style errors; that failure mode no longer exists.

## Prefer bundled reference docs over external doc reads

Your agent directory includes `.md` reference files with API recipes, call templates, and error handling tailored to your scope. These are your primary source — they document the exact call patterns, body shapes, and edge cases for your use case.

The Wix MCP also exposes documentation tools (`SearchWixRESTDocumentation`, `ReadFullDocsArticle`, `SearchWixSDKDocumentation`, etc.). These are useful when you hit an error or edge case not covered by your reference files. But **prefer your bundled `.md` files first** — each external doc read costs a tool call and 15-30s, and the bundled recipes are already validated for this skill's flows.

**Rule of thumb:** read your reference files → try the documented recipe → only if you get an unexpected error or need an endpoint not covered, fall back to the MCP doc tools.

## Absolute paths — never trust CWD-relative instruction locations

Subagents launched by the orchestrator run with the project directory as CWD (e.g. `/Users/.../headless-projects/chairloom/`), not the skill root. Your instruction file and its sibling references live **inside the skill**, not in your CWD — e.g. the stores instructions live at `<skill-root>/references/stores/INSTRUCTIONS.md`.

**Rule:** every implementer prompt MUST include an `Instruction file (absolute path)` line pointing at the right `INSTRUCTIONS.md`. Read that file and only that path. Then use the absolute paths it lists for sibling references. Never:

- Resolve `references/stores/INSTRUCTIONS.md` against your CWD — it doesn't exist there.
- `Glob **/INSTRUCTIONS.md` or `**/agents/**` to "find" your instructions — that walks the project tree and finds nothing relevant; it's the most expensive failure mode in current runs.
- Walk up from the project directory looking for the skill root — guess wrong and you'll burn minutes globbing.

If your prompt is missing the absolute `Instruction file` line, ask the parent (don't guess). The `wix-headless` skill is responsible for computing and passing this absolute path in every agent-launch prompt (see `references/ORCHESTRATION.md` § "Agent prompt template").
