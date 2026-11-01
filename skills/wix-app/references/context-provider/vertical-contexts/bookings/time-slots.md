# Bookings context: `@wix/bookings/context/time-slots` (part 1 of 3)

This context's reference is split across 3 files: [time-slots.md](time-slots.md), [time-slots-2.md](time-slots-2.md), [time-slots-3.md](time-slots-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/time-slots`.

### `TimeSlotsContextProvider`

Loads the availability of the service in the surrounding ServiceContextProvider, or of the multi-service appointment in the page URL, and holds the visitor's date, time zone, staff, location and slot choices.

```ts
import { TimeSlotsContextProvider } from '@wix/bookings/context/time-slots';
```

- **Parameters:** `props: TimeSlotsContextProviderProps`
- **Returns:** `Element`

### `useTimeSlotsContext`

Reads the time slots state; throws when no TimeSlotsContextProvider is above.

```ts
import { useTimeSlotsContext } from '@wix/bookings/context/time-slots';
```

- **Parameters:** none
- **Returns:** `TimeSlotsContextValue`

#### Returned types

##### `TimeSlotsContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `onlyAvailableSlots` | `boolean \| undefined` | Excludes nonbookable slots; defaults to true like the manifest. |
| `nextAvailableSlotsCount` | `number \| undefined` | Per page; Next Availability shows the first of them. |
| `loadDaysAvailabilityInitially` | `boolean \| undefined` | Fetch days availability once inputs are ready, not only after a range action. |
| `timeSlotLimitPerDay` | `number \| undefined` | Schedule rows shown per day before "load all". |
| `children` | `ReactNode` |  |

##### `TimeSlotsContextValue`

