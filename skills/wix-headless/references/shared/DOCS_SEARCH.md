# Wix documentation lookups

Operational calls in this skill use `npx @wix/cli@latest token --site "$SITE_ID"` + `curl` against `wixapis.com` (see `AUTHENTICATION.md`). When a bundled recipe falls short and you need to look up an endpoint, method schema, or article body, use the public unauthenticated REST endpoints below. **No MCP, no SDK** — these are plain `curl` calls.

## Doc search

| Need | Endpoint |
|---|---|
| Search the docs (semantic, natural language) | `POST https://www.wixapis.com/mcp-docs-search/v1/docs/search` — body `{ "search_term": "…", "document_type": "…" }`; append `/docs/search/markdown` for one ready-to-read markdown string |
| Read a page | Append `.md` to any `https://dev.wix.com/docs/…` URL |
| Browse a section | Truncate a docs URL to a parent path + `.md` (a list of child links) |

`document_type`: `REST` (default) · `SDK` · `WIX_HEADLESS` · `BUSINESS_SOLUTIONS` · `VELO` · `WDS` · `BUILD_APPS` · `CLI`. Body also takes `maximum_results` (1–20) and `lines_in_each_result` (1–200).

Example — search REST docs for app install:

```bash
curl -sS -X POST 'https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown' \
  -H 'Content-Type: application/json' \
  --data-raw '{"search_term":"install app instance","document_type":"REST","maximum_results":3}'
```

Example — read a specific page:

```bash
curl -sS 'https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app.md'
```

No auth headers required on these endpoints.

> For the full doc-lookup playbook — semantic-search variants, slicing big method pages, and structured API-spec queries (`getResourceSchemaByUrl`, no MCP) — see the **`wix-docs`** skill (`<SKILL_ROOT>/../wix-docs/SKILL.md` when co-installed).

## Prefer bundled references

Your skill directory includes `.md` reference files with API recipes and error handling for your scope. **Read those first.** Use the doc endpoints above only when you hit an error or endpoint not covered by the bundled recipe — each external doc read costs a tool call and 15–30 s.

## Absolute paths

Subagents run with the **project directory** as CWD, not the skill root. Every dispatch prompt must include `Instruction file (absolute path): <SKILL_ROOT>/references/<scope>/INSTRUCTIONS.md`. Read that path only; use the absolute sibling paths it lists. Never resolve `references/...` against the project CWD.
