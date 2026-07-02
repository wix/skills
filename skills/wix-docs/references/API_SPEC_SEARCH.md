# Structured API-spec search over `curl` (no MCP)

A single `curl` endpoint that runs a JS query over the Wix REST API spec — the no-MCP equivalent of
the MCP `SearchWixAPISpec` / `getResourceSchemaByUrl` tools. It does two jobs:

- **Find / browse** — `lightIndex` is the whole API index (every resource + method with
  `operationId`, `httpMethod`, `menuPath`, `docsUrl`, `publicUrl`). Filter or enumerate it to locate
  methods programmatically — a third find-path alongside semantic search and `.md` browsing (`SKILL.md`).
- **Read the schema** — `getResourceSchemaByUrl(docsUrl)` returns the **exact request/response shape,
  field types, enums, and error codes** for a method (the markdown pages bury these in huge inline
  schemas).

> **Endpoint:** `POST https://mcp.wix.com/api/code-mode/search` — body `{ "code": "<async function() {…}>" }`.
> The `code` is a JS `async function()` that runs in a read-only sandbox and returns any
> JSON-serializable value. Response envelope: `{ "result": <return value> }` (or `{ "error": "<msg>" }`).

> Internal/undocumented and pre-GA — treat it as best-effort; the contract could change. For
> reading a single known page, the `.md` twin in `SKILL.md` is simpler — reach here when you
> specifically need the **structured spec**.

## How to call it

Send the function as the JSON string `code`. Multi-line functions are easiest to send by encoding
with a helper (keeps quotes/newlines valid):

```bash
read -r -d '' CODE <<'JS'
async function() {
  return lightIndex.filter(r => r.menuPath.includes("bookings")).map(r => r.name);
}
JS
curl -sS -X POST 'https://mcp.wix.com/api/code-mode/search' \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg code "$CODE" '{code:$code}')"     # or: python3 -c 'import json,sys;print(json.dumps({"code":sys.stdin.read()}))'
```

A short function can go inline: `--data-raw '{"code":"async function(){ return lightIndex.length; }"}'`.
**Shape the result inside the function and return only what you need** — a whole resource schema is
~200 KB+, so never `return await getResourceSchema(id)` wholesale.

## Sandbox globals

**`lightIndex`** — array of the REST API resources. Each entry:

| Field | Meaning |
|---|---|
| `name` | Resource display name (e.g. `"Products V3"`, `"Bookings Writer V2"`) |
| `resourceId` | Internal handle for `getResourceSchema()` |
| `docsUrl` | Resource docs page |
| `menuPath` | e.g. `["business-solutions","stores","catalog-v3","products-v3"]` |
| `methods[]` | `{ operationId, summary, httpMethod, path, docsUrl, publicUrl, publicBaseUrl, description }` |

**`getResourceSchemaByUrl(docsUrl)`** *(preferred when you have a URL)* and
**`getResourceSchema(resourceId)`** — return the full resource schema:

```
{ title, description, fqdn, docsUrl,
  methods: [ { summary, description, operationId, httpMethod, path, docsUrl,
               publicUrl, publicBaseUrl, requestBody, responses, parameters,
               permissions, queryMethodData, legacyExamples: [ { content: { title, request, response } } ] } ],
  components: { schemas: { …every referenced type… } } }
```

**`articles`** — array of doc articles `{ name, resourceId, docsUrl, menuPath, description }`;
**`getArticleContentByUrl(docsUrl)`** / **`getArticleContent(resourceId)`** — return an article's
full markdown. Articles and resources share the same `menuPath` hierarchy.

### Rules that matter

- **Execute with `method.publicUrl`** — the complete `https://www.wixapis.com/...` URL. `method.path`
  is a *partial* path (omits the gateway prefix like `/stores`) — never build a URL from it, and
  never use `method.servers[0]` (internal hosts).
- **Always return `responses` alongside `requestBody`** when inspecting a method — saves a re-run.
- **`$circular` refs:** schemas reference types as `{ "$circular": "TypeName" }`, resolved via
  `schema.components.schemas["TypeName"]`. Expand only the types you need (see the nested-refs
  example); a full recursive expand can be huge.
- **Filterable/sortable fields:** for query/search methods, `method.queryMethodData.queryFieldsCapabilitiesMap`
  lists which fields accept filters (and their operators) and sorting. A field absent from the map
  is rejected by the API — filter it client-side after fetching a bounded page.
- `getResourceSchemaByUrl` resolves **API method/resource** URLs only — not `/skills/…` or article
  pages (use `getArticleContentByUrl` for those). On a miss, search `lightIndex` by keyword instead
  of retrying the URL.

## Examples

Each is an `async function()` — send it via the wrapper above.

