# Bookings context: `@wix/bookings/context/service` (part 3 of 5)

This context's reference is split across 5 files: [service.md](service.md), [service-2.md](service-2.md), [service-3.md](service-3.md), [service-4.md](service-4.md), [service-5.md](service-5.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/service`.

##### `Image`

| Property | Type | Description |
| --- | --- | --- |
| `uri` | `string \| undefined` | The image URI. |
| `url` | `string` |  |
| `name` | `string \| undefined` |  |
| `height` | `number \| undefined` |  |
| `width` | `number \| undefined` |  |
| `animated` | `boolean \| undefined` |  |
| `crop` | `Crop \| undefined` |  |
| `quality` | `number \| undefined` |  |
| `alt` | `string \| undefined` |  |

##### `Link`

| Property | Type | Description |
| --- | --- | --- |
| `href` | `string \| undefined` | The link URL. For partial links (see `pageRole`), this is the router prefix (e.g. `https://www.my-site.com/prefix`) rather than a fully resolved URL. |
| `target` | `LinkTarget \| undefined` | Where this link should open. - `'_self'` — opens in the same page. - `'_blank'` — opens in a new tab. |
| `rel` | `string \| undefined` |  |
| `pageRole` | `string \| undefined` | Page role identifier. Present only on partial links, where only the router prefix is known and the full URL format is owned by the Router/App. Applications can use such links in functions to resolve the complete URL at runtime (e.g. for binding links). Resolved links will not have this field. |

##### `ServicePriceData`

| Property | Type | Description |
| --- | --- | --- |
| `rateType` | `RateTypeWithLiterals \| null` |  |
| `price` | `string \| null` |  |
| `priceAfterDiscount` | `string \| null` |  |
| `discountName` | `string \| null` |  |
| `calculatedAtCheckout` | `boolean` |  |
| `subscriptionFrequency` | `FrequencyTypeWithLiterals \| null` |  |
| `isFree` | `boolean` |  |

##### `ServiceOptionsAndVariants$1`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string \| null \| undefined` | ID of the `serviceOptionsAndVariants` object. |
| `serviceId` | `string \| null \| undefined` | ID of the service related to these options and variants. |
| `options` | `ServiceOptions \| undefined` | Service options. Note that currently only a single option is supported per service. |
| `variants` | `ServiceVariants \| undefined` | Information about the service's variants. |
| `minPrice` | `Money$1 \| undefined` | Price of the cheapest service variant. |
| `maxPrice` | `Money$1 \| undefined` | Price of the most expensive service variant. |
| `revision` | `string \| null \| undefined` | Revision number, which increments by 1 each time the `serviceOptionsAndVariants` object is updated. To prevent conflicting changes, the current revision must be passed when updating and deleting the `serviceOptionsAndVariants` object. Ignored when creating a `serviceOptionsAndVariants` object. |
| `extendedFields` | `ExtendedFields$2 \| undefined` | Extensions enabling users to save custom data related to service options and variants. |

##### `PricingOption`

| Property | Type | Description |
| --- | --- | --- |
| `optionId` | `string \| null` |  |
| `type` | `ServiceOptionType \| null` |  |
| `name` | `string \| null` | `STAFF_MEMBER` options have none; `null` means the caller supplies a generic heading. |
| `choices` | `PricingOptionChoice[]` |  |

##### `OfferedDay`

| Property | Type | Description |
| --- | --- | --- |
| `day` | `string` |  |

##### `CourseAvailability`

| Property | Type | Description |
| --- | --- | --- |
| `totalCapacity` | `number \| null` |  |
| `remainingCapacity` | `number \| null` |  |

##### `ServiceItemStaffMember`

| Property | Type | Description |
| --- | --- | --- |
| `image` | `Image \| null` |  |
| `staffMemberId` | `string` |  |
| `name` | `string \| null` |  |
| `locationCoverage` | `StaffLocationCoverage \| undefined` | Absent when the coverage wasn't returned — callers treat that as "works everywhere". |

##### `VisualMedia`

| Property | Type | Description |
| --- | --- | --- |
| `src` | `string` | The URL of the media file |
| `slug` | `string \| undefined` | The slug for the media |
| `description` | `string \| undefined` | Description of the media for accessibility purposes |
| `title` | `string \| undefined` | The title of the media |
| `height` | `number \| undefined` | The height of the media in pixels |
| `width` | `number \| undefined` | The width of the media in pixels |
| `action` | `{ link: string \| Link; } \| undefined` | An action when the item is clicked |
| `type` | `"image" \| "video"` |  |
| `parameters` | `ImageParameters \| VideoParameters \| undefined` |  |

##### `ServiceLocationItem`

| Property | Type | Description |
| --- | --- | --- |
| `type` | `"business" \| "custom" \| "customer"` | `business`: one of the business locations. `custom`: an address. `customer`: the customer's place. |
| `text` | `string \| null` | The business location's name or the address. Null for the customer's place: label it in your own words. |

##### `ServiceBookability`

| Property | Type | Description |
| --- | --- | --- |
| `state` | `AvailabilityState` |  |
| `isAvailableForBooking` | `boolean` |  |
| `bookingOpensAt` | `Date \| null` |  |

##### `ServicePreference`

| Property | Type | Description |
| --- | --- | --- |
| `serviceId` | `string` |  |
| `slug` | `string \| undefined` |  |
| `serviceType` | `ServiceTypeWithLiterals \| undefined` |  |
| `slotStart` | `string \| null \| undefined` |  |
| `slotEnd` | `string \| null \| undefined` |  |
| `eventId` | `string \| null \| undefined` |  |
| `scheduleId` | `string \| undefined` |  |
| `sessionId` | `string \| null \| undefined` |  |
| `locationId` | `string \| undefined` |  |
| `locationType` | `"CUSTOM" \| "BUSINESS" \| "CUSTOMER" \| undefined` |  |
| `resources` | `ResourceSelection[] \| undefined` |  |
| `selectedVariants` | `SelectedVariant[] \| undefined` |  |
| `addOns` | `AddOn[] \| undefined` |  |
| `durationChoiceId` | `string \| undefined` |  |
| `durationInMinutes` | `number \| undefined` | A chosen duration in minutes, sent as `customerChoices.durationInMinutes`. With add-ons the API requires it to equal the service duration plus theirs, so writers usually omit it. |
| `requestedGender` | `"ANY_FEMALE" \| "ANY_MALE" \| undefined` |  |
