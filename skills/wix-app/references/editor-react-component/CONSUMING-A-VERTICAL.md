# Consuming a Vertical's Context

How an Editor React Component reads data owned by a Wix business solution (Stores, Bookings, Events) on that solution's page — the Harmony counterpart to a site plugin's slot props.

Read [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md) first: an ERC alone does **not** cover all editors, and extending a vertical's *dashboard* is a different extension type entirely.

---

> **🚧 TODO — package names are internal.** The `moduleSpecifier` values in the catalog below are the real identifiers the verticals ship today, taken verbatim from their manifests, but the packages are **not on public npm** (`npm view @wix/bookings-uou` → E404; same for `@wix/stores-product-page` and `@wix/events-contexts-poc`). Replace with the public package names once they are published. Until then a third-party app cannot install these — verify with `npm view <pkg> version` before writing code against a row.

> **Alpha.** Editor React Components are alpha. The Events contexts are an explicit POC (`events-contexts-poc`). Context manifests **cannot take breaking changes once released**, so treat a context's shape as frozen only after it ships.

---

## Rules

1. **Declare the dependency in the manifest, import the hook in the component.** Both halves are required — the hook import alone will not cause the platform to provide the context.

   `resources` lives in `<componentName>.extension.ts` — add `dependencies` alongside the existing `client`, inside the `extensions.editorReactComponent({ ... })` call the scaffold already generated. Do not introduce a second `resources` block.

   ```ts
   // <componentName>.extension.ts
   export default extensions.editorReactComponent({
     id: '…',
     type: '…',
     editorElement,
     resources: {
       client: {
         componentUrl: './extensions/site/components/best-seller-badge/best-seller-badge.tsx',
       },
       dependencies: {
         contextDependencies: ['@wix/stores-product-page/product-context-provider'],
       },
     },
   });
   ```

   ```tsx
   // <componentName>.tsx
   import { useProductContext } from '@wix/stores-product-page/product-context-provider';
   ```

   The string in `contextDependencies` is the provider's `moduleSpecifier` — the same value you import from. Get both from the catalog below.

   > **`contextDependencies` is not in the public manifest reference.** The [`resources`](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/site-extensions/editor-react-components/manifest-reference/root-properties/resources) page documents no `dependencies` key at all — the field is confirmed only by the internal Builder guide and by the verticals' own manifests. Don't conclude it doesn't exist because the public docs omit it; do expect the shape to move while ERCs are alpha.

2. **Context data is platform-supplied, not an external fetch.** [`COMPONENT-API.md`](COMPONENT-API.md) forbids external resources; a vertical context is not one. It arrives through the platform like `a11y` props or `EnvironmentDefinition` in [`DIRECTIONALITY.md`](DIRECTIONALITY.md). Reading it is allowed and expected.

