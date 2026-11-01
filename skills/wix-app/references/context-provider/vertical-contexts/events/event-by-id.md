# Events context: `@wix/events/context/event-by-id` (part 1 of 6)

This context's reference is split across 6 files: [event-by-id.md](event-by-id.md), [event-by-id-2.md](event-by-id-2.md), [event-by-id-3.md](event-by-id-3.md), [event-by-id-4.md](event-by-id-4.md), [event-by-id-5.md](event-by-id-5.md), [event-by-id-6.md](event-by-id-6.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event-by-id`.

### `useEventByIdContext`

The Event context provides access to an event's details: its name, description, image, dates, location, links, and registration status, plus its ticket definitions and membership plans. Use it to show event information in a component and to link visitors to the event's page or to registration.

```ts
import { useEventByIdContext } from '@wix/events/context/event-by-id';
```

- **Parameters:** none
- **Returns:** `EventContextValue`

#### Returned types