**Find APIs by broad keywords** (when you don't have a docs URL):

```javascript
async function() {
  const words = ["stores", "query", "products"];
  return lightIndex.flatMap(resource =>
    resource.methods
      .filter(method => {
        const haystack = [
          resource.name, resource.docsUrl, resource.menuPath.join("/"),
          method.summary, method.operationId, method.description, method.path, method.docsUrl
        ].join(" ").toLowerCase();
        return words.every(word => haystack.includes(word));
      })
      .map(method => ({
        title: method.summary, resource: resource.name,
        httpMethod: method.httpMethod.toUpperCase(),
        docsUrl: method.docsUrl, publicUrl: method.publicUrl
      }))
  );
}
```

**Inspect one method by exact docs URL** (request + response + query capabilities + curl examples):

```javascript
async function() {
  const methodUrl = "https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products";
  const schema = await getResourceSchemaByUrl(methodUrl);
  const method = schema.methods.find(m => m.docsUrl === methodUrl);
  if (!method) {
    return { message: "No exact method match", methods: schema.methods.map(m => ({ title: m.summary, docsUrl: m.docsUrl, httpMethod: m.httpMethod.toUpperCase(), publicUrl: m.publicUrl })) };
  }
  return {
    title: method.summary,
    publicUrl: method.publicUrl,
    httpMethod: method.httpMethod.toUpperCase(),
    operationId: method.operationId,
    permissions: method.permissions,
    parameters: method.parameters,
    requestBody: method.requestBody,
    responses: method.responses,
    queryFieldsCapabilities: method.queryMethodData?.queryFieldsCapabilitiesMap,
    curlExamples: method.legacyExamples?.map(e => e.content)
  };
}
```

**Inspect a whole resource by its docs URL** (list its methods):

```javascript
async function() {
  const schema = await getResourceSchemaByUrl("https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3");
  return {
    resource: schema.title,
    description: schema.description,
    methods: schema.methods.map(m => ({ title: m.summary, httpMethod: m.httpMethod.toUpperCase(), docsUrl: m.docsUrl, publicUrl: m.publicUrl, operationId: m.operationId }))
  };
}
```

**Resolve one method from a partial docs URL** (when you only have a path fragment):

```javascript
async function() {
  const partial = "stores/catalog-v3/products-v3/query-products";
  const resource = lightIndex.find(r =>
    r.docsUrl.includes(partial) || r.methods.some(m => m.docsUrl?.includes(partial)));
  if (!resource) return "No API resource found for this partial URL";
  const schema = await getResourceSchemaByUrl(resource.methods.find(m => m.docsUrl?.includes(partial))?.docsUrl ?? resource.docsUrl);
  const method = schema.methods.find(m => m.docsUrl?.includes(partial));
  return method
    ? { title: method.summary, publicUrl: method.publicUrl, httpMethod: method.httpMethod.toUpperCase(), requestBody: method.requestBody, responses: method.responses }
    : { message: "Resource found, no exact method", methods: schema.methods.map(m => m.docsUrl) };
}
```

**Expand selected nested `$circular` types** (targeted — resolve only what you need):

```javascript
async function() {
  const methodUrl = "https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products";
  const schema = await getResourceSchemaByUrl(methodUrl);
  const method = schema.methods.find(m => m.docsUrl === methodUrl);
  return {
    requestBody: method.requestBody,
    selectedNestedTypes: {
      product: schema.components.schemas["com.wix.stores.catalog.product.api.v3.Product"],
      cursorPaging: schema.components.schemas["wix.stores.catalog.v3.upstream.wix.common.CursorPaging"]
    }
  };
}
```

**Advanced — bounded recursive expansion** (only when top-level + selected refs aren't enough; keep
depth small, schemas balloon fast):

```javascript
async function() {
  const methodUrl = "https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products";
  const schema = await getResourceSchemaByUrl(methodUrl);
  const method = schema.methods.find(m => m.docsUrl === methodUrl);
  function expand(value, depth = 0, seen = []) {
    if (depth > 3) return value;
    if (Array.isArray(value)) return value.map(v => expand(v, depth, seen));
    if (!value || typeof value !== "object") return value;
    if (value.$circular) {
      const name = value.$circular;
      if (seen.includes(name)) return { $ref: name, circular: true };
      const target = schema.components?.schemas?.[name];
      return target ? { $ref: name, schema: expand(target, depth + 1, seen.concat(name)) } : { $ref: name, missing: true };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, depth, seen)]));
  }
  return { title: method.summary, publicUrl: method.publicUrl, requestBody: expand(method.requestBody), responses: expand(method.responses) };
}
```

## When to use this vs. the other lanes

- **Find by intent / read prose / a quick field** → `SKILL.md` (semantic doc-search, `.md` twin/browse).
- **Enumerate or filter API methods** (browse a vertical, grep across all methods, get `publicUrl`s) → `lightIndex`, here.
- **Exact structured schema, enums, error codes — and no MCP** → `getResourceSchema[ByUrl]`, here.
- **You have the Wix MCP** → prefer `SearchWixAPISpec` → `getResourceSchemaByUrl` (same data, native tool).

Always confirm the endpoint, HTTP verb, and body shape here before writing the call — never guess.
