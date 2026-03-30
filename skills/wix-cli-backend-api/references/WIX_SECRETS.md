# Wix Secrets Manager SDK Reference

Complete reference for securely storing and retrieving API keys, tokens, and credentials.

## Installation

**IMPORTANT**: The `@wix/secrets` package must be installed as a dependency before use.

```bash
npm install @wix/secrets
```

## SDK Methods

| Method Call | Import | TypeScript Signature | Description |
| --- | --- | --- | --- |
| `secrets.getSecret()` | `import { secrets } from '@wix/secrets'` | `(name: string) => Promise<string>` | Retrieve a secret value by name |
| `secrets.listSecretInfo()` | `import { secrets } from '@wix/secrets'` | `() => Promise<ListSecretInfoResponse>` | List metadata about all secrets (names only, not values) |

## Usage Example

Astro API endpoint that retrieves a secret and calls a third-party API:

```typescript
import type { APIRoute } from "astro";
import { secrets } from "@wix/secrets";

export const POST: APIRoute = async ({ request }) => {
  const { prompt } = await request.json();

  const apiKey = await secrets.getSecret("OPENAI_API_KEY");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
```

## CRITICAL RULES

1. **NEVER hardcode API keys, tokens, or credentials in any generated code.**
2. **Secrets can ONLY be accessed in backend code** (server-side endpoints, service plugins, backend events) — NOT in frontend code, site widgets, or embedded scripts.
3. **Site owners must manually store secrets** via the Secrets Manager dashboard before the app functions.

## Manual Action Item Template

When generating code that uses secrets, ALWAYS include this manual action item:

> **Store API secrets in the Wix Secrets Manager:**
> 1. In your Wix dashboard, go to Settings > Secrets Manager
> 2. Click "Store a New Secret"
> 3. Set the secret name to exactly: `SECRET_NAME_HERE`
> 4. Paste your API key/token as the value
> 5. Click "Save"
>
> The app will not function until this secret is stored.

## Secrets vs Dynamic Parameters

| Data Type | Use | Reason |
| --- | --- | --- |
| API keys, auth tokens, passwords | `@wix/secrets` | Sensitive, must not be exposed client-side |
| Tracking IDs (Google Analytics, Pixel) | Dynamic parameters | Non-sensitive, needed client-side |
| Public app IDs (Intercom, chat widgets) | Dynamic parameters | Non-sensitive, needed client-side |
| Webhook URLs | Dynamic parameters or secrets | Depends on sensitivity |
| Database connection strings | `@wix/secrets` | Sensitive credentials |

## Permissions

| Operation | Required Scope |
| --- | --- |
| `getSecret`, `listSecretInfo` | `SCOPE.DC-APPS.MANAGE-SECRETS` |
