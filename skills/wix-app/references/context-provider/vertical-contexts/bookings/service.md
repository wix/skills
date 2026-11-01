# Bookings context: `@wix/bookings/context/service` (part 1 of 5)

This context's reference is split across 5 files: [service.md](service.md), [service-2.md](service-2.md), [service-3.md](service-3.md), [service-4.md](service-4.md), [service-5.md](service-5.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/service`.

### `ServiceContextProvider`

Loads a service from a services-list item, else from the page URL, else from the service picker, and holds the booking selection for it (or for a multi-service appointment's services).

```ts
import { ServiceContextProvider } from '@wix/bookings/context/service';
```

- **Parameters:** `__0: ServiceContextProviderProps`
- **Returns:** `Element`

### `resolveServiceTarget`

```ts
import { resolveServiceTarget } from '@wix/bookings/context/service';
```

- **Parameters:** `urlSlug: string \| null, prefs: BookingPreferences \| null, pickerServiceId: string \| undefined`
- **Returns:** `ServiceTarget`

### `useServiceContext`

Reads the service state; returns null instead of throwing when `optional` is true and no provider is above.

```ts
import { useServiceContext } from '@wix/bookings/context/service';
```

- **Parameters:** `optional: true`
- **Returns:** `ServiceContextValue \| null`

#### Returned types

##### `ServiceContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `serviceData` | `Partial<ServiceItem> \| undefined` |  |
| `servicePicker` | `ServicePickerFilter \| undefined` |  |
| `refreshSignal` | `number \| undefined` |  |
| `editingSurface` | `boolean \| undefined` | Set by the editor entry on its canvas (not preview), which never enters reschedule mode. |
| `children` | `ReactNode` |  |

##### `ServiceContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `service` | `Service$1 \| null` |  |
| `serviceName` | `string \| null` |  |
| `serviceDescription` | `string \| null` |  |
| `serviceTagLine` | `string \| null` |  |
| `serviceDefaultDuration` | `string \| null` |  |
| `serviceImage` | `Image \| null` |  |
| `serviceSlug` | `string \| null` |  |
| `servicePageLink` | `Link \| null` |  |
| `serviceId` | `string \| null` |  |
| `serviceType` | `string \| null` |  |
| `servicePrice` | `ServicePriceData` |  |
| `isVariedService` | `boolean` |  |
| `serviceOptionsAndVariants` | `ServiceOptionsAndVariants$1 \| null` | Null when not VARIED, not loaded yet, or failed (a failed refetch keeps the last value). |
| `pricingOption` | `PricingOption \| null` | `serviceOptionsAndVariants` as the modal's pricing option; null as above. |
| `isLoadingServiceOptionsAndVariants` | `boolean` | Includes empty and failed variant responses. |
| `hasAddOns` | `boolean` |  |
| `isConferenceEnabled` | `boolean` |  |
| `offeredDays` | `OfferedDay[]` |  |
| `courseAvailability` | `CourseAvailability \| null` |  |
| `courseStartDate` | `string \| null` |  |
| `courseEndDate` | `string \| null` |  |
| `staffMembers` | `ServiceItemStaffMember[]` |  |
| `coverImage` | `Image \| undefined` |  |
| `gallery` | `VisualMedia[]` |  |
| `serviceLocations` | `ServiceLocationItem[]` |  |
| `policyDescription` | `string \| null` |  |
| `serviceBookability` | `ServiceBookability` |  |
| `displayTimeZone` | `string` |  |
| `isAvailableForBooking` | `() => boolean` |  |
| `hasPolicyDescription` | `() => boolean` |  |
| `hasCoverImage` | `() => boolean` |  |
| `hasGalleryImages` | `() => boolean` |  |
| `isVariantDuration` | `() => boolean` |  |
| `isLoading` | `boolean` |  |
| `hasError` | `boolean` |  |
| `locale` | `string` |  |
| `selectStaffMember` | `SelectStaffMember` |  |
| `clearSelection` | `ClearSelection` |  |
| `clearStaffMember` | `ClearStaffMember` | Sets staff to neither a member nor "any". |
| `selection` | `ServicePreference` | Seeded from the `b=` blob. The calendar's picks change it without writing `b=`: the Service CTA writes it into the next page's URL. |
| `selectionTimezone` | `string \| undefined` | The zone `selection`'s slot times are local to — the one a pick reports, else the displayed one. `b=` carries it only once the CTA writes the pick, so a reader on the calendar has it from here alone. |
| `setVariant` | `SetVariant` | Empty clears. No participant count, so the booking form shows no count field for it. |
| `setVariantCounts` | `SetVariantCounts` | 0 removes. Clamped to the participant limits, decreases first so a swap isn't lost to the cap. Unknown choices are ignored and dropped from the selection; no-op before variants load. |
| `maxParticipantsPerBooking` | `number` | Across all variants; the cap the setters apply. |
| `toggleAddOn` | `ToggleAddOn` |  |
| `setAddOnQuantity` | `SetAddOnQuantity` | 0 removes. |
| `setSlot` | `SetSlot` |  |
| `clearSlot` | `ClearSlot` |  |
| `setMultiServiceSlot` | `SetMultiServiceSlot` | A Multi-Service Appointment's picked time, held like {@link setSlot}'s until the CTA. |
| `clearMultiServiceSlot` | `ClearMultiServiceSlot` |  |
| `draftRevision` | `number` | Goes up each time the drafts start over from a `b=` changed from outside, so the calendar drops its picked time. |
| `wantsPromoCode` | `boolean` | The visitor ticked "I have a promo code" in the Booking Summary (`b=`). |
| `setWantsPromoCode` | `(wanted: boolean) => void` | Writes the tick into `b=` in place; no-op without a decodable blob. |
| `withSelectionParam` | `WithSelectionParam` | Adds the live selection as `b=` to a destination path. |
| `serviceCtaState` | `ServiceCtaState` |  |
| `navigateToNextPage` | `(config?: ServiceSelectionNavigationConfig \| undefined, referralInfo?: BiReferralInfo \| undefined) => void` |  |
| `navigateToMultiServiceForm` | `(reportBi: (event: BiEvent) => void) => void` | A Multi-Service Appointment's step of navigateToNextPage, reporting the slot selections through `reportBi`, so the calendar's Next reports them as the calendar. |
| `resolveNextPageHref` | `(config?: ServiceSelectionNavigationConfig \| undefined) => string \| null` |  |
| `isNavigating` | `boolean` | True from navigateToNextPage() until the navigation settles; further calls do nothing. |
| `openPreferences` | `() => Promise<void>` | Opens the preferences Lightbox; rejects if it can't, so the caller can fall back. |
| `multiServiceAppointmentsEnabled` | `boolean` |  |
| `isMultiServiceAppointment` | `boolean` | 2+ services in the Booking Preferences, so no single service loads. |
| `multiServiceAppointmentServices` | `Service$1[]` | One per Booking Preferences entry, in order (may repeat). Empty if none or failed. |
| `multiServiceAppointmentOptionsAndVariants` | `Record<string, ServiceOptionsAndVariants$1>` | VARIED services only, by service id. |
| `multiServiceAppointmentVariantsStatus` | `"loading" \| "ready" \| "error"` |  |
| `bookingsSettingsLoading` | `boolean` |  |
| `reschedule` | `Reschedule \| null` | Reschedule mode: the URL names a booking (`bookingId`) or a token. Set on the server render too, from the URL; the booking itself loads in the browser. |
| `rescheduleBooking` | `() => Promise<RescheduleResult>` | Moves the booking to the picked time, then returns to `rescheduleRedirectUrl`, else My Bookings. `succeeded`: moved with nowhere to go (or the manage-booking page, or a failed return), so the caller confirms it in place, as OOI. |
| `goHomeAfterReschedule` | `() => void` | The success dialog's way out, as OOI's: the home page. |
| `canRescheduleToPick` | `boolean` | The booking can move to the picked time: it is bookable, its staff is settled, and the booking's pricing plan covers it. |
