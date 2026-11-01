# Events context: `@wix/events/context/event` (part 3 of 3)

This context's reference is split across 3 files: [event.md](event.md), [event-2.md](event-2.md), [event-3.md](event-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event`.

##### `EventContextValue` (continued)

| Property | Type | Description |
| --- | --- | --- |
| `hasImage` | `boolean` | Whether the event has its own main image. When it's `false` and the container found an event, `image` holds a placeholder image. |
| `hasDateAndTime` | `boolean` | Whether the event has a start date that isn't to be announced. |
| `hasShortTeaser` | `boolean` | Whether the event has a short description. |
| `hasAboutTheEvent` | `boolean` | Whether the event's full description has content. |
| `hasSeatingMap` | `boolean` | Whether the event has a seating map that visitors choose seats from. |
| `hasMemberships` | `boolean` | Whether membership plans apply to the event. In an Event By Slug or Event By ID container, it's `true` when plans apply to the event. In the editor, `plans` holds sample plans when none apply, and `hasMemberships` stays `false`. In an Event Item, it comes from the Event List, and `plans` is always empty. |
| `canRegister` | `boolean` | Whether registration for the event is open, so visitors can RSVP, join the waitlist, buy tickets, or register on an external site. |
