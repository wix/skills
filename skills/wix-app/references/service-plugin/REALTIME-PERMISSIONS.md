# Realtime Permissions Provider Service Plugin Reference

## Overview

The Realtime Permissions Provider SPI controls who can receive messages on your app's [Wix Realtime](https://dev.wix.com/docs/sdk/core-modules/realtime/realtime/introduction) channels. When a subscriber from another app attempts a cross-app subscription to one of your channels, Wix calls your `checkSubscriberPermissions` handler and waits synchronously for the answer. Without a registered provider, Wix denies all cross-app subscription attempts by default.

This is the only SPI outside eCommerce and Bookings — it belongs to the Realtime module.

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on the docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `checkSubscriberPermissions` | https://dev.wix.com/docs/sdk/core-modules/realtime/extensions/realtime-permissions-provider/check-subscriber-permissions |

The request gives you the `channel` (`name` + optional `resourceId`), the `subscriber` (`type`: `ADMIN` / `MEMBER` / `VISITOR`, and `_id`), and `requestingAppId` (the app attempting the subscription, may be empty). Return `{ read: true }` to allow, `{ read: false }` to deny.

## Example: Allow Members and Admins, Deny Visitors

```typescript
import { realtimePermissionsProvider } from "@wix/realtime/service-plugins";

realtimePermissionsProvider.provideHandlers({
  checkSubscriberPermissions: async (payload) => {
    const { request } = payload;
    const { subscriber, channel } = request;

    if (channel.name === "public-updates") {
      return { read: true };
    }

    return { read: subscriber.type !== "VISITOR" };
  },
});
```

## Key Implementation Notes

1. **The generated stub may include a `write` field — remove it.** `wix generate` for this `pluginType` has been observed scaffolding a response of `{ read: true, write: false }`, but `CheckSubscriberPermissionsResponse` only has `read?: boolean`. Confirm against the installed `@wix/auto_sdk_duplexer_realtime-permissions-provider` types if `tsc` doesn't catch it for you.
2. **Deny with data, not errors** — return `{ read: false }` for normal policy denials. Only throw `InvalidArgumentError` when the request itself is invalid or missing data; any other thrown error, timeout, or unreachable service makes Wix deny the subscription with a 503.
3. **Respond quickly** — the call is synchronous and blocks the subscription attempt; a slow handler delays it, and a non-responsive one causes a 503 denial.
4. **Be consistent** — the same channel, subscriber, and context should always yield the same decision.
5. **No provider means no cross-app access** — until you implement this SPI, all cross-app subscription attempts to your channels are denied by default.
