# Consuming a Vertical's Context

How an Editor React Component reads data owned by a Wix business solution (Stores, Bookings, Events) on that solution's page — the Harmony counterpart to a site plugin's slot props.

Read [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md) first: an ERC alone does **not** cover all editors, and extending a vertical's *dashboard* is a different extension type entirely.

---

> **🚧 TODO — package names are internal.** The `moduleSpecifier` values in the catalog below are the real identifiers the verticals ship today, taken verbatim from their manifests, but the packages are **not on public npm** (`npm view @wix/bookings-uou` → E404; same for `@wix/stores-product-page` and `@wix/events-contexts-poc`). Replace with the public package names once they are published. Until then a third-party app cannot install these — verify with `npm view <pkg> version` before writing code against a row.

> **Alpha.** Editor React Components are alpha. The Events contexts are an explicit POC (`events-contexts-poc`). Context manifests **cannot take breaking changes once released**, so treat a context's shape as frozen only after it ships.

---

## Rules

1. **Declare the dependency in the manifest, import the hook in the component.** Both halves are required — the hook import alone will not cause the platform to provide the context.

   ```ts
   // <componentName>.extension.ts
   resources: {
     dependencies: {
       contextDependencies: ['@wix/stores-product-page/product-context-provider'],
     },
   }
   ```

   ```tsx
   // <componentName>.tsx
   import { useProductContext } from '@wix/stores-product-page/product-context-provider';
   ```

   The string in `contextDependencies` is the provider's `moduleSpecifier` — the same value you import from. Get both from the catalog below.

2. **Context data is platform-supplied, not an external fetch.** [`COMPONENT-API.md`](COMPONENT-API.md) forbids external resources; a vertical context is not one. It arrives through the platform like `a11y` props or `EnvironmentDefinition` in [`DIRECTIONALITY.md`](DIRECTIONALITY.md). Reading it is allowed and expected.

