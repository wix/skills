# Wix Secrets Manager SDK Reference

Complete reference for securely storing and retrieving API keys, tokens, and credentials.

## Installation

**IMPORTANT**: The `@wix/secrets` package must be installed as a dependency before use.

```bash
npm install @wix/secrets
```

## SDK Methods

| Method Call | Import | TypeScript Signature | Description | Required Scope |
| --- | --- | --- | --- | --- |
| `secrets.getSecretValue()` | `import { secrets } from '@wix/secrets'` | `(name: string) => Promise<{ value: string }>` | Retrieve a secret value by name | `SCOPE.VELO.MANAGE_SECRETS` |
| `secrets.listSecretInfo()` | `import { secrets } from '@wix/secrets'` | `() => Promise<{ secrets: Secret[] }>` | List metadata about all secrets (names only, not values) | `SCOPE.VELO.MANAGE_SECRETS` |

## Usage Example

Astro API endpoint that retrieves a secret and calls a third-party API:

```typescript
import type { APIRoute } from "astro";
import { secrets } from "@wix/secrets";

export const POST: APIRoute = async ({ request }) => {
  const { value: apiKey } = await secrets.getSecretValue("MY_API_KEY");

  // Use apiKey to call your third-party service
  const response = await fetch("https://api.example.com/endpoint", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(await request.json()),
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
> 1. In your Wix dashboard, go to [Developer Tools > Secrets Manager](https://www.wix.com/my-account/site-selector/?buttonText=Select%20Site&title=Select%20a%20Site&autoSelectOnSingleSite=true&actionUrl=https:%2F%2Fwww.wix.com%2Fdashboard%2F%7B%7BmetaSiteId%7D%7D%2Fdeveloper-tools/secrets-manager)
> 2. Click "Store a New Secret"
> 3. Set the secret name to exactly: `SECRET_NAME_HERE` _(use the exact name from the generated code, e.g. `MY_API_KEY`)_
> 4. Paste your API key/token as the value
> 5. Click "Save"
>
> The app will not function until this secret is stored.

