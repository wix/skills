# Consuming a Vertical's Context

How an Editor React Component reads data owned by a Wix business solution (Stores, Bookings, Events) on that solution's page — the Harmony counterpart to a site plugin's slot props.

Read [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md) first: an ERC alone does **not** cover all editors, and extending a vertical's *dashboard* is a different extension type entirely.

---

> **🚧 TODO — package names are internal.** The `moduleSpecifier` values in the catalog below are the real identifiers the verticals ship today, taken verbatim from their manifests, but the packages are **not on public npm** (`npm view @wix/bookings-uou` → E404; same for `@wix/stores-product-page` and `@wix/events-contexts-poc`). Replace with the public package names once they are published. Until then a third-party app cannot install these — verify with `npm view <pkg> version` before writing code against a row.

> **Alpha.** Editor React Components are alpha, and the Events contexts are an explicit POC (`events-contexts-poc`). A context's shape can still change before it is released; once released it is frozen, because context manifests **cannot take breaking changes**.

---

## Rules

1. **Declare the dependency in the manifest, import the hook in the component.** Both halves are required — the hook import alone will not cause the platform to provide the context.

   `resources` lives in `<componentName>.extension.ts`, inside the `extensions.editorReactComponent({ ... })` call the scaffold generated. Add `dependencies` there — don't introduce a second `resources` block.

   ```ts
   // <componentName>.extension.ts
   import { extensions } from '@wix/astro/builders';
   import { editorElement } from './best-seller-badge.generated';

   export default extensions.editorReactComponent({
     id: '…',
     type: '…',
     editorElement,
     installation: { /* see Rule 8 */ },
     resources: {
       client: {
         // the withDefaults entry point, NOT the raw component file
         componentUrl: './extensions/site/components/best-seller-badge/component.tsx',
         dependencies: {
           contextDependencies: ['@wix/stores-product-page/product-context-provider'],
         },
       },
     },
   });
   ```

   `componentUrl` must point at `component.tsx` — the entry that wraps the component in `withDefaults` (see [`../EDITOR_REACT_COMPONENT.md`](../EDITOR_REACT_COMPONENT.md)). Every shipping Stores consumer does this. Pointing it at `<componentName>.tsx` bypasses `withDefaults`, so `defaultProps` are never applied and props the user hasn't set arrive `undefined`.

   ```tsx
   // <componentName>.tsx
   import { useProductContext } from '@wix/stores-product-page/product-context-provider';
   ```

   The string in `contextDependencies` is the provider's `moduleSpecifier` — the same value you import from. Get both from the catalog below. The array takes more than one entry: a component may consume several contexts.

   > **⚠️ `dependencies` goes inside `client`, and the wrong placement fails silently.** The published `@wix/astro` type for this builder (`editorReactComponent` is an alias of `siteComponent`) declares:
   >
   > ```ts
   > resources: {
   >   [key: string]: unknown;
   >   client: {
   >     [key: string]: unknown;
   >     componentUrl: string;
   >     cssUrl?: string;
   >     dependencies?: { componentDependencies?: string[]; contextDependencies?: string[] };
   >   };
   >   editor?: { /* same shape */ };
   > }
   > ```
   >
   > Because both `resources` and `client` carry `[key: string]: unknown`, writing `dependencies` as a **sibling** of `client` type-checks and is then ignored — no build error, no context at runtime. Some existing components and some older guidance use that sibling form, so you may encounter it; prefer the typed placement above. (Context *providers* are a different shape, declaring deps at `resources.dependencies` with `client`/`editor` holding only `url` — don't carry a provider's layout over to a consumer.)
   >
   > `componentDependencies` sits beside `contextDependencies` for depending on other components, and `resources.editor` takes the same `dependencies` object when you ship a separate editor bundle. Neither the public [`resources`](https://dev.wix.com/docs/build-apps/develop-your-app/extensions/site-extensions/editor-react-components/manifest-reference/root-properties/resources) reference nor `@wix/component-protocol` mentions `contextDependencies` — `@wix/astro` is the authority.

2. **Context data is platform-supplied, not an external fetch.** [`COMPONENT-API.md`](COMPONENT-API.md) forbids external resources; a vertical context is not one. It arrives through the platform like `a11y` props or `EnvironmentDefinition` in [`DIRECTIONALITY.md`](DIRECTIONALITY.md). Reading it is allowed and expected.

3. **The context is not attached automatically, and you don't control that.** Declaring `contextDependencies` does not put a provider on the page; attachment is platform-controlled and happens at install time. Until it happens the hook throws (Rule 4) and the component fails to render — the single most common reason an otherwise-correct component shows nothing. See [Attaching the provider](#attaching-the-provider).

4. **The hook throws when the provider is absent — it does not return `null`.** Every vertical hook is written as "read context, throw if missing":

   ```ts
   export function useServiceContext(): ServiceContextValue {
     const ctx = useContext(context);
     if (!ctx) throw new Error('useServiceContext must be used within ServiceContextProvider');
     return ctx;
   }
   ```

   So `useServiceContext() ?? {}` is dead code — the throw happens first. There is no in-component way to recover: you either have a provider or you don't.

   **What shipping components actually do: call the hook unguarded.** Every Stores consumer does this, and a search for `ErrorBoundary` across that repo's extensions returns zero hits. They rely on the component only ever being placed where the provider exists. Follow that convention — but understand what you are relying on, and don't add a defensive branch that cannot fire.

5. **Missing *data* is expressed as `null` fields, not a null context.** Most fields are `T | null` (e.g. `serviceName: string | null`), so guard per field and keep first render SSR-safe per [`SSR.md`](SSR.md):

   ```tsx
   const { serviceName } = useServiceContext();
   if (!serviceName) return null;
   ```

   This is what shipping consumers do: read the field, check it, render nothing when there is nothing to show.

6. **Split smart from dumb.** Within one component, the hook is called once at the top and the values flow down as props — presentation components never call it themselves. (Across the page, any number of separate components may each consume the same context; the rule is about one component's internals, not a page-wide limit.) See [Patterns](#patterns).

7. **Any backend call of your own must be platformized.** Exported sites run off Wix domains, so calls must go through public `wixapis.com`-mapped APIs. Fetch with the `use` utility so Suspense works during SSR — never `useEffect` + `setState` for first-render data. See [Fetching your own data](#fetching-your-own-data).

8. **Don't leave the scaffold's `installation.staticContainer` on a vertical component.** `wix generate` emits `staticContainer: 'HOMEPAGE'`, which is wrong for something that belongs on a vertical's page. The shipping Stores consumers declare only `installation.initialSize` (content-sized width and height) and omit `staticContainer` entirely.

---

## Per-vertical catalog

`type` is the provider's dev-center component type. `Hook` + `moduleSpecifier` are what you write in code. `Requires` lists other contexts the provider itself depends on — those must also be present on the page.

> **These field lists are the manifest's `context.items` — the editor-bindable subset, not the hook's return type.** The hook returns more: raw entity objects and actions left undeclared because they are smart-component API rather than bindable values. Bookings `ServiceContextValue`, for example, also carries `service`, `selection`, `setVariant`, `toggleAddOn`, `setAddOnQuantity`, `setSlot`, and `clearSlot`; Stores builds its value by spreading six internal hooks behind five bindable items.
>
> Use these lists to pick the right context and to know what the editor can bind. For the runtime shape, read the exported `ProductContextValue` / `ServiceContextValue` type from the provider package.

| Vertical | `type` | Hook | `moduleSpecifier` | Requires |
| --- | --- | --- | --- | --- |
| Stores | `onlineStoresBuilder.ProductPageContextProvider` | `useProductContext` | `@wix/stores-product-page/product-context-provider` | — |
| Events | `eventsContextsPOC.EventContextProvider` | `useEventContext` | `@wix/events-contexts-poc/event-context-provider` | — |
| Events | `eventsContextsPOC.EventListContextProvider` | `useEventListContext` | `@wix/events-contexts-poc/event-list-context-provider` | — |
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

Product page.

- `name`, `sku`
- `description` — Ricos document
- `prices` → `currentSellingPrice`, `originalPrice`, `pricePerUnit`
- `productPriceRange` → `minCurrentSellingPrice`, `maxCurrentSellingPrice`, `minOriginalPrice`, `maxOriginalPrice`, `minPricePerUnit`, `maxPricePerUnit`

Every price is a **display-formatted string**, not a number — don't parse it back for currency math.

The hook returns considerably more than these five bindable items: `low-stock-indicator` reads `remainingItemCount`, which appears nowhere in the manifest. Read `ProductContextValue` for the full set.

### Wix Events

**Event context** — event details page:

- `title`, `shortDescription`
- `titleRich`, `shortDate`, `longDate`, `shortLocation`, `longLocation` — rich text
- `image` — image
- `event` → `title`
- `locations` → `address`, `description`, `title`, `latitude`, `longitude`
- `openEventDetails()` — navigates to the public event details page; bound to a pointer event

**Event list context** — a list page rather than a single event. `events` → `title`. Its `filter` is provider config (`upcoming` | `past` | `all`, default `upcoming`), set where the provider is configured, not read from the hook.

**Available tickets** — `ticketDefinitions` → `name`
**Membership offers** — `plans` → `name`
**Seating plan** — `seatingPlan` → `title`

### Wix Bookings

**Service context** — service page:

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

This context is plural — it exposes the whole array, so pair it with a repeater to render one row per session.

**Time slots context** — requires Service. `timeSlots` and `nextAvailableSlots`, each slot → `slotId`, `startTime`, `endTime`, `bookable`, `totalCapacity`, `remainingCapacity`, `bookableCapacity`, `eventId`, `eventTitle`, `waitlistCapacity`, `locationId`, `locationName`. Plus `loading`, `error`, `timeZone`, `nextAvailableSlotsCount`, `selectedResourceId`, `selectedTimeSlot` (`slotStartTime`, `slotEndTime`, `bookable`, `eventId`), `staffFromSlots`, `setDateRange(start, end)`, `setSelectedResource(resourceId)`.

`selectTimeSlot` and `navigateToBookingForm` exist on the hook's return value but are deliberately **not** declared as bindable items — they are smart-component API. Call them from code; do not expect them in the editor's binding UI.

**Locations context** — `locationItems[]` → `locationId`, `locationName`, `isSelected`; `selectedLocationId`, `selectedLocationIndex`, `selectedLocationName`, `hasOtherLocations`, `selectLocation(locationId)`, `refetch()` (async).

**Categories context** — `categoryItems[]` → `categoryId`, `categoryName`, `isSelected`; `selectedCategoryId`, `selectedCategoryIndex`, `selectedCategoryName`, `selectCategory(categoryId)`, `refetch()` (async).

Locations and Categories back their selection with the URL — selecting updates the address bar, so treat them as the source of truth rather than mirroring selection into local state.

### Verticals not in this catalog

**This catalog covers Stores, Bookings, and Events only.** Other verticals have shipped context providers too — Members Area (groups, wallet, wishlist), eCommerce (cart), and Donations among them — and the set grows. Do not conclude a context doesn't exist just because it is missing here; ask Wix developer support whether one is available for your target vertical.

**If the vertical genuinely has no context provider, the ERC half cannot be built** — no manifest configuration substitutes for a provider that doesn't exist. Ship the site plugin and request a provider through Wix developer support. Wix Blog and Wix Restaurants are site-plugin hosts in [`../site-plugin/SLOTS.md`](../site-plugin/SLOTS.md) with no context provider found at the time of writing.

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

The root element follows the usual ERC pattern ([`CSS-GUIDELINES.md`](CSS-GUIDELINES.md)) — consuming a context changes nothing about it.

### Composition over one large component

Prefer several small context-consuming components (a name, a price, a badge) that the user can add, remove, and rearrange, over one component that owns the whole page layout. Any number of components on the page may consume the same context.

### Fetching your own data

```tsx
import { use } from '../../hooks/use'; // app-local — see note below

function WithData({ promise }) {
  const result = use(promise); // suspends during SSR until resolved
  return <div>{result.items.map(/* … */)}</div>;
}
```

`use` is a React-18 backport of React 19's `use` and is **not a published package** — each vertical vendors a local copy (Stores keeps it at `src/hooks/use.ts`). Vendor it in your app too, and delete it once the platform moves to React 19.

---

## Attaching the provider

A context provider is attached to a **page** or a **section** — never to your component. Components inside that page or section then receive the context. Until a provider is attached, your hook throws, so "nothing renders" and "the hook threw" are the same bug seen from two angles.

**You cannot arrange this from inside the component**, and declaring `contextDependencies` does not do it either. Attachment happens when the app is installed, which is platform-controlled. If your component builds correctly but receives no context, that is the thing to raise with Wix developer support — not a bug in your code.

Page and section attachment are the two cases you will meet. Two others exist — a developer wrapping ERC containers, and the legacy OOI slot adapter ([`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md)).

---

## Common Mistakes

- **Importing the hook without `contextDependencies`.** Builds, then fails at runtime with no context. Both halves are required.
- **Guarding a missing provider with `useXContext() ?? {}`.** Dead code — the hook throws before returning, so the fallback can never run. Guard nullable *fields* instead (Rule 5); a missing provider is not recoverable in-component (Rule 4).
- **Treating the catalog's field list as the hook's return type.** It is the editor-bindable subset; the runtime type is wider. Read the exported `*ContextValue` type.
- **Expecting the provider to attach itself.** The most common "my component renders nothing" cause, and not fixable in component code — see [Attaching the provider](#attaching-the-provider).
- **Writing code against a catalog row without checking the package resolves.** See the TODO at the top — these packages are not on public npm yet.
- **Re-formatting pre-formatted values.** Stores prices and Events dates/locations arrive display-ready; parsing them back into numbers or `Date`s loses locale and currency handling.
- **Fetching in `useEffect` for first-render data.** Breaks SSR. Use the `use` utility.
- **Calling a non-platformized backend.** Works on a Wix-hosted site, fails on an exported one.
- **Shipping only the ERC.** Dead on Wix Editor and Studio — see [`../EXTENDING_A_VERTICAL.md`](../EXTENDING_A_VERTICAL.md).
- **Building a dashboard extension this way.** Vertical dashboard pages use `observeState()` and typed host props, not contexts — see [`../DASHBOARD_PLUGIN.md`](../DASHBOARD_PLUGIN.md).