3. **The context is not attached automatically.** A correct component renders empty until the provider is attached to the page or section. See [Attaching the provider](#attaching-the-provider) — this is the single most common reason a working component shows nothing.

4. **Never assume the context is present.** Users can place the component anywhere. Render a deterministic placeholder when the hook returns nothing, and keep first render SSR-safe per [`SSR.md`](SSR.md).

5. **Split smart from dumb.** Exactly one component calls the hook; presentation components take props. See [Patterns](#patterns).

6. **Any backend call of your own must be platformized.** Exported sites run off Wix domains, so calls must go through public `wixapis.com`-mapped APIs. Fetch with the `use`/`usePromise` utility (a React-18 implementation of React 19's `use`) so Suspense works during SSR — never `useEffect` + `setState` for first-render data.

---

## Per-vertical catalog

`type` is the provider's dev-center component type. `Hook` + `moduleSpecifier` are what you write in code. `Requires` lists other contexts the provider itself depends on — those must also be present on the page.

| Vertical | `type` | Hook | `moduleSpecifier` | Requires |
| --- | --- | --- | --- | --- |
| Stores | `onlineStoresBuilder.ProductPageContextProvider` | `useProductContext` | `@wix/stores-product-page/product-context-provider` | — |
| Events | `eventsContextsPOC.EventContextProvider` | `useEventContext` | `@wix/events-contexts-poc/event-context-provider` | — |
| Events | `eventsContextsPOC.AvailableTicketsContextProvider` | `useAvailableTicketsContext` | `@wix/events-contexts-poc/available-tickets-context-provider` | Event |
| Events | `eventsContextsPOC.MembershipOffersContextProvider` | `useMembershipOffersContext` | `@wix/events-contexts-poc/membership-offers-context-provider` | Event |
| Events | `eventsContextsPOC.SeatingPlanContextProvider` | `useSeatingPlanContext` | `@wix/events-contexts-poc/seating-plan-context-provider` | Event |
| Bookings | `BookingsBookings.ServiceContext` | `useServiceContext` | `@wix/bookings-uou/service-context` | — |
| Bookings | `BookingsBookings.ServicesContext` | `useServicesContext` | `@wix/bookings-uou/services-context` | — |
| Bookings | `BookingsBookings.SessionsContext` | `useSessionsContext` | `@wix/bookings-uou/sessions-context` | Service |
| Bookings | `BookingsBookings.TimeSlotsContext` | `useTimeSlotsContext` | `@wix/bookings-uou/time-slots-context` | Service |
| Bookings | `BookingsBookings.LocationsContext` | `useLocationsContext` | `@wix/bookings-uou/locations-context` | — |
| Bookings | `BookingsBookings.CategoriesContext` | `useCategoriesContext` | `@wix/bookings-uou/categories-context` | — |

### Wix Stores — product context

Product page. `description` is a Ricos document; everything else here is pre-formatted text.

- `name`, `sku`
- `description` — Ricos document
- `prices` → `currentSellingPrice`, `originalPrice`, `pricePerUnit`
- `productPriceRange` → `minCurrentSellingPrice`, `maxCurrentSellingPrice`, `minOriginalPrice`, `maxOriginalPrice`, `minPricePerUnit`, `maxPricePerUnit`

Prices arrive **formatted for display** — do not re-format or do currency math on them.

### Wix Events

**Event context** — event details page:

- `title`, `shortDescription`
- `titleRich`, `shortDate`, `longDate`, `shortLocation`, `longLocation` — rich text
- `image` — image
- `event` → `title`
- `locations` → `address`, `description`, `title`, `latitude`, `longitude`
- `openEventDetails()` — navigates to the public event details page; bound to a pointer event

**Available tickets** — `ticketDefinitions` → `name`
**Membership offers** — `plans` → `name`
**Seating plan** — `seatingPlan` → `title`

The three above are thin by design in the POC; expect them to grow.

### Wix Bookings

**Service context** — service page. The richest context of the three verticals:

- Identity — `serviceId`, `serviceSlug`, `serviceName`, `serviceDescription`, `serviceTagLine`, `serviceType`, `serviceCtaState`
- Price — `servicePrice` → `rateType`, `price`, `priceAfterDiscount`, `discountName`, `calculatedAtCheckout`
- `pricingOption` → `type` (`CUSTOM` | `STAFF_MEMBER` | `DURATION`), `name`, `choices[]` → `choiceId`, `label`, `price`
- Flags — `isVariedService`, `hasAddOns`, `isConferenceEnabled`, `isAnyStaff`
- Course — `courseAvailability` → `totalCapacity`, `remainingCapacity`; `courseStartDate`, `courseEndDate`
- `serviceDefaultDuration`, `serviceImage`, `offeredDays[]` → `day`
- Staff — `staffMembers` / `selectedStaffMember` → `staffMemberId`, `name`, `image`, `isSelected`
- `emptyState` → `title`, `description`
- Actions — `selectStaffMember(staffMemberId)`, `clearSelection()`, `navigateToNextPage()`

**Services context** — paginated list of visible services: `serviceItems[]`, `emptyState`, `error`, `hasMore`, `categoryId`, `locationId`, `loadMore()` (async).

`serviceItems[]` declares `contextImplementor` targeting `BookingsBookings.ServiceContext` via `propKey: 'serviceData'` — i.e. each row can feed a nested Service context, so a list item's children can consume `useServiceContext()` as if on a service page. Use this instead of threading service data down as props.

**Sessions context** — requires Service. `sessions[]` → `id`, `title`, `startDate`, `endDate`, `durationMinutes`, `staff[]` (`staffMemberId`, `name`), `totalCapacity`, `spotsLeft`, `isFullyBooked`, `isConfirmed`, `isCancelled`, `isAllDay`; plus `timeZone`, `hasMore`, `loadMoreSessions()` (async).

Plural — pair with a repeater to render one row per session.

**Time slots context** — requires Service. `timeSlots` and `nextAvailableSlots`, each slot → `slotId`, `startTime`, `endTime`, `bookable`, `totalCapacity`, `remainingCapacity`, `bookableCapacity`, `eventId`, `eventTitle`, `waitlistCapacity`, `locationId`, `locationName`. Plus `loading`, `error`, `timeZone`, `nextAvailableSlotsCount`, `selectedResourceId`, `selectedTimeSlot` (`slotStartTime`, `slotEndTime`, `bookable`, `eventId`), `staffFromSlots`, `setDateRange(start, end)`, `setSelectedResource(resourceId)`.

`selectTimeSlot` and `navigateToBookingForm` exist on the hook's return value but are deliberately **not** declared as bindable items — they are smart-component API. Call them from code; do not expect them in the editor's binding UI.

**Locations context** — `locationItems[]` → `locationId`, `locationName`, `isSelected`; `selectedLocationId`, `selectedLocationIndex`, `selectedLocationName`, `hasOtherLocations`, `selectLocation(locationId)`, `refetch()` (async).

**Categories context** — `categoryItems[]` → `categoryId`, `categoryName`, `isSelected`; `selectedCategoryId`, `selectedCategoryIndex`, `selectedCategoryName`, `selectCategory(categoryId)`, `refetch()` (async).

Locations and Categories back their selection with the URL — selecting updates the address bar, so treat them as the source of truth rather than mirroring selection into local state.

---

## Patterns

### Smart component reads context, dumb component renders

```tsx
// smart — the only place the hook appears
import { useProductContext } from '@wix/stores-product-page/product-context-provider';

export default function BestSellerBadge({ className, id, label }: BestSellerBadgeProps) {
  const { sku } = useProductContext() ?? {};
  if (!sku) return null; // placed outside a product page, or not resolved yet
  return <BadgeUI className={className} id={id} label={label} sku={sku} />;
}
```

`useProductContext() ?? {}` plus the early return is the whole missing-context contract. A component that destructures unconditionally crashes the moment a user drags it onto the home page.

### The root node must stay selectable

The editor can only select the component if its root carries all three:

```tsx
<div className={`${props.className} ${styles.root}`} id={props.id}>
```

- `className` from props
- the class matching the selector declared in the manifest
- `id` from `props.id`

Dropping any one of them makes the component unselectable in the editor even though it renders correctly on the site.

### Composition over one large component

Prefer several small context-consuming components (a name, a price, a badge) that the user can add, remove, and rearrange, over one component that owns the whole page layout. Multiple components may consume the same context, and a provider may itself consume a parent context.

Segregate contexts by data purpose: list vs single item, backend data vs UI state (filters, dropdowns), shareable vs specific.

### Fetching your own data

```tsx
import { use } from '../usePromise';

function WithData({ promise }) {
  const result = use(promise); // suspends during SSR until resolved
  return <div>{result.items.map(/* … */)}</div>;
}
```

---

## Attaching the provider

A context provider is attached to a **page** or a **section**, not to your component. Until it is, your hook returns nothing.

To test locally, open the editor with `&experiments=specs.thunderbolt.contextProviders`, select the section, then:

```js
const pointer = { id: s.ds.pages.getCurrentPageId(), type: 'DESKTOP' }; // page
// const pointer = s.selected.documentPointer;                          // or section

s.ds.contexts.attach(pointer, '<yourContextType>');
s.ds.contexts.list(pointer); // verify
```

Components inside that page/section then receive the context.

For production, attachment must happen when the app is installed — this is an Editor Platform dependency, not something the component can arrange for itself. If a context will not attach, raise it in `#editor-platform-dev`.

There are four ways a provider ends up on stage: attached to a page, attached to a section, wrapping ERC containers the developer injects, or the legacy OOI slot adapter (see [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md)).

---

## Common Mistakes

- **Importing the hook without `contextDependencies`.** Builds, then fails at runtime with no context. Both halves are required.
- **Assuming the context exists.** Destructuring the hook result unconditionally crashes when the component is placed off the vertical's page.
- **Expecting the provider to attach itself.** The most common "my component renders nothing" cause. Verify with `s.ds.contexts.list(pointer)`.
- **Writing code against a catalog row without checking the package resolves.** See the TODO at the top — these packages are not on public npm yet.
- **Re-formatting pre-formatted values.** Stores prices and Events dates/locations arrive display-ready; parsing them back into numbers or `Date`s loses locale and currency handling.
- **Fetching in `useEffect` for first-render data.** Breaks SSR. Use `use`/`usePromise`.
- **Calling a non-platformized backend.** Works on a Wix-hosted site, fails on an exported one.
- **Shipping only the ERC.** Dead on Wix Editor and Studio — see [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md).
- **Building a dashboard extension this way.** Vertical dashboard pages use `observeState()` and typed host props, not contexts — see [`../DASHBOARD_PLUGIN.md`](../DASHBOARD_PLUGIN.md).
