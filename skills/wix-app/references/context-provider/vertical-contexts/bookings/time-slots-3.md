# Bookings context: `@wix/bookings/context/time-slots` (part 3 of 3)

This context's reference is split across 3 files: [time-slots.md](time-slots.md), [time-slots-2.md](time-slots-2.md), [time-slots-3.md](time-slots-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/bookings/context/time-slots`.

##### `StaffMemberItem`

| Property | Type | Description |
| --- | --- | --- |
| `staffMemberId` | `string` |  |
| `name` | `string \| null` |  |
| `image` | `Image \| null` |  |
| `isSelected` | `boolean` |  |
| `locationCoverage` | `StaffLocationCoverage \| undefined` | Absent when the coverage wasn't returned — callers treat that as "works everywhere". |

##### `LocalDateRange`

| Property | Type | Description |
| --- | --- | --- |
| `startDate` | `string` |  |
| `endDate` | `string` |  |

##### `DayAvailabilityItem`

| Property | Type | Description |
| --- | --- | --- |
| `date` | `string` |  |
| `availability` | `DayAvailability` |  |

##### `StaffFilterOption`

| Property | Type | Description |
| --- | --- | --- |
| `gender` | `"ANY_FEMALE" \| "ANY_MALE" \| null` |  |
| `id` | `string` | The same literal as `gender`. |

##### `SelectionOption`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | The same literal as `gender`. |
| `name` | `string` |  |
