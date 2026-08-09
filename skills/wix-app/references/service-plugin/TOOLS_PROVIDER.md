# Tools Provider Service Plugin Reference

## Overview

The Tools Provider SPI lets your app handle tool invocations from the Wix AI assistant. Implement the `runTool` handler — it receives the tool's `methodName` and a JSON `payload`, runs your business logic, and returns a response the AI assistant uses to answer the user.

This is the execution side of the App Tools feature. The declaration side lives in the `APP_TOOLS` extension. See [APP_TOOLS.md](../APP_TOOLS.md) for the full picture.

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on the docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `runTool` | https://dev.wix.com/docs/api-reference/app-management/app-tools/tools-provider-v1/run-tool?apiView=SDK |

## Example: Routing Tool Calls by methodName

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
        // fetch order status...
        return {
          response: {
            status: 'shipped',
            trackingNumber: 'TRACK123'
          }
        };
      }

      default:
        throw new Error(`Unknown tool: ${methodName}`);
    }
  }
});
```

## Key Implementation Notes

1. **Route on `methodName`** — use a `switch` or map to dispatch to the right handler logic
2. **Validate inputs defensively** — `requestSchema` is advisory for the AI assistant; Wix does not validate the payload before calling your handler
3. **Handle all activated tools** — cover every `methodName` with `activated: true` in your `APP_TOOLS` declaration; unhandled names should throw a clear error
4. **Respond quickly** — the AI assistant is waiting; slow responses degrade the user experience
5. **Elevate permissions for Wix API calls** — wrap SDK methods with `auth.elevate` from `@wix/essentials`
