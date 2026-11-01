# Events context: `@wix/events/context/event-list`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event-list`.

### `useEventListContext`

The Event List context provides access to a list of the site's events and the categories site visitors can filter it by. Use it to show events in a component, filter them by category, and load more events.

```ts
import { useEventListContext } from '@wix/events/context/event-list';
```

- **Parameters:** none
- **Returns:** `EventListContextType`

#### Returned types

##### `EventListContextType`

| Property | Type | Description |
| --- | --- | --- |
| `events` | `EventListItemData[]` | Events in the list, in the order the Event List's settings sort them. It holds the events loaded so far: the first page, plus each page that `loadMore()` adds to the end. By default, the Event List shows upcoming events and events that have started, closest start date first. A category's `select()` replaces the events with that category's first page, and the list is empty until that page loads. In the editor, it holds sample events when the list has no events. |
| `categories` | `EventCategory[]` | Categories that site visitors can filter the list by. The first entry is always the All events entry, whose `id` is `'ALL_EVENTS'`. Selecting it removes the category filter. The other entries are the site's event categories that the Wix user created, up to 100. It holds only the All events entry when the Event List shows a recurring event's other dates, or when the categories fail to load. In the editor, it's empty while the Event List loads its first page. |
| `eventsLimit` | `number` | Number of events that each page loads: the first page, each `loadMore()` call, and each category's `select()`. It's the Event List's **Events per page** setting, from 1 to 20, and 12 by default. |
| `total` | `number` | Number of events that match the Event List's settings and the selected category, including events that aren't loaded yet. It's `0` while a category's events load. In the editor, it's the number of sample events when `events` holds sample events. |
| `isLoading` | `boolean` | Whether events are loading, after a call to `loadMore()` or to a category's `select()`. In the editor, also `true` while the Event List loads its first page. On the site, components render only once the first page has loaded. |
| `hasMore` | `boolean` | Whether more events match than `events` holds, so `loadMore()` can load more. It's `false` while a category's events load, and in the editor when `events` holds sample events. |
| `loadMore` | `() => Promise<void>` | Loads the next page of events and adds them to the end of `events`. The page holds up to `eventsLimit` events from the selected category. When it loads, `hasMore` and `total` update too. `isLoading` is `true` until then. Calling it again while a page loads returns the same promise, so the page loads only once. The call is ignored when `hasMore` is `false`, while a category's events load, and in the editor while the Event List loads or reloads its events. When the page fails to load, `events` doesn't change, and the next call loads the same page again. |

##### `EventListItemData`

| Property | Type | Description |
| --- | --- | --- |
| `event` | `Event$1` | Event, as an event object from the [Events V3 API](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/introduction). It includes the event's details, form, registration, and URL fields. |
| `hasMemberships` | `boolean` | Whether membership plans apply to the event. `false` when the event isn't ticketed, when the site doesn't have the Pricing Plans app, or when the plans fail to load. |
| `detailsPageLink` | `Link \| undefined` | Link to the event's details page, with its `href` and `target`. Where it leads depends on the event: - An event with ticket or RSVP registration, or one that shows its details page: the event's details page, in the same tab, with `target` set to `'_self'`. - An event with external registration that hides its details page: the external registration page, in a new tab, with `target` set to `'_blank'`. - An event with no registration that hides its details button: a link with no `href`. `undefined` when the container found no event, or when the site has no event details page. |

##### `EventCategory`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Category ID. To retrieve or manage the category, use the [Categories API](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/introduction). `'ALL_EVENTS'` for the All events entry, which isn't a category. |
| `name` | `string` | Name of the category. For the All events entry, the text "All events" in the site's language, or in English when the Events app has no translations for that language. |
| `isSelected` | `boolean` | Whether the list is filtered by this category. At first, the All events entry is selected. |
| `select` | `() => Promise<void>` | Filters the list to the events in this category. For the All events entry, removes the category filter. The category filter applies on top of the Event List's settings. Calling it: - Sets `isSelected` to `true` for this entry, and to `false` for the others. - Empties `events`, sets `total` to `0` and `hasMore` to `false`, and sets `isLoading` to `true`. - Discards a page that `loadMore()` is still loading. - Loads the category's first page, of up to `eventsLimit` events, into `events`. The call is ignored when this entry is already selected. Rejects when the events fail to load. On the site, `events` then stays empty, and the entry stays selected. To load its events again, select another entry, and then this one. |
