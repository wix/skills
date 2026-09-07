
# Wix Backend API Builder

Creates HTTP endpoints for Wix app projects. Determine the existing runtime
before choosing the directory, handler type, or frontend URL.

## Scope and Runtime Detection

- The CLI selects standalone mode when the project's own `package.json` declares
  `@wix/custom-extensions` in `dependencies` or `devDependencies`. A transitive
  installation under `node_modules` is not enough. Do not infer standalone mode
  from using `wix dev`, `wix build`, or the Wix CLI alone.
- Existing `@wix/astro` apps retain Astro routing. Do not add
  `@wix/custom-extensions`, move routes into `src/endpoints`, change their handler
  imports, or introduce `WIX_SERVER_BASE_PATH` to apply the Studio 2 recipe.
- Wix CLI **headless sites** using Astro retain native Astro endpoints and their
  existing site authentication, browser fetch, and deployment flow. Follow the
  [wix-headless skill](../../wix-headless/SKILL.md) for that host. The app-extension
  client and app-identity guidance below does not replace the headless contract.
  Native Astro route creation does not require the app generator, the standalone
  package minimum, or a CLI upgrade. Non-Astro headless sites keep their own
  framework's routing.

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
| Standalone `@wix/custom-extensions` (Studio 2) | `src/endpoints/hello.ts` | `/hello` | `@wix/custom-extensions/types` |
| `@wix/astro` | `src/pages/api/hello.ts` | `/api/hello` | `astro` |

For standalone projects, assume the default `apiDir: "endpoints"`. Leave `app()`
and existing `.use()` registrations unchanged. HTTP endpoints need no extension
ID, builder, or `.use()` call and do not appear as registered extensions.

The standalone generator requests `@wix/custom-extensions@^0.2.14`, the first
release with default endpoint discovery and the `./types` export. Install any
changed dependencies before validating. If the installed app CLI does not recognize
`HTTP_ENDPOINT`, use `wix schema generate --type HTTP_ENDPOINT` to confirm and
update to a CLI version that supports it. Do not install Astro into a standalone
project merely to satisfy an outdated `APIRoute` import.

## Use Cases

Use HTTP endpoints when you need to:

- Build REST APIs with multiple HTTP methods
- Integrate with external APIs or services
- Handle complex form submissions or file uploads
- Serve dynamic content (images, RSS feeds, personalized data)
- Access runtime data or server-side databases

## File Structure and Naming

### Basic and Nested Endpoints

The path relative to the runtime's endpoint directory determines the route:

| Standalone file | Route | Astro equivalent |
| --- | --- | --- |
| `src/endpoints/hello.ts` | `/hello` | `src/pages/api/hello.ts` → `/api/hello` |
| `src/endpoints/payments/checkout.ts` | `/payments/checkout` | `src/pages/api/payments/checkout.ts` → `/api/payments/checkout` |
| `src/endpoints/users/[id].ts` | `/users/:id` | `src/pages/api/users/[id].ts` → `/api/users/:id` |

## HTTP Methods

