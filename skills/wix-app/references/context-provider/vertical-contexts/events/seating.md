# Events context: `@wix/events/context/seating`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/seating`.

### `SeatingContent`

```ts
import { SeatingContent } from '@wix/events/context/seating';
```

- **Parameters:** `__0: SeatingContentProps`
- **Returns:** `Element`

### `useSeatingContext`

Reads the seating map, seat selection, and modal state for the event in the surrounding Event context.

```ts
import { useSeatingContext } from '@wix/events/context/seating';
```

- **Parameters:** none
- **Returns:** `SeatingValue`

#### Returned types

##### `SeatingContentProps`

| Property | Type | Description |
| --- | --- | --- |
| `promise` | `Promise<{ seatingPlan: SeatingPlan \| undefined; placesById: Record<string, PlaceWithTicketInfo>; placesStock: Record<string, PlaceStock>; ticketDefinitions: TicketDefinition$1[]; }>` |  |
| `onRefetch` | `() => void` |  |
| `children` | `ReactNode` |  |

##### `SeatingValue`

| Property | Type | Description |
| --- | --- | --- |
| `modal` | `ModalContextValue` |  |
| `refetchSeatingPlan` | `() => void` |  |
| `seatingPlan` | `SeatingPlan \| undefined` |  |
| `placesById` | `Record<string, PlaceWithTicketInfo>` |  |
| `placesStock` | `Record<string, PlaceStock>` |  |
| `ticketDefinitions` | `TicketDefinition$1[]` |  |
| `selections` | `PlaceSelection[]` |  |
| `checkoutSummary` | `{ ticketCount: number; taxLabel: string; paidPlanDiscountRate: string \| undefined; paymentRequired: boolean; hasSubTotal: boolean; subTotal: string; buyerTotal: string; couponDiscount: string \| undefined; paidPlanDiscount: string \| undefined; tax: string \| undefined; additionalFees: { name: string; amount: string; }[]; addedFee: string \| undefined; includedFee: string \| undefined; giftCards: { code: string \| null \| undefined; amount: string; }[]; }` |  |
| `reserving` | `boolean` |  |
| `donationErrors` | `Record<string, DONATION_ERROR>` |  |
| `emptyBasketError` | `boolean` |  |
| `addPlace` | `({ place, donation, quantity, pricingOptionIds }: AddPlaceParams) => BasketUpdateResult` |  |
| `removePlace` | `(selection: PlaceSelection) => void` |  |
| `changeQuantity` | `(selection: PlaceSelection, count: number) => BasketUpdateResult` |  |
| `changeDonation` | `(selection: PlaceSelection, next: string) => void` |  |
| `validateDonation` | `(selection: PlaceSelection) => void` |  |
| `reserve` | `() => Promise<ReserveResult>` |  |
| `openTicketLimitModal` | `() => void` |  |

##### `SeatingPlan`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string \| null \| undefined` | Seating plan ID. |
| `externalId` | `string \| null \| undefined` | Client-defined external ID for cross-referencing with external systems. Format: `{fqdn}:{entity_guid}`. For example, `wix.events.v1.event:abc-123-def`. |
| `title` | `string \| null \| undefined` | Human-friendly seating plan title. For example, `Madison Square Garden - Main Floor`. |
| `sections` | `Section[] \| undefined` | High-level divisions of the venue, such as "Orchestra", "Balcony", or "VIP Section". A default section with `id = 0` is required and serves as the primary seating area. |
| `categories` | `Category[] \| undefined` | Pricing tiers or groupings for organizing places, such as "VIP", "General Admission", or "Student Discount". Elements and places can be assigned to categories for pricing and availability management. |
| `_createdDate` | `Date \| null \| undefined` | Date and time the seating plan was created. |
| `_updatedDate` | `Date \| null \| undefined` | Date and time the seating plan was updated. |
| `totalCapacity` | `number \| null \| undefined` | Total number of seats across all sections and elements in the seating plan. Automatically calculated by summing element capacities. |
| `totalCategories` | `number \| null \| undefined` | Total number of categories defined in the seating plan. Automatically calculated. |
| `uncategorizedPlaces` | `Place$1[] \| undefined` | Places that are not assigned to any category. These places require manual category assignment for pricing and organization. |
| `version` | `string \| null \| undefined` | Version number of the seating plan, incremented by 1 each time the plan is updated. Used for version management and tracking changes. |
| `extendedFields` | `ExtendedFields$1 \| undefined` | Additional custom fields for extending the seating plan with app-specific data. Learn more about |
| `uiProperties` | `SeatingPlanUiProperties \| undefined` | Visual settings for the seating plan, such as background color and opacity. Used by seating chart interfaces for rendering. |
| `elementGroups` | `ElementGroup[] \| undefined` | Hierarchical groupings of elements for UI organization and bulk operations. Groups can contain multiple elements or nested sub-groups for easier management. |
| `revision` | `string \| null \| undefined` | Optimistic concurrency control; preserved from request, defaults to current plan's revision when absent. |

##### `PlaceSelection`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` |  |
| `placeId` | `string` |  |
| `ticketDefinitionId` | `string` |  |
| `quantity` | `number` | For regular seats: `1`. For areas: counter value. For whole tables: child seat count. |
| `pricingOptionIds` | `string[] \| undefined` | Chosen pricing options — one entry for seats and areas, one per child seat for whole tables. |
| `donation` | `string \| undefined` |  |
