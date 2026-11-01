# Bookings context: `@wix/bookings/context/locations`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/locations`.

### `LocationsContextProvider`

Loads the business locations that host bookable services, checks for services at other locations, and tracks the selected location in the page URL.

```ts
import { LocationsContextProvider } from '@wix/bookings/context/locations';
```

- **Parameters:** `__0: LocationsContextProviderProps`
- **Returns:** `Element`

### `useLocationsContext`

Reads the locations state; throws when no LocationsContextProvider is above.

```ts
import { useLocationsContext } from '@wix/bookings/context/locations';
```

- **Parameters:** none
- **Returns:** `LocationsContextValue`

#### Returned types

##### `LocationsContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `initialLocationId` | `string \| undefined` | Selected on load when the page URL names no location. |
| `children` | `ReactNode` |  |

##### `LocationsContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `locations` | `V2Location[]` |  |
| `locationItems` | `LocationItem[]` |  |
| `selectedLocationId` | `string \| null` |  |
| `selectedLocationIndex` | `number` |  |
| `selectedLocation` | `V2Location \| null` |  |
| `selectedLocationName` | `string \| null` |  |
| `hasOtherLocations` | `boolean` |  |
| `hasMultipleLocations` | `boolean` |  |
| `isLoading` | `boolean` |  |
| `hasError` | `boolean` |  |
| `refetch` | `() => void` |  |
| `selectLocation` | `(locationId: string \| null) => void` |  |

##### `V2Location`

| Property | Type | Description |
| --- | --- | --- |
| `business` | `BusinessLocationOptions \| undefined` | Information about business locations. Required when `type` is `BUSINESS`. |
| `custom` | `CustomLocationOptions \| undefined` | Information about custom locations. Required when `type` is `CUSTOM`. |
| `_id` | `string \| undefined` | Location ID. |
| `type` | `LocationTypeEnumLocationTypeWithLiterals \| undefined` | Location type. Default: `CUSTOM` |
| `calculatedAddress` | `CommonAddress \| undefined` | Location address. Empty for `{"type": "CUSTOMER"}`. |

##### `LocationItem`

| Property | Type | Description |
| --- | --- | --- |
| `locationId` | `string \| null` |  |
| `locationName` | `string \| null` |  |
| `isSelected` | `boolean` |  |
