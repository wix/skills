
# Wix Backend API Builder

Creates HTTP endpoints for Wix app projects. Determine the existing runtime
before choosing the directory, handler type, or frontend URL.

## Scope and Runtime Detection

- The CLI uses the `@wix/custom-extensions` runtime when the project's own
  `package.json` declares that package in `dependencies` or `devDependencies`. A
  transitive installation under `node_modules` is not enough. Do not infer the
  runtime from using `wix dev`, `wix build`, or the Wix CLI alone.
- Existing `@wix/astro` apps retain Astro routing. Do not add
  `@wix/custom-extensions`, move routes into `src/endpoints`, change their handler
  imports, or introduce `WIX_SERVER_BASE_PATH` to apply the other runtime's recipe.

## Generate for the Project Type

```bash
npx wix generate --params '{"extensionType":"HTTP_ENDPOINT","name":"hello"}'
```

Names use lowercase letters, digits, and hyphens; slash-separated names such as
`payments/checkout` create nested routes. Do not include a leading slash or `.ts`.
The generator creates GET/POST stubs; keep only the methods the task needs.

For Wix app projects, the generator preserves the selected runtime:

| Project | Generated file | Route before any server base path | `APIRoute` import |
| --- | --- | --- | --- |
| `@wix/custom-extensions` | `src/endpoints/hello.ts` | `/hello` | `@wix/custom-extensions/types` |
| `@wix/astro` | `src/pages/api/hello.ts` | `/api/hello` | `astro` |

In `@wix/custom-extensions` projects, endpoints live in `src/endpoints` by default and require
`@wix/custom-extensions@^0.2.14`; older releases neither scan that directory by
default nor export `./types`, and the build passes without serving anything. The
generator upgrades the package; when creating the file by hand, upgrade it
yourself. Install changed dependencies before validating. If `app()` in
`src/extensions.ts` passes `apiDir`, that directory (under `src/`) is the one the
runtime scans instead, and the generator does not read it: either remove `apiDir`
to use the default, or move the generated file into `src/<apiDir>`. The route is
`/<name>` either way.

