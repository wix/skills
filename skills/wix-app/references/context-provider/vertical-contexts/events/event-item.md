# Events context: `@wix/events/context/event-item` (part 1 of 3)

This context's reference is split across 3 files: [event-item.md](event-item.md), [event-item-2.md](event-item-2.md), [event-item-3.md](event-item-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event-item`.

### `useEventItemContext`

The Event context provides access to an event's details: its name, description, image, dates, location, links, and registration status, plus its ticket definitions and membership plans. Use it to show event information in a component and to link visitors to the event's page or to registration.

```ts
import { useEventItemContext } from '@wix/events/context/event-item';
```

- **Parameters:** none
- **Returns:** `EventContextValue`

#### Returned types
