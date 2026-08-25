
# Wix Backend API Builder

Creates HTTP endpoints for Wix CLI applications — server-side routes that handle HTTP requests, process data, and return responses. HTTP endpoints are powered by Astro endpoints and are automatically discovered from the file system.

**Key facts:**

- Files live in `src/pages/api/` with `.ts` extension
- Cannot be added via `npm run generate` — create files directly
- Don't appear on the Extensions page in the app dashboard
- No extension registration needed (auto-discovered)
- Replace the legacy "HTTP functions" from the previous Wix CLI for Apps

## Use Cases

Use HTTP endpoints when you need to:

- Build REST APIs with multiple HTTP methods
- Integrate with external APIs or services
- Handle complex form submissions or file uploads
- Serve dynamic content (images, RSS feeds, personalized data)
- Access runtime data or server-side databases

## File Structure and Naming

### Basic Endpoint

File path determines the endpoint URL:

```
src/pages/api/<your-endpoint-name>.ts
```

### Dynamic Routes

Use square brackets for dynamic parameters:

```
src/pages/api/users/[id].ts → /api/users/:id
src/pages/api/posts/[slug].ts → /api/posts/:slug
src/pages/api/users/[userId]/posts/[postId].ts → /api/users/:userId/posts/:postId
```

## HTTP Methods

Export named functions for each HTTP method. Type with `APIRoute` from `astro`. Each handler receives a `request` object and returns a `Response`:

```typescript
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request }) => {
  console.log("Log from GET."); // This message logs to your CLI.
  return new Response("Response from GET."); // This response is visible in the browser console
};

export const POST: APIRoute = async ({ request }) => {
  const data = await request.json();
  console.log("Log POST with body: ", data); // This message logs to your CLI.
  return new Response(JSON.stringify(data)); // This response is visible in the browser console.
};
```

## Request Handling

### Path Parameters

```typescript
export const GET: APIRoute = async ({ params }) => {
  const { id } = params; // From /api/users/[id]

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

Call HTTP endpoints from frontend components using Wix's built-in HTTP client (`httpClient.fetchWithAuth()`):

```typescript
import { httpClient } from "@wix/essentials";

// GET request
const baseApiUrl = new URL(import.meta.url).origin;
const res = await httpClient.fetchWithAuth(
  `${baseApiUrl}/api/<your-endpoint-name>`,
);
const data = await res.text();

// POST request
const res = await httpClient.fetchWithAuth(
  `${baseApiUrl}/api/<your-endpoint-name>`,
  {
    method: "POST",
    body: JSON.stringify({ message: "Hello from frontend" }),
  },
);
const data = await res.json();
```

## Identity and Authorization

Endpoints run as the **app**, so this is one of the few places `auth.elevate` is valid — it works only in backend code, never in a site, editor, or dashboard extension.

```typescript
import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { locations } from "@wix/business-tools";

export const POST: APIRoute = async ({ request }) => {
  const { locationId } = await request.json();
  if (!locationId) {
    return new Response(JSON.stringify({ error: "locationId required" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
  }

  const elevatedArchive = auth.elevate(locations.archiveLocation);
  const archived = await elevatedArchive(locationId);

  return new Response(JSON.stringify(archived), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
```

**Only create an endpoint for calls that need it.** Settle that with [Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement) *before* adding a file under `src/pages/api/` — an endpoint wrapping a call the extension could have made itself is a correctness or privacy bug, not extra indirection, because elevating inside it re-targets a session-resolved call away from the visitor or hands back what the platform deliberately withheld.

**Elevation bypasses Wix's permission check, so the endpoint must re-check the caller itself.** An unguarded endpoint gives every caller who can reach it the elevated operation. `httpClient.fetchWithAuth()` (see [Frontend Integration](#frontend-integration)) sends the caller's identity with the request, so the handler has something to check — a bare `fetch` sends nothing and leaves the endpoint open.

What you can establish about the caller depends on the host:

| Caller | What the endpoint can verify |
| --- | --- |
| Dashboard extension | A Wix user; roles already limit them, so the elevated call is usually redundant — prefer calling the SDK directly from the page |
| Site or editor extension | A visitor or member. `members.getMyMember()` identifies a logged-in member; there is **no documented way to prove the caller is the site owner** |

That last row is a real constraint, not an oversight. If the operation is owner-only, an endpoint reachable from a site extension is the wrong shape for it — put the operation in a dashboard extension, where the Wix user identity already carries the authority. If it must stay reachable from a site extension, gate it on something you can actually verify and state the residual risk rather than implying a check you haven't made.

### Signals that don't work

Three ways of deciding whether a method needs routing have been tried against the live docs and each fails in a different way. Don't re-derive them:

| Signal | Why it fails |
| --- | --- |
| **The permission scope name** (`Manage …`, `…MANAGE-…`, `…_WRITE`) | Doesn't track identity. `locations.queryLocations` is `SCOPE.DC-MULTILOCATION.READ-LOCATIONS` yet admin-only; `currentCartV2.addLineItemsToCurrentCart` carries `SCOPE.ECOM.MANAGE-ADMIN` yet is visitor-callable and breaks if elevated |
| **The SDK schema line's client prefix** | Which prefix you get depends on which docs channel you read, and the channels disagree on the same method. The machine-readable (`.md`) docs render `wixClientAdmin.…` for *every* method, visitor-callable ones included; the docs-search tooling renders `wixClientApp` or `wixClientMember` for those same methods, and sometimes no prefix at all (`locations.queryLocations`, `locations.listLocations`). A prefix only means something if you know which channel produced it, and in a mixed toolchain you generally don't |
| **A `/member/`, `/my-`, or `/current` REST path segment** | Weak positive hint at best, and only on whole segments — `/members/v1/members/{id}` is `getMember`, a caller-filtered read, not a caller-owned one. Recall is low: `cartV2.placeOrder` is `/ecom/v2/carts/{cartId}/place-order` and carries no segment despite acting squarely for the visitor |

What does work: sorting by who the call acts for — see [Identity and Elevation Requirement](../SKILL.md#identity-and-elevation-requirement) — plus the method's own page, a minority of which carry a prose authentication note that settles it outright.

## Build, Deploy, and Delete

To take HTTP endpoints to production, build and release your project:

1. Build the project assets using the [`build`](https://dev.wix.com/docs/wix-cli/command-reference/project-commands/build) command.
2. Optionally create preview URLs using the [`preview`](https://dev.wix.com/docs/wix-cli/command-reference/project-commands/preview) command to share with team members for testing.
3. Release your project using the [`release`](https://dev.wix.com/docs/wix-cli/command-reference/project-commands/release) command.

Once released, endpoints are accessible at production URLs and handle live traffic.

To delete an HTTP endpoint, remove the file under `src/pages/api/` and release again.

## Output Structure

```
src/pages/api/
├── users.ts              # /api/users endpoint
├── users/
│   └── [id].ts           # /api/users/:id endpoint
└── posts.ts              # /api/posts endpoint
```

## Backend-API-specific Conventions

- Type all handlers with `APIRoute` from `astro`.
- Always return `Response` objects with `JSON.stringify()` for JSON.
- Use proper HTTP status codes (200, 201, 204, 400, 404, 500).
- Include `Content-Type: application/json` header on JSON responses.
- Include `statusText` in error responses.
- Validate input parameters and request bodies.
