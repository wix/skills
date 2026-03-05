---
name: wix-cli-backend-event
description: Create backend event extensions that respond to Wix events. Use when implementing handlers that run when specific conditions occur on a site. Triggers include event extension, backend event, webhook handler, onContactCreated, onOrderPaid, onBookingConfirmed, listen for events, react to changes, event subscription, CRM events, eCommerce events, Bookings events, Blog events.
compatibility: Requires Wix CLI development environment.
---

# Wix CLI Backend Event Extension

Creates event extensions for Wix CLI applications. Events are triggered when specific conditions occur—on a Wix user's site for app projects, or on your project's site for headless projects. Your project responds using event extensions built on JavaScript SDK webhooks; the CLI subscribes your project to these webhooks.

Common use cases: run logic when a contact is created, an order is placed, a booking is confirmed, or a blog post is published.

## Quick Start Checklist

Follow these steps in order when creating an event extension.

1. [ ] Create event folder: `src/backend/events/<event-name>/`
2. [ ] Create `<event-name>.ts` with the SDK event import and handler function
3. [ ] Create `<event-name>.extension.ts` with `extensions.event()` and a unique UUID
4. [ ] Update `src/extensions.ts` to import and use the new extension

**User (manual):** Configure app permissions for the event in the app dashboard if required; release a version and trigger the event to test.

## References

| Topic | Reference |
| --- | --- |
| Common events (CRM, eCommerce, Bookings, Blog) | [COMMON-EVENTS.md](references/COMMON-EVENTS.md) |

## Output Structure

Two files per event ([docs](https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/events/event-extension-files-and-code)). Only **one** handler per event allowed in the app (including dashboard handlers).

```
src/backend/events/<event-name>/
├── <event-name>.extension.ts   # Builder: extensions.event({ id, source }) – id is unique GUID
└── <event-name>.ts             # Handler: imports SDK event (e.g. onContactCreated), runs on trigger
```

## Implementation Pattern

### Event builder (`<event-name>.extension.ts`)

Use `extensions.event()` from `@wix/astro/builders`. Required fields: `id` (unique GUID), `source` (path to the handler file).

```typescript
import { extensions } from "@wix/astro/builders";

export const eventContactCreated = extensions.event({
  id: "{{GENERATE_UUID}}",
  source: "./backend/events/contact-created/contact-created.ts",
});
```

**CRITICAL: UUID Generation**

The `id` must be a unique, static UUID v4 string. Generate a fresh UUID for each extension—do NOT use `randomUUID()` or copy UUIDs from examples. Replace `{{GENERATE_UUID}}` with a freshly generated UUID like `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`.

### Event handler (`<event-name>.ts`)

Import the event from the correct SDK module and pass a handler. Wix invokes the handler with the event payload and metadata when the event occurs. Handler signatures are documented in the [JavaScript SDK reference](https://dev.wix.com/docs/sdk).

```typescript
import { onContactCreated } from "@wix/crm/events";

onContactCreated(async (event) => {
  try {
    const contact = event.entity;
    console.log("Contact created:", contact.info?.name?.first, contact.info?.name?.last);
    // Custom logic: sync to CRM, send welcome email, etc.
  } catch (error) {
    console.error("Failed to handle contact created event:", error);
  }
});
```

Handler can be `async`. Always wrap logic in try/catch — an unhandled exception can prevent the handler from completing, and Wix may retry delivery, causing duplicate processing.

## Extension Registration

**Two steps required.**

### Step 1: Event builder file

Create `<event-name>.extension.ts` inside the event folder (and `<event-name>.ts` for the handler) as shown in [Implementation Pattern](#implementation-pattern) above.

### Step 2: Register in main extensions.ts

**CRITICAL:** Read [wix-cli-extension-registration](../wix-cli-extension-registration/SKILL.md) and add the event extension to `src/extensions.ts` (import and `.use(eventContactCreated)` or equivalent). Without this, the event extension is not active.

Naming: export names follow `event{CamelCaseName}` (e.g. `eventContactCreated`, `eventOrderPaid`).

## Elevating Permissions for API Calls

When calling Wix APIs from inside an event handler, use `auth.elevate` from `@wix/essentials` so the call runs with the right permissions.

```typescript
import { auth } from "@wix/essentials";
import { items } from "@wix/data";

onContactCreated(async (event) => {
  const elevatedQuery = auth.elevate(items.query);
  const result = await elevatedQuery("MyCollection").find();
  // Use result
});
```

## Key Constraints

- **One handler per event** – You cannot have two event extensions for the same event in the app. This limit is global across the entire app, including any dashboard-side handlers.
- **At-least-once delivery** – Wix guarantees events are delivered at least once, but duplicates are possible. Design handlers to be idempotent (e.g., check if a record already exists before inserting).
- **Permissions** – Each event may require specific permission scopes; configure them in the app dashboard (Permissions page).
- **No local dev testing** – Event handlers require a released version to test. See [Testing Event Extensions](#testing-event-extensions) for the full workflow.
- **Backend limits** – Event handlers run under backend extension limits (e.g. 1000 CPU ms per request, 20 sub-requests). See [About Backend Extensions](https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/about-backend-extensions).

## Best Practices

- **Error handling:** Wrap handler logic in try/catch; log and optionally rethrow or report.
- **Idempotency:** Events may be delivered more than once; design handlers to be idempotent where possible.
- **Logging:** Use `console.log` for debugging; keep production logs minimal and non-sensitive.
- **Performance:** Finish within backend limits; offload heavy work to queues or background jobs if needed.

## Testing Event Extensions

Event handlers cannot be tested locally with `wix dev` — they require a released version because Wix needs to route webhooks to your deployed code.

1. **Build and release** a version with your changes (`npx wix build && npx wix release`).
2. **Install the app** on a test site (or update if already installed).
3. **Trigger the event** by performing the relevant action on the site (e.g., create a contact, place an order).
4. **Check logs** in the [Wix Dev Center](https://manage.wix.com/) → your app → Monitoring to verify the handler executed.

**Debugging tips:**
- Add `console.log` statements to confirm handler execution — these appear in the Dev Center monitoring logs.
- If the handler doesn't fire, verify the app has the required permission scopes configured in the app dashboard.
- If the handler fires but fails, check the error in monitoring logs and ensure you're using `auth.elevate()` for any API calls that need elevated permissions.

## Verification

After implementation, use [wix-cli-app-validation](../wix-cli-app-validation/SKILL.md) to validate TypeScript, build, and preview.
