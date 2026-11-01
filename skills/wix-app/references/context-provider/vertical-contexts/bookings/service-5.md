# Bookings context: `@wix/bookings/context/service` (part 5 of 5)

This context's reference is split across 5 files: [service.md](service.md), [service-2.md](service-2.md), [service-3.md](service-3.md), [service-4.md](service-4.md), [service-5.md](service-5.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/service`.

##### `Reschedule`

| Property | Type | Description |
| --- | --- | --- |
| `status` | `RescheduleStatus` |  |
| `booking` | `RescheduledBooking \| null` |  |
| `validUntil` | `string \| null` | The plan the booking was paid with expires then (an instant); null without one. |
