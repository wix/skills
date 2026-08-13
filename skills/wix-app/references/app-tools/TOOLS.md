# App Tools Extension Reference

## Overview

The `APP_TOOLS` extension declares the tools your app exposes to the Wix AI assistant. Each tool entry tells the AI assistant what the tool does, what it accepts, and what it returns — so the assistant can discover and invoke it at runtime.

The AI assistant does NOT call these tools directly. It uses the declarations here to understand the tool's purpose and invoke your **Tools Provider service plugin** at runtime. See [TOOLS_PROVIDER.md](../service-plugin/TOOLS_PROVIDER.md) for the runtime handler.

## Registration

Scaffold the extension with the CLI — it creates the `.extension.ts` file and registers it in `src/extensions.ts` automatically:

```bash
wix generate --params '{"extensionType":"APP_TOOLS","name":"my-tools"}'
```

The generated file lives at `src/extensions/backend/app-tools/my-tools/my-tools.extension.ts`. Replace the stub tool with your own:

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
          orderId: { type: 'string', description: 'The order ID to look up.' }
        },
        required: ['orderId']
      },
      responseSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          trackingNumber: { type: 'string' }
        }
      },
      activated: true
    }
  ]
});
```

## `AppToolConfig` Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `methodName` | `string` | Yes | Unique word identifying the tool. Used to route calls in the service plugin handler. 1–30 characters. |
| `description` | `string` | Yes | Natural-language description the AI assistant uses to decide when to invoke this tool. Write it like a prompt: state what the tool does, list the user intents or trigger phrases that should activate it, and describe what it returns. A narrow one-liner reduces relevance matching — prefer 2–4 sentences covering intent, triggers, and output. 10–1000 characters. |
| `requestSchema` | `Record<string, any>` | No | JSON Schema describing the tool's request payload. The AI assistant uses this for context — it is NOT validated by Wix at call time. |
| `responseSchema` | `Record<string, any>` | No | JSON Schema describing the tool's response payload. |
| `activated` | `boolean` | Yes | Only tools with `activated: true` are called by the AI assistant. |

## Important Constraints

- `tools` array: min 1, max 100 tools per extension.
- `methodName` must be unique across all tools in the extension — it is the routing key in the service plugin handler.
- Schemas are advisory for the AI assistant; your handler must still validate inputs defensively.
- Only `activated: true` tools are invoked. Use `activated: false` to temporarily disable a tool without removing it.

## Relationship to the Tools Provider

The `APP_TOOLS` extension is the **declaration** side. The **execution** side is the Tools Provider service plugin registered with `toolsProviderConfig`:

```
APP_TOOLS (declaration)  →  AI assistant discovers & selects a tool
toolsProviderConfig (SPI) →  Wix calls your runTool handler at runtime
```

Both extensions must be registered for the feature to work end-to-end. See [APP_TOOLS.md](../APP_TOOLS.md) for the full picture and [TOOLS_PROVIDER.md](../service-plugin/TOOLS_PROVIDER.md) for the handler implementation.
