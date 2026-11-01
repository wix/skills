# Bookings context: `@wix/bookings/context/services`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/services`.

### `ServicesContextProvider`

Loads a paged list of bookable services, filtered by the category and location in the page URL or a category-list item, and narrowed by the service and category pickers.

```ts
import { ServicesContextProvider } from '@wix/bookings/context/services';
```

- **Parameters:** `__0: ServicesContextProviderProps`
- **Returns:** `Element`

### `useServicesContext`

Reads the services list state; throws when no ServicesContextProvider is above.

```ts
import { useServicesContext } from '@wix/bookings/context/services';
```

- **Parameters:** none
- **Returns:** `ServicesContextValue`

#### Returned types

##### `ServicesContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `categoryData` | `{ categoryId?: string \| null \| undefined; } \| undefined` |  |
| `limit` | `number \| undefined` |  |
| `servicesPicker` | `ServicesPickerFilter \| undefined` |  |
| `categoriesPicker` | `CategoriesPickerFilter \| undefined` |  |
| `refreshSignal` | `number \| undefined` |  |
| `children` | `ReactNode` |  |

##### `ServicesContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `serviceItems` | `ServiceItem[]` |  |
| `bookingsSettings` | `ExposedBookingsSettings \| null` |  |
| `hasMore` | `boolean` |  |
| `isLoading` | `boolean` |  |
| `hasError` | `boolean` |  |
| `categoryId` | `string \| null` |  |
| `locationId` | `string \| null` |  |
| `loadMore` | `() => Promise<void>` |  |

##### `ServiceItem`

| Property | Type | Description |
| --- | --- | --- |
| `serviceId` | `string \| null` |  |
| `refreshSignal` | `number` |  |
| `service` | `Service$1` |  |
| `masterEvents` | `Event[]` |  |
| `serviceOptionsAndVariants` | `ServiceOptionsAndVariants$1 \| null` | Null when not VARIED, not loaded yet, or failed (a failed refetch keeps the last value). |
| `bookingsSettings` | `ExposedBookingsSettings` |  |
| `servicePageLink` | `Link \| null` | The service page, resolved like every in-app link to it (custom URL structure first). Read by the gallery converter (data-conversions), which has no site services to resolve it itself. Runtime-only: not declared in the manifest, so it is not a bindable field (the full item rides through regardless). Null when the page can't be resolved (no slug, no service page section). |

##### `ExposedBookingsSettings`

| Property | Type | Description |
| --- | --- | --- |
| `displayTimeZonePolicy` | `DisplayTimeZonePolicy` |  |
| `multiServiceAppointmentsEnabled` | `boolean` |  |
