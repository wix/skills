# App Tools — Overview

App Tools lets your app expose custom tools that the Wix AI assistant can discover and invoke on behalf of site collaborators. It requires **two extensions working together**:

| Extension | What it does | Reference |
| --- | --- | --- |
| `APP_TOOLS` | Declares your tools (names, descriptions, schemas) so the AI assistant knows they exist | [app-tools/TOOLS.md](app-tools/TOOLS.md) |
| `TOOLS_PROVIDER_CONFIG` | The service plugin handler Wix calls at runtime when the AI assistant invokes a tool | [service-plugin/TOOLS_PROVIDER.md](service-plugin/TOOLS_PROVIDER.md) |

## How they connect

```
Developer declares tools in APP_TOOLS
        ↓
AI assistant reads declarations to understand available tools
        ↓
User interacts with Wix AI assistant
        ↓
AI assistant invokes your toolsProvider service plugin (runTool handler)
        ↓
Your handler routes on methodName, runs business logic, returns response
        ↓
AI assistant uses the response to answer the user
```

The `methodName` field is the **linking key**: it must match exactly between the `APP_TOOLS` declaration and the `switch` (or routing map) in your `runTool` handler.

## Quick Start

### Step 1: Scaffold both extensions via the CLI

> **Adding another tool to an existing setup?** Skip this step. Add the new tool entry to your existing `APP_TOOLS` `.extension.ts` file and add a matching `case` to your existing `runTool` handler — no new extensions needed.

Run these two commands once — the CLI generates all files and updates `src/extensions.ts` automatically:

```bash
wix generate --params '{"extensionType":"APP_TOOLS","name":"my-tools"}'
wix generate --params '{"extensionType":"SERVICE_PLUGIN","pluginType":"TOOLS_PROVIDER_CONFIG","name":"my-tools-provider"}'
```

### Step 2: Declare your tools (`APP_TOOLS`)

Open the generated `src/extensions/backend/app-tools/my-tools/my-tools.extension.ts` and replace the stub tool with your own. Read [app-tools/TOOLS.md](app-tools/TOOLS.md) for the full field reference and constraints.

```typescript
import { extensions } from '@wix/astro/builders';

export default extensions.appTools({
  id: '<generated-uuid>',
  name: 'my-tools',
  tools: [
    {
      methodName: 'get-order-status',
      description: 'Returns the current fulfillment status, shipping carrier, and tracking number for a customer order. Use this tool when a collaborator or customer asks where their order is, whether it has shipped, when it will arrive, or needs a tracking number. Requires a valid orderId.',
      requestSchema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' }
        },
        required: ['orderId']
      },
      responseSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' }
        }
      },
      activated: true
    }
  ]
});
```

### Step 3: Implement the runtime handler (`TOOLS_PROVIDER_CONFIG`)

Open the generated `src/extensions/backend/service-plugins/my-tools-provider/my-tools-provider.ts` and implement the `runTool` logic. Read [service-plugin/TOOLS_PROVIDER.md](service-plugin/TOOLS_PROVIDER.md) for the full implementation guide.

```typescript
import { toolsProvider } from '@wix/app-tools/service-plugins';

toolsProvider.provideHandlers({
  runTool: async ({ request, metadata }) => {
    const { methodName, payload } = request;

    switch (methodName) {
      case 'get-order-status': {
        const orderId = payload?.['orderId'];
        if (typeof orderId !== 'string' || !orderId) {
          throw new Error('orderId is required');
        }
        // your logic here
        return { response: { status: 'shipped' } };
      }
      default:
        throw new Error(`Unknown tool: ${methodName}`);
    }
  }
});
```

## Writing Good Descriptions

The `description` field is the primary signal the AI assistant uses to decide whether your tool is relevant to a user's request. A one-liner like `"Returns order status"` works technically but limits relevance matching.

Write descriptions as a short prompt — 2–4 sentences covering:
1. **What it does** — the action and data it returns.
2. **When to use it** — the user intents or phrases that should trigger it (e.g. "where is my order", "has this shipped", "tracking number").
3. **Key inputs** — mention required parameters so the AI knows what to ask for.

```
// narrow — easy to miss
'Returns order status.'

// wide — reliably matched
'Returns the current fulfillment status, shipping carrier, and tracking number for a customer order.
Use this tool when a collaborator or customer asks where their order is, whether it has shipped,
when it will arrive, or needs a tracking number. Requires a valid orderId.'
```

## Checklist

- [ ] Tool declarations filled in the generated `.extension.ts` (replace the stub `myMethod`)
- [ ] Set `activated: true` on every tool you want the AI assistant to invoke (`activated: false` tools are declared but never called)
- [ ] `runTool` handler covers every `methodName` that has `activated: true`
- [ ] Inputs validated defensively (schemas are advisory, not enforced by Wix)
- [ ] Wix API calls wrapped with `auth.elevate` from `@wix/essentials`
- [ ] App built (`wix build`) and released (`wix release`) — changes don't take effect until released

## Important Notes

- The `requestSchema` and `responseSchema` in `APP_TOOLS` are **advisory** — the AI assistant uses them for context. Wix does NOT validate the `payload` against the schema before calling your handler.
- Only tools with `activated: true` are invoked by the AI assistant.
- Both extensions must be registered and the app must be released before the feature is live.
- The `methodName` must be unique within an `APP_TOOLS` extension (1–30 characters).
