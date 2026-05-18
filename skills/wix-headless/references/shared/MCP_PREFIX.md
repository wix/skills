# Wix Public Documentation Endpoints

This skill performs all site operations via the Wix REST API + `wix token --site <id>`. The Wix MCP server is **not required** by this skill — neither for operations nor for documentation lookups.

When a bundled reference recipe falls short and you need to look something up, Wix exposes a set of **public, unauthenticated REST endpoints** for documentation search and retrieval. The endpoints below are stable and require no auth headers.

> Filename note: this file is named `MCP_PREFIX.md` for historical reasons. Its content is the doc-endpoints reference — no MCP prefix discovery, no MCP tools.

---

## Prefer bundled reference docs over external doc reads

Your agent directory includes `.md` reference files with API recipes, call templates, and error handling tailored to your scope. These are your primary source — they document the exact call patterns, body shapes, and edge cases for your use case.

The endpoints below are useful when you hit an error or edge case not covered by your reference files. But **prefer your bundled `.md` files first** — each external doc read costs a tool call and 15–30 s, and the bundled recipes are already validated for this plugin's flows.

**Rule of thumb:** read your reference files → try the documented recipe → only if you get an unexpected error or need an endpoint not covered, fall back to the docs-search REST endpoints below.

---

## Documentation REST endpoints

All endpoints are public (no auth required). URL-encode query params. Use `curl --get --data-urlencode` to handle encoding correctly.

| Purpose | Endpoint | Required query params |
|---|---|---|
| Search REST API docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search` | `kbName=REST_METHODS_KB_ID`, `kbName=REST_DOCS_KB_ID`, `searchTerm`, `maxResults` |
| Search SDK docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search` | `kbName=API_REFERENCE_SDK_KB_ID`, `kbName=FRONTEND_SDK_AND_EXTENSIONS_KB_ID`, `kbName=REST_DOCS_KB_ID`, `searchTerm`, `maxResults` |
| Search Headless docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search` | `kbName=HEADLESS_KB_ID`, `searchTerm`, `maxResults` |
| Search CLI docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search` | `kbName=CLI_KB_ID`, `searchTerm`, `maxResults` |
| Search WDS docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search` | `kbName=WDS_DOCS_KB_ID`, `searchTerm`, `maxResults` |
| Search Build-Apps docs | `GET https://www.wixapis.com/mcp-docs-search/v1/search` | `kbName=BUILD_APPS_KB_ID`, `searchTerm`, `maxResults` |
| Read full article content | `GET https://dev.wix.com/rawdocs/api/get-article-content` | `articleUrl`, `schema=false` |
| Read article method schema | `GET https://dev.wix.com/rawdocs/api/get-article-content` | `articleUrl`, `schema=true` |
| Browse REST docs menu | `GET https://dev.wix.com/docs/api/v1/get-menu-content` | `url`, `format=markdown` |

Example — search REST docs for `install app instance`, then read the top match's method schema:

```bash
curl -fsSL --get 'https://www.wixapis.com/mcp-docs-search/v1/search' \
  --data-urlencode 'kbName=REST_METHODS_KB_ID' \
  --data-urlencode 'kbName=REST_DOCS_KB_ID' \
  --data-urlencode 'searchTerm=install app instance' \
  --data-urlencode 'maxResults=5'

curl -fsSL --get 'https://dev.wix.com/rawdocs/api/get-article-content' \
  --data-urlencode 'articleUrl=<top-match-url>' \
  --data-urlencode 'schema=true'
```

---

## Absolute paths — never trust CWD-relative instruction locations

Subagents launched by the orchestrator run with the project directory as CWD (e.g. `/Users/.../headless-projects/chairloom/`), not the skill root. Your instruction file and its sibling references live **inside the skill**, not in your CWD — e.g. the stores instructions live at `<skill-root>/references/stores/INSTRUCTIONS.md`.

**Rule:** every implementer prompt MUST include an `Instruction file (absolute path)` line pointing at the right `INSTRUCTIONS.md`. Read that file and only that path. Then use the absolute paths it lists for sibling references. Never:

- Resolve `references/stores/INSTRUCTIONS.md` against your CWD — it doesn't exist there.
- `Glob **/INSTRUCTIONS.md` or `**/agents/**` to "find" your instructions — that walks the project tree and finds nothing relevant; it's the most expensive failure mode in current runs.
- Walk up from the project directory looking for the skill root — guess wrong and you'll burn minutes globbing.

If your prompt is missing the absolute `Instruction file` line, ask the parent (don't guess). The `wix-headless` skill is responsible for computing and passing this absolute path in every agent-launch prompt (see `references/ORCHESTRATION.md` § "Agent prompt template").