Export a named handler for each requested HTTP method. Preserve the generated
`APIRoute` import for the project's runtime. For standalone projects:

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
    return new Response(JSON.stringify({ error: "ID required" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
  }

  // Use id to fetch data
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

  // Use query parameters
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
      return new Response(
        JSON.stringify({ error: "Title and content required" }),
        {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Process data
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
  }
};
```

### Headers

```typescript
const authHeader = request.headers.get("Authorization");
const contentType = request.headers.get("Content-Type");
```

## Response Patterns

Always return a `Response` object with proper status codes and headers:

```typescript
// 200 OK
return new Response(JSON.stringify({ data: result }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

// 201 Created
return new Response(JSON.stringify({ id: newId, ...data }), {
  status: 201,
  headers: { "Content-Type": "application/json" },
});

// 204 No Content (for DELETE)
return new Response(null, { status: 204 });

// 400 Bad Request
return new Response(JSON.stringify({ error: "Invalid input" }), {
  status: 400,
  statusText: "Bad Request",
  headers: { "Content-Type": "application/json" },
});

// 404 Not Found
return new Response(JSON.stringify({ error: "Not found" }), {
  status: 404,
  statusText: "Not Found",
  headers: { "Content-Type": "application/json" },
});

// 500 Internal Server Error
return new Response(JSON.stringify({ error: "Internal server error" }), {
  status: 500,
  statusText: "Internal Server Error",
  headers: { "Content-Type": "application/json" },
});
```

## Frontend Integration

For app extensions, use `httpClient.fetchWithAuth()` from `@wix/essentials`.
Build the URL from the extension module's origin, not the host page's origin.

### Standalone / Studio 2

Studio 2 runs `wix dev` with `--base`, so the request must preserve
`import.meta.env.WIX_SERVER_BASE_PATH`. The standalone runtime defaults this
value to `/` without a configured base, including the normal production build.
Keep this code for both dev and release: guard a missing/empty value and trim
boundary slashes so root deployments do not produce `//hello` or `undefined`.
Do not hardcode the sandbox prefix or add `/api` to a standalone route.

```typescript
import { httpClient } from "@wix/essentials";

const origin = new URL(import.meta.url).origin;
const basePath = (import.meta.env.WIX_SERVER_BASE_PATH ?? "")
  .replace(/^\/+|\/+$/g, "");
const endpointUrl = `${origin}/${basePath ? `${basePath}/` : ""}hello`;

// Inside an event handler or runtime data-loading function:
const res = await httpClient.fetchWithAuth(endpointUrl);
if (!res.ok) {
  throw new Error(`Request failed: ${res.status}`);
}
const data = await res.json();
```

With `--base=/studio-prefix/`, this calls `/studio-prefix/hello`; with `/`, an
empty value, or a missing value, it calls `/hello`. The value is supplied by the
runtime/bundler; do not add a production environment variable for it.

### Astro App Extensions

For a standard Astro app endpoint, use its `/api` route without the standalone
base-path variable. If the existing Astro configuration has its own base path,
preserve that project's URL handling instead of applying the root-only example:

```typescript
import { httpClient } from "@wix/essentials";

const endpointUrl = new URL("/api/hello", import.meta.url).href;
const res = await httpClient.fetchWithAuth(endpointUrl);
```

For either runtime, a POST uses the same endpoint URL with `method: "POST"`, a
JSON body, and `Content-Type: application/json`, provided the route exports POST.

## Identity and Authorization

Endpoints run as the **app**, so this is one of the few places `auth.elevate` is valid — it works only in backend code, never in a site, editor, or dashboard extension. It wraps the SDK method rather than being called around it, so inside a request handler you invoke the wrapper:

```typescript
import { auth } from "@wix/essentials";
import { locations } from "@wix/business-tools";

const elevatedArchive = auth.elevate(locations.archiveLocation);
const archived = await elevatedArchive(locationId); // locationId read from the request
```

**Only create an endpoint for calls that need it.** Settle that with [Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement) *before* adding an endpoint — an endpoint wrapping a call the extension could have made itself is a correctness or privacy bug, not extra indirection, because elevating inside it re-targets a session-resolved call away from the visitor or hands back what the platform deliberately withheld.

**Elevation bypasses Wix's permission check, so the endpoint must re-check the caller itself** — otherwise every caller who can reach it gets the elevated operation, and only `httpClient.fetchWithAuth()` (see [Frontend Integration](#frontend-integration)) sends the caller's identity for the handler to check; a bare `fetch` sends nothing and leaves the endpoint open.

What you can establish depends on the host: a dashboard caller is a Wix user, whose roles already limit them. From a site or editor extension `members.getMyMember()` identifies a logged-in member, but there is **no documented way to prove the caller is the site owner** — a real constraint, not an oversight, so an owner-only operation belongs in a dashboard extension, where the Wix user identity already carries the authority, rather than behind an endpoint reachable from a site extension.

## Validate, Deploy, and Delete

1. Install changed dependencies, typecheck, and run `wix build`.
2. Verify the generated endpoint is actually served: request its expected URL
   on the running dev/preview server and check the HTTP status and response
   body. In Studio 2 include the server base path. Also exercise the component's
   request when a frontend caller was requested.
3. Confirm the URL construction works both with a dev prefix and with no prefix
   for the released app. A successful build or installing a missing type package
   does not prove that a file was discovered as a route. Report any runtime check
   that could not be performed rather than claiming the endpoint works.
4. Follow the host's deployment flow. Studio 2 manages its companion app's
   deployment; for a standalone CLI workflow use the normal build/preview/release
   commands when deployment is requested.

To delete an endpoint, remove its file from the appropriate directory and apply
that change through the same deployment flow. No `.use()` cleanup is needed.

## Backend-API-specific Conventions

- Preserve the generated handler type import for the project's runtime.
- Return `Response` objects with appropriate HTTP status codes and JSON headers.
- Validate input parameters and request bodies.
