# Bookings context: `@wix/bookings/context/service-addons`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/service-addons`.

### `ServiceAddOnsContextProvider`

Loads the add-ons offered for the service in the surrounding ServiceContextProvider, and reads and changes the visitor's picks stored there.

```ts
import { ServiceAddOnsContextProvider } from '@wix/bookings/context/service-addons';
```

- **Parameters:** `__0: ServiceAddOnsContextProviderProps`
- **Returns:** `Element`

### `useServiceAddOnsContext`

Reads the service add-ons state; throws when no ServiceAddOnsContextProvider is above.

```ts
import { useServiceAddOnsContext } from '@wix/bookings/context/service-addons';
```

- **Parameters:** none
- **Returns:** `ServiceAddOnsContextValue`

#### Returned types

##### `ServiceAddOnsContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` |  |

##### `ServiceAddOnsContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `addOnGroups` | `AddOnGroupItem[]` |  |
| `selected` | `AddOn$1[]` | Only picks the catalog offers. |
| `isLoading` | `boolean` |  |
| `hasError` | `boolean` |  |
| `toggleAddOn` | `(addOnId: string) => void` | No-op turning on when its group (the first offering it) is at maxNumberOfAddOns. |
| `setAddOnQuantity` | `(addOnId: string, quantity: number) => void` | Clamped to [0, maxQuantity]; 0 removes it. |

##### `AddOnGroupItem`

| Property | Type | Description |
| --- | --- | --- |
| `groupId` | `string \| null` |  |
| `groupName` | `string \| null` |  |
| `prompt` | `string \| null` |  |
| `maxNumberOfAddOns` | `number \| null` | Max distinct add-ons, not units. |
| `addOns` | `AddOnItem[]` |  |
| `selectedCount` | `number` |  |
| `canSelectMore` | `boolean` |  |

##### `AddOn$1`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` |  |
| `quantity` | `number` |  |
