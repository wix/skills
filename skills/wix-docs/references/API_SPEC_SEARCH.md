# Structured API-spec search over `curl` (no MCP)

The **markdown** doc pages (`SKILL.md` Lane 1) are great for reading prose and copying examples,
but their inline schemas are huge and unstructured. When you need the **exact request/response
shape, field types, enums, or error codes** — and you don't have the Wix MCP — query the API
spec directly. This is the no-MCP equivalent of the MCP `SearchWixAPISpec` +
`getResourceSchemaByUrl` tools, over one unauthenticated endpoint.

> **Endpoint (unauthenticated, no token):**
> `POST https://mcp.wix.com/api/code-mode/search` — body `{ "code": "<async function() {…}>" }`.
> The function runs in a sandbox with two globals and returns any JSON-serializable value.
> Response envelope: `{ "result": <your return value> }` (or `{ "error": "<message>" }`).

> Internal/undocumented and pre-GA — treat it as best-effort. It responds unauthenticated today;
> the contract could change. For reading a single known page, the `.md` twin / `get-article-content`
> in `SKILL.md` are simpler — reach here when you specifically need the **structured spec**.

## Sandbox globals

- **`lightIndex`** — array of ~364 API resources. Each entry:

  | Field | Meaning |
  |---|---|
  | `name` | Resource display name (e.g. `"Bookings Writer V2"`) |
  | `resourceId` | GUID — pass to `getResourceSchema()` |
  | `docsUrl` | Resource docs page |
  | `menuPath` | Array, e.g. `["business-solutions","bookings","bookings"]` |
  | `methods[]` | `{ operationId, summary, httpMethod, path, publicUrl, publicBaseUrl, description }` |

- **`getResourceSchema(resourceId)`** — returns the **whole resource**:
  `{ object, methods[], webhooks, articles, components, title, description, fqdn, docsUrl }`.
  Each `methods[]` entry carries `operationId`, `httpMethod`, `path`, `publicUrl`, **`requestBody`**,
  **`responses`**, `parameters`, **`errors`**, `permissions`, and more.

> **The whole resource is big (~200 KB+).** The function runs server-side, so **shape the result
> before returning it** — filter to the one method and return only `requestBody`/`responses`/`errors`.
> Never `return await getResourceSchema(id)` wholesale; you'll pull the entire resource into context.

## Request shape

```bash
curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{"code":"<async-function-as-a-JSON-string>"}'
```

The `code` value is a JS `async function() { … }` **serialized as a JSON string** (escape quotes).
Keep the returned payload small.

## Worked examples

**1. Find a method by keyword → its `operationId`, `publicUrl`, `resourceId`:**

```bash
curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{"code":"async function(){ return lightIndex.flatMap(r => r.methods.filter(m => /createBooking$/i.test(m.operationId)).map(m => ({ resource:r.name, resourceId:r.resourceId, op:m.operationId, httpMethod:m.httpMethod, publicUrl:m.publicUrl }))); }"}'
# → [{ resource:"Bookings Writer V2", resourceId:"a52b7ae8-…", op:"…CreateBooking", httpMethod:"post", publicUrl:"https://www.wixapis.com/_api/bookings-service/v2/bookings" }]
```

**2. Pull ONE method's request + response + errors (narrowed — small payload):**

```bash
curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{"code":"async function(){ const r = lightIndex.find(x => x.methods.some(m => /createBooking$/i.test(m.operationId))); const s = await getResourceSchema(r.resourceId); const m = s.methods.find(x => /createBooking$/i.test(x.operationId)); return { publicUrl:m.publicUrl, httpMethod:m.httpMethod, requestBody:m.requestBody, responses:m.responses, errors:m.errors }; }"}'
```

Because it selects one method and returns only what you need, the response stays small even though
the resource is ~200 KB. Return `s.components` too if you need a referenced type (`$ref`) resolved.

**3. List the resources under a vertical (browse by `menuPath`):**

```bash
curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' \
  -H 'Content-Type: application/json' \
  --data-raw '{"code":"async function(){ return lightIndex.filter(r => r.menuPath.includes(\"bookings\")).map(r => ({ name:r.name, methods:r.methods.length, docsUrl:r.docsUrl })); }"}'
```

## When to use this vs. the other lanes

- **Reading / examples / a quick field** → `SKILL.md` Lane 1 (`.md` twin, `get-article-content`, doc-search).
- **Exact structured schema, enums, error codes — and no MCP** → this endpoint.
- **You have the Wix MCP** → prefer `SearchWixAPISpec` → `getResourceSchemaByUrl` (same data, native tool).

Always confirm the endpoint, HTTP verb, and body shape here before writing the call — never guess.
