# Events context: `@wix/events/context/event` (part 1 of 3)

This context's reference is split across 3 files: [event.md](event.md), [event-2.md](event-2.md), [event-3.md](event-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event`.

### `EventContextProvider`

Supplies an event's details to descendant components through `useEventContext()`.

```ts
import { EventContextProvider } from '@wix/events/context/event';
```

- **Parameters:** `__0: PropsWithChildren<EventContextProviderProps>`
- **Returns:** `Element`

### `useEventContext`

The Event context provides access to an event's details: its name, description, image, dates, location, links, and registration status, plus its ticket definitions and membership plans. Use it to show event information in a component and to link visitors to the event's page or to registration.

```ts
import { useEventContext } from '@wix/events/context/event';
```

- **Parameters:** none
- **Returns:** `EventContextValue`

#### Returned types