3. **The context is not attached automatically.** Declaring `contextDependencies` does not put a provider on the page — someone must attach it to the page or section. Until then the hook throws (Rule 4) and the component fails to render. See [Attaching the provider](#attaching-the-provider): this is the single most common reason an otherwise-correct component shows nothing.

4. **The hook throws when the provider is absent — it does not return `null`.** Every vertical hook is written as "read context, throw if missing":

   ```ts
   export function useServiceContext(): ServiceContextValue {
     const ctx = useContext(context);
     if (!ctx) throw new Error('useServiceContext must be used within ServiceContextProvider');
     return ctx;
   }
   ```

   So `useServiceContext() ?? {}` is dead code — the throw happens first. Defending against a missing provider means **not calling the hook** unless the provider is guaranteed, or wrapping the consumer in an error boundary. Users can place a component anywhere, so an ERC that calls a vertical hook unconditionally will crash when dropped outside the vertical's page.

5. **Missing *data* is expressed as `null` fields, not a null context.** Most fields are `T | null` (e.g. `serviceName: string | null`), so guard per field and keep first render SSR-safe per [`SSR.md`](SSR.md):

   ```tsx
   const { serviceName } = useServiceContext();
   if (!serviceName) return null;
   ```

6. **Split smart from dumb.** Exactly one component calls the hook; presentation components take props. See [Patterns](#patterns).

7. **Any backend call of your own must be platformized.** Exported sites run off Wix domains, so calls must go through public `wixapis.com`-mapped APIs. Fetch with the `use`/`usePromise` utility (a React-18 implementation of React 19's `use`) so Suspense works during SSR — never `useEffect` + `setState` for first-render data.

---

## Per-vertical catalog

`type` is the provider's dev-center component type. `Hook` + `moduleSpecifier` are what you write in code. `Requires` lists other contexts the provider itself depends on — those must also be present on the page.

> **The field lists below are the manifest's `context.items` — the editor-**bindable** subset, not the hook's full return type.** The hook usually returns **more**: raw entity objects and extra actions that were deliberately left undeclared because they are smart-component API rather than editor-bindable values. Two confirmed examples: Bookings `ServiceContextValue` also carries `service`, `selection`, `setVariant`, `toggleAddOn`, `setAddOnQuantity`, `setSlot`, `clearSlot`; Bookings time-slots also carries `selectTimeSlot` and `navigateToBookingForm`. Stores composes its value by spreading several internal hooks (info, price, inventory, selected media, cart actions, back-in-stock), so its runtime surface is considerably wider than the five bindable items listed.
>
> Use the lists below to answer "what can the editor bind?" and to know a context is the right one. For the authoritative runtime shape, read the exported type — `ProductContextValue`, `ServiceContextValue`, etc. — from the provider package.

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
  const { sku } = useProductContext(); // throws if no provider — see Rule 4
  if (!sku) return null;               // field is nullable even when the provider exists
  return <BadgeUI className={className} id={id} label={label} sku={sku} />;
}
```

Two distinct failure modes, and they need different handling:

| Situation | Symptom | Handling |
| --- | --- | --- |
| No provider on the page | Hook **throws** | Error boundary, or don't render the consumer at all |
| Provider present, data not resolved / not applicable | Field is `null` | Per-field guard, as above |

Conflating them — `useProductContext() ?? {}` — produces code that looks defensive and isn't.

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
import { use } from '../usePromise'; // app-local utility — see note below

function WithData({ promise }) {
  const result = use(promise); // suspends during SSR until resolved
  return <div>{result.items.map(/* … */)}</div>;
}
```

`use` is a React-18 backport of React 19's `use` and is **not yet a published package** — the verticals each vendor a local copy (Stores keeps it at `src/hooks/use.ts`). Vendor it in your own app until it ships in a shared lib, and expect to delete it when the platform moves to React 19.

---

## Attaching the provider

A context provider is attached to a **page** or a **section**, not to your component. Until it is, your hook throws — so "nothing renders" and "the hook threw" are the same bug seen from two angles.

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
- **`useXContext() ?? {}`.** Looks defensive, is dead code — the hook throws before returning. See Rule 4.
- **Treating the catalog's field list as the hook's return type.** It is the editor-bindable subset; the runtime type is wider. Read the exported `*ContextValue` type.
- **Calling a vertical hook unconditionally in a component users can place anywhere.** Crashes off the vertical's page — needs an error boundary or a guaranteed provider.
- **Expecting the provider to attach itself.** The most common "my component renders nothing" cause. Verify with `s.ds.contexts.list(pointer)`.
- **Writing code against a catalog row without checking the package resolves.** See the TODO at the top — these packages are not on public npm yet.
- **Re-formatting pre-formatted values.** Stores prices and Events dates/locations arrive display-ready; parsing them back into numbers or `Date`s loses locale and currency handling.
- **Fetching in `useEffect` for first-render data.** Breaks SSR. Use `use`/`usePromise`.
- **Calling a non-platformized backend.** Works on a Wix-hosted site, fails on an exported one.
- **Shipping only the ERC.** Dead on Wix Editor and Studio — see [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md).
- **Building a dashboard extension this way.** Vertical dashboard pages use `observeState()` and typed host props, not contexts — see [`../DASHBOARD_PLUGIN.md`](../DASHBOARD_PLUGIN.md).