| Property | Type | Description |
| --- | --- | --- |
| `timeSlots` | `readonly TimeSlotItem[]` |  |
| `isLoading` | `boolean` |  |
| `hasError` | `boolean` |  |
| `errorCode` | `TimeSlotsErrorCode \| null` | The most relevant availability error; null without one. |
| `businessTimeZone` | `string \| null` | The default, and one of the visitor's zone options. |
| `setTimeZone` | `(timeZone: string) => void` | Only when the booking policy allows. |
| `currentTimeSlotsPage` | `number` | One-based. |
| `hasNextTimeSlotsPage` | `boolean` |  |
| `hasPreviousTimeSlotsPage` | `boolean` |  |
| `nextTimeSlotsPage` | `() => Promise<void>` |  |
| `loadUpcomingTimeSlots` | `() => Promise<void>` | Idempotent: callers share one query, which refetches on input change. Resolves when page 1 lands or fails, or at once when there is nothing to list. |
| `upcomingTimeSlotsRequested` | `boolean` |  |
| `previousTimeSlotsPage` | `() => void` | Shows the previous cached page. |
| `nextAvailableSlotsCount` | `number` | Per page; Next Availability shows the first of them. |
| `timeZone` | `string \| null` |  |
| `staffFromSlots` | `readonly StaffMemberItem[]` | On the selected slot. Empty when the business hides the staff choice. |
| `selectedResourceId` | `string \| null` | From service-context's `b=` (entry, else `?resource=`, else the preferences modal). Null is "Any available" or no choice yet. |
| `setSelectedResource` | `(id: string \| null) => void` | Writes the staff choice to the blob; null is an explicit "Any available". |
| `canAutoAssignStaff` | `boolean` | "Any available" is bookable on the selected slot (OOI canAutoAssignStaff). |
| `selectedTimeSlot` | `TimeSlotItem \| null` |  |
| `navigateToBookingForm` | `() => void` |  |
| `timeSlotLimitPerDay` | `number \| null` | Rows per day before "load all"; null when uncapped. |
| `expandedDates` | `ReadonlySet<string>` |  |
| `daysWithMore` | `ReadonlySet<string>` | Exact, not guessed. |
| `loadingDate` | `string \| null` | The date whose full schedule is loading. |
| `loadAllTimeSlotsForDay` | `(date: string) => Promise<void>` |  |
| `selectedDate` | `string \| null` | Non-null exactly when `timeSlots` holds that day's slots. |
| `daysAvailabilityRange` | `LocalDateRange \| null` | Inclusive; null until today is known. |
| `daysAvailability` | `readonly DayAvailabilityItem[]` | Empty until first loaded. With `onlyAvailableSlots`, a day with only full slots is `none`. |
| `daysAvailabilityLoading` | `boolean` |  |
| `daysAvailabilityHasError` | `boolean` | The day availability failed to load. |
| `timeSlotsLoading` | `boolean` |  |
| `timeSlotsErrorCode` | `TimeSlotsErrorCode \| null` | The same as `errorCode`. |
| `selectDate` | `(date: string) => Promise<void>` | Replaces `timeSlots` with that day's slots. Ignores past or malformed dates; reselecting refreshes. Resolves once stored (watch `timeSlotsLoading`). Before the service is known it waits, then drops for a course or no service. |
| `setDaysAvailabilityRange` | `(range: LocalDateRange) => Promise<void>` | An inverted or malformed range is ignored. |
| `nextDaysAvailabilityRange` | `() => Promise<void>` | A calendar month moves by month; any other range by its length. |
| `previousDaysAvailabilityRange` | `() => Promise<void>` | A calendar month moves by month; any other range by its length. |
| `goToNextAvailableDate` | `() => Promise<NextAvailableDateOutcome>` | Selects the first bookable date on or after the selected date (or today), moving the range if needed. Reports via `timeSlotsLoading`/`timeSlotsErrorCode`. Held until service, zone and today are known (no service resolves `none`); a `selectDate` meanwhile cancels it. |
| `canChangeTimeZone` | `boolean` |  |
| `isMultiService` | `boolean` | Multi-Service Appointment calendar: no service, service-context settled without error, and 2+ services in the Booking Preferences (valid or not). |
| `hasValidSchedulingInput` | `boolean` |  |
| `availabilityRequestKey` | `string \| null` | Changes with the request target (service, or MSA services/staff/choices/location), not with a picked time. Null with no valid input. An MSA changes in place without a remount, so builders that remember a search outcome key on this. |
| `needsServiceChoice` | `boolean` | Invalid or missing Booking Preferences, or a service with online booking off (nothing loading, no service-context error); nothing is requested. The editor keeps its placeholders, so builders gate it. |
| `staffFilterOptions` | `readonly StaffFilterOption[]` | Independent of the location filter. Empty when the business hides the staff choice. The two gender options lead when the business allows gender selection and 2+ staff members are offered. |
| `locationFilterOptions` | `readonly SelectionOption[]` |  |
| `selectedStaffFilter` | `string \| null` | The picked staff member's id; null under a gender (see `requestedGender`) or "any". |
| `selectedLocationFilter` | `string \| null` |  |
| `setStaffFilter` | `(id: string \| null) => void` | Takes an option's id; a staff member and a gender replace each other. Only narrows the requests; a slot picked under a staff member writes them to the blob. |
| `requestedGender` | `"ANY_FEMALE" \| "ANY_MALE" \| null` | The picked gender option's id, which the requests narrow by; null under a named staff member. |
| `genderSelectionAllowed` | `boolean` | The business offers 'any female/male staff member' here (settings on, not rejected, an appointment). Ignores the staff count; the editor's Staff Filter sample uses it. |
| `setLocationFilter` | `(id: string \| null) => void` |  |
| `selectTimeSlot` | `(slotId: string \| null) => void` | Writes the slot and its location to the blob. Null drops the pick. |
| `isComplete` | `boolean` | A slot is selected and, for an appointment, staff is chosen, auto-assign is allowed, or the slot has at most one staff member. On the MSA calendar a slot is enough. |
| `isSelectionValidated` | `boolean` | The selection still exists in availability. |
| `isRescheduling` | `boolean` | The calendar moves an existing booking (`bookingId` or `token` in its URL). |
| `rescheduleValidUntil` | `string \| null` | While rescheduling a booking paid with a pricing plan: the plan's last moment, as a local date-time in `timeZone`. Later days are unavailable. Null otherwise. |

##### `TimeSlotItem`

| Property | Type | Description |
| --- | --- | --- |
| `slotId` | `string` |  |
| `slotStartTime` | `string \| null` | Local date-time. |
| `slotEndTime` | `string \| null` | Local date-time. |
| `bookable` | `boolean` |  |
| `totalCapacity` | `number \| null` |  |
| `remainingCapacity` | `number \| null` |  |
| `bookableCapacity` | `number \| null` | What the visitor can book under current policy. |
| `eventId` | `string \| null` | Class slots only. |
| `eventTitle` | `string \| null` | Class slots only. |
| `waitlistCapacity` | `number \| null` | Remaining waitlist spots; class slots only. |
| `locationId` | `string \| null` |  |
| `locationName` | `string \| null` |  |
| `durationMinutes` | `number \| null` | Minutes, in the slot's timezone. |
| `isAllDay` | `boolean` |  |
| `staff` | `readonly TimeSlotStaffMember[]` | Empty when staff choice is hidden (CUSTOMER_CANNOT_CHOOSE, no staff-priced variant). |