If `wix generate` does not recognize `HTTP_ENDPOINT`, the CLI predates the
generator (added in `@wix/cli` 1.1.243). Update the CLI, or create the file by hand:
put it in the directory from the table above, export the handlers shown in
[HTTP Methods](#http-methods), and import `APIRoute` from
`@wix/custom-extensions/types` or from `astro`, matching the project's runtime. Do
not add `astro` to a `@wix/custom-extensions` project to make an Astro-style import
resolve. No registration step is needed.

## File Structure and Naming

Nested paths are relative to the runtime's endpoint directory:

| `@wix/custom-extensions` file | Route | Astro equivalent |
| --- | --- | --- |
| `src/endpoints/payments/checkout.ts` | `/payments/checkout` | `src/pages/api/payments/checkout.ts` → `/api/payments/checkout` |
| `src/endpoints/users/[id].ts` | `/users/:id` | `src/pages/api/users/[id].ts` → `/api/users/:id` |

## HTTP Methods

Export a named handler for each requested HTTP method. Preserve the generated
`APIRoute` import for the project's runtime. For `@wix/custom-extensions` projects:

```typescript
import type { APIRoute } from "@wix/custom-extensions/types";

export const GET: APIRoute = async () => {
  return Response.json({
    message: "Hello from the backend!",
    timestamp: new Date().toISOString(),
  });
};
```

In an Astro project, use `import type { APIRoute } from "astro"` instead.
The request/response examples below apply to both runtimes.

## Request Handling

### Path Parameters

```typescript
export const GET: APIRoute = async ({ params }) => {
  const { id } = params; // From users/[id].ts in the endpoint directory

  if (!id) {
    return Response.json({ error: "ID required" }, { status: 400 });
  }

  return Response.json({ id });
};
```

### Query Parameters

Use `new URL(request.url).searchParams`:

```typescript
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const search = url.searchParams.get("search");
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  return Response.json({ search, limit, offset });
};
```

### Request Body

Parse JSON body from POST/PUT/PATCH requests:

```typescript
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { title, content } = body;

    if (!title || !content) {
      return Response.json(
        { error: "Title and content required" },
        { status: 400 }
      );
    }

    return Response.json({ title, content });
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
};
```

### Headers

```typescript
const authHeader = request.headers.get("Authorization");
const contentType = request.headers.get("Content-Type");
```

## Response Patterns

Return a `Response` from every handler path. `Response.json(body, { status })`
serializes JSON and sets `Content-Type: application/json` automatically.

| Status | Use |
| --- | --- |
| 200 | Successful read or update (default) |
| 201 | Resource created |
| 204 | Success without a body: `new Response(null, { status: 204 })` |
| 400 | Invalid request |
| 404 | Resource not found |
| 500 | Unexpected server failure; return a generic error |

For example: `Response.json({ error: "Not found" }, { status: 404 })`.

## Frontend Integration

For app extensions, use `httpClient.fetchWithAuth()` from `@wix/essentials`.
Build the URL from the extension module's origin, not the host page's origin.

### `@wix/custom-extensions` Projects

`wix dev` may run with `--base`, so the request must preserve
`import.meta.env.WIX_SERVER_BASE_PATH`. The runtime defaults this value to `/`
without a configured base, including the normal production build.
During dev, the injected value is Vite's resolved base, which already has a
trailing slash even when `--base` omits it. Concatenate the endpoint name
directly, with `/` as a fallback for a missing/empty value.
Do not hardcode the base prefix or add `/api` to a `@wix/custom-extensions` route.

```typescript
import { httpClient } from "@wix/essentials";

const origin = new URL(import.meta.url).origin;
const basePath = import.meta.env.WIX_SERVER_BASE_PATH || "/";
const endpointUrl = `${origin}${basePath}hello`;

// Inside an event handler or runtime data-loading function:
const res = await httpClient.fetchWithAuth(endpointUrl);
if (!res.ok) {
  throw new Error(`Request failed: ${res.status}`);
}
const data = await res.json();
```

Keep the module origin: passing only `${basePath}hello` can resolve against the
hosting site's origin instead of the app server.

### Astro App Extensions

For a standard Astro app endpoint, use its `/api` route without the
`WIX_SERVER_BASE_PATH` variable. If the existing Astro configuration has its own base path,
preserve that project's URL handling instead of applying the root-only example:

```typescript
import { httpClient } from "@wix/essentials";

const endpointUrl = new URL("/api/hello", import.meta.url).href;
const res = await httpClient.fetchWithAuth(endpointUrl);
```

For either runtime, a POST uses the same endpoint URL with `method: "POST"`, a
JSON body, and `Content-Type: application/json`, provided the route exports POST.

## Identity and Authorization

`auth.elevate` works only in backend code. Wrap the SDK method, then invoke
that wrapper inside the request handler:

```typescript
import { auth } from "@wix/essentials";
import { locations } from "@wix/business-tools";

const elevatedArchive = auth.elevate(locations.archiveLocation);
const archived = await elevatedArchive(locationId); // locationId read from the request
```

Before routing SDK calls through an endpoint, apply the
[Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement).
Keep visitor/session-resolved and caller-filtered calls in the frontend: elevation
can change whose data is accessed or expose data the platform withheld.

**Elevation bypasses Wix's permission check.** The endpoint must authorize the
caller before invoking an elevated method. Use `httpClient.fetchWithAuth()` to
send caller identity; a bare `fetch` does not supply that identity. Authentication
alone does not grant permission to perform the operation.

Dashboard callers are Wix users. For site/editor callers, `members.getMyMember()`
identifies a logged-in member but does not prove site ownership. Owner-only
operations belong in a dashboard extension; do not expose them to site visitors
on the assumption that member authentication proves ownership.

## Validate, Deploy, and Delete

1. Install changed dependencies, typecheck, and run `wix build`.
2. If a dev site is configured (`wix dev-site`), run `wix dev` and request the
   URL; also exercise the frontend caller when one was requested. `wix preview`
   uploads a version and exits; it is not a server.
3. When deployment is requested, use the normal build/preview/release commands,
   unless the environment hosting the project manages deployment itself.

To delete an endpoint, remove its file from the appropriate directory and apply
that change through the same deployment flow. No `.use()` cleanup is needed.

If a route 404s, or the file was created by hand, confirm it was discovered: in a
`@wix/custom-extensions` build `grep 'pattern:' dist/server/index.mjs` lists every route (a
dynamic segment prints as `:"id"`); in an Astro build the route string appears
under `dist/`. A missing entry means the file is outside the scanned directory.
