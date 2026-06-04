# Bookings Pages — Phase 4

You are the Phase 4 Pages agent for the bookings vertical. Your scope: write the route files. Read `references/shared/IMPLEMENTER.md` + `references/shared/STYLING.md` first.

> **Start from the canonical templates — don't invent the SSR data access.** Verified templates live at `<SKILL_ROOT>/references/astro/templates/bookings/`: `services/index.astro`, `services/[slug].astro`, `booking-confirmation.astro`, `manage-booking.astro` (plus the pre-copied API endpoints `api/confirm-booking.ts`, `api/waitlist.ts`). **Read and adapt them** (copy, headings, styling) — this doc explains the *why*. The SSR query pattern (`@wix/essentials` `auth.elevate`), the confirm step, and the manage/waitlist endpoints are live-verified.

---

## Files you own

| File | Route | Description |
|------|-------|-------------|
| `src/pages/services/index.astro` | `/services` | SSR services listing grid |
| `src/pages/services/[slug].astro` | `/services/[slug]` | SSR service detail + client-side booking flow |
| `src/pages/booking-confirmation.astro` | `/booking-confirmation` | Post-booking confirmation page |

Read `.wix/site.json` at `<site-root>/.wix/site.json` for `seeded.bookings.services` and `brand`.

---

## Step 1 — Read seeded data

```typescript
// In each page's frontmatter — example
import { services } from '../../.wix/site';
// OR read the JSON directly:
const site = await Astro.locals.site; // from the site module
const seededServices = site.seeded?.bookings?.services ?? [];
```

If `seeded.bookings.services` is absent or empty, fall back to live SDK query (see below). Do NOT crash — fail gracefully with an empty grid and a "Coming soon" placeholder.

---

## Page 1 — `/services/index.astro`

### Frontmatter

```typescript
---
import Layout from '../../layouts/Layout.astro';
import ServiceCard from '../../components/ServiceCard.astro';
import { services } from '@wix/bookings';
import { auth } from '@wix/essentials';

// SSR data access: use the ambient @wix/astro server client via @wix/essentials —
// the SAME pattern the CMS pages use (`auth.elevate(fn)` + a direct module import).
// Do NOT build a `createClient`/`OAuthStrategy` here keyed off `import.meta.env`:
// the `*_WIX_CLIENT_ID` env vars are CLIENT-only in @wix/astro and `undefined`
// during server render, so `createClient`/`OAuthStrategy` throws and the page
// returns HTTP 500 in production. (It "works" in `astro dev` only because
// `.env.local` is loaded there — the 500 surfaces only in the deployed runtime.)
// Client-side islands access the ID differently — see COMPONENTS.md (`astro:env/client`).
let serviceList: any[] = [];
try {
  // queryServices uses the QUERY BUILDER, then `.find()` — NOT a
  // `{ query: { filter, paging } }` object. In @wix/bookings the object form
  // returns ZERO items with no error; the builder is what actually queries.
  const result = await auth.elevate(services.queryServices)()
    .limit(100)
    .find();
  // Exclude hidden services from the public listing (filter in JS — robust
  // regardless of whether `hidden` is a queryable builder field).
  serviceList = (result.items ?? []).filter((s: any) => !s.hidden);
} catch (err) {
  console.error('[services] query failed:', err);
}

// Services V2: slug lives at service.mainSlug.name. ID is service._id (underscore).
const getSlug = (service: any): string =>
  service.mainSlug?.name ??
  service.supportedSlugs?.[0]?.name ??
  service._id; // fallback to ID if slug is absent

// Services V2: price uses `value` (string), not `amount`
const formatPrice = (service: any): string | undefined => {
  const payment = service.payment;
  if (!payment || payment.rateType === 'NO_FEE') return undefined;
  if (payment.rateType === 'FIXED' && payment.fixed?.price) {
    const { value, currency } = payment.fixed.price;
    if (!value) return undefined;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(Number(value));
  }
  return undefined;
};

// Duration: lives at service.schedule.availabilityConstraints.sessionDurations[0]
const getDuration = (service: any): number =>
  service.schedule?.availabilityConstraints?.sessionDurations?.[0] ?? 60;
---
```

### Template

```astro
<Layout title="Services">
  <main class="py-4xl">
    <section class="container mx-auto px-lg">
      <header class="mb-3xl">
        <h1 class="font-display text-4xl mb-sm">Our Services</h1>
        <!-- Optional tagline from brand -->
      </header>

      {serviceList.length === 0 ? (
        <p class="text-secondary">Services coming soon — check back shortly.</p>
      ) : (
        <div class="service-grid">
          {serviceList.map((service) => (
            <ServiceCard
              id={service._id}
              slug={getSlug(service)}
              name={service.name ?? 'Untitled'}
              tagLine={service.tagLine}
              durationMinutes={getDuration(service)}
              price={formatPrice(service)}
              imageUrl={service.media?.mainMedia?.image?.url ?? service.media?.items?.[0]?.image?.url}
              type={service.type ?? 'APPOINTMENT'}
            />
          ))}
        </div>
      )}
    </section>
  </main>
</Layout>
```

---

## Page 2 — `/services/[slug].astro`

### Frontmatter

```typescript
---
// File is at src/pages/services/[slug].astro
// ../../ from src/pages/services/ → src/
import Layout from '../../layouts/Layout.astro';
import ServiceBookingFlow from '../../components/ServiceBookingFlow';
import { services } from '@wix/bookings';
import { auth } from '@wix/essentials';

const { slug } = Astro.params;

// SSR via @wix/essentials — same ambient pattern as the listing page above and
// the CMS pages. No createClient/OAuthStrategy, no import.meta.env (those 500 at
// server render — see the listing-page note).
let service: any = null;
try {
  // Query builder + `.find()` (the object form returns 0 items). Fetch the small
  // catalog and match the slug in JS — robust without relying on a nested-field
  // (`mainSlug.name`) builder filter.
  const result = await auth.elevate(services.queryServices)()
    .limit(100)
    .find();
  service =
    (result.items ?? []).find(
      (s: any) => (s.mainSlug?.name ?? s.supportedSlugs?.[0]?.name) === slug,
    ) ?? null;
} catch (err) {
  console.error(`[services/${slug}] query failed:`, err);
}

if (!service) {
  return Astro.redirect('/services', 302);
}

// Services V2: flat fields — `name`, `tagLine`, not `info.name`, `info.tagLine`
// Price uses `value` (string), not `amount`
const formatPrice = (payment: any): string | undefined => {
  if (!payment || payment.rateType === 'NO_FEE') return undefined;
  if (payment.rateType === 'FIXED' && payment.fixed?.price) {
    const { value, currency } = payment.fixed.price;
    if (!value) return undefined;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(Number(value));
  }
  return undefined;
};

const price = formatPrice(service.payment);
// Duration: service.schedule.availabilityConstraints.sessionDurations[0]
const duration = service.schedule?.availabilityConstraints?.sessionDurations?.[0] ?? 60;
// Media: service.media.mainMedia.image.url (V2 shape)
const imageUrl = service.media?.mainMedia?.image?.url ?? service.media?.items?.[0]?.image?.url;
---
```

### Template

```astro
<!--
  Width: use `container-reading` (max-width: var(--container-prose) + auto margins),
  NOT a bare `max-w-<size>`. In this Tailwind v4 setup any `max-w-<size>` whose key
  the Composer didn't emit in @theme `--container-*` silently falls back to the
  `--spacing-*` scale — e.g. `max-w-4xl` → ~7rem, a ~112px column (one word per line).
  `container-reading` is a project-owned utility that always resolves. See STYLING.md.
-->
<Layout title={service.name ?? 'Service'}>
  <main class="py-4xl">
    <div class="container-reading px-lg">
      <!-- Back link -->
      <a href="/services" class="text-secondary hover:text-primary text-sm mb-xl block">
        ← All Services
      </a>

      <!-- Optional banner image — render ONLY when the service has media. The
           default seed is text-only, so most services have no image; rendering a
           fixed-ratio placeholder there collapses to a thin bar and crowds the
           text. Single full-width column when image-less. -->
      {imageUrl && (
        <img src={imageUrl} alt={service.name} class="w-full h-64 object-cover rounded-lg mb-xl" />
      )}

      <!-- Service hero — single column -->
      <div class="flex flex-col gap-md mb-3xl">
        {/* V2 flat fields: name, tagLine, description (not info.name etc.) */}
        <h1 class="font-display text-4xl">{service.name}</h1>
        {service.tagLine && (
          <p class="text-secondary text-lg">{service.tagLine}</p>
        )}
        <div class="flex gap-md items-center text-sm">
          <span class="font-medium">{duration} min</span>
          {price && <span class="text-primary font-bold text-lg">{price}</span>}
        </div>
        {service.description && (
          <p class="text-base leading-relaxed">{service.description}</p>
        )}
      </div>

      <!-- Booking flow — client-side islands -->
      <section class="border-t border-[--color-border] pt-2xl">
        <h2 class="font-display text-2xl mb-xl">Book This Service</h2>
        <ServiceBookingFlow
          serviceId={service._id}
          serviceName={service.name ?? 'this service'}
          serviceType={service.type ?? 'APPOINTMENT'}
          client:only="react"
        />
      </section>
    </div>
  </main>
</Layout>
```

### ServiceBookingFlow coordinator

Because `AvailabilityCalendar` and `BookingForm` share state (the selected slot) and need to transition between each other, write a thin coordinator island `ServiceBookingFlow.tsx` that manages this state:

```typescript
// src/components/ServiceBookingFlow.tsx
import { useState } from 'react';
import { useNavigate } from '../utils/navigate'; // simple wrapper or inline window.location
import AvailabilityCalendar from './AvailabilityCalendar';
import BookingForm from './BookingForm';

interface Props {
  serviceId: string;
  serviceName: string;
  serviceType: 'APPOINTMENT' | 'CLASS';  // threaded into both islands
}

export default function ServiceBookingFlow({ serviceId, serviceName, serviceType }: Props) {
  const [selectedSlot, setSelectedSlot] = useState<any>(null);

  const handleSuccess = (bookingId: string, startDate?: string) => {
    const params = new URLSearchParams({ bookingId });
    if (startDate) params.set('startDate', startDate);
    if (serviceName) params.set('service', serviceName);
    window.location.href = `/booking-confirmation?${params.toString()}`;
  };

  if (!selectedSlot) {
    return (
      <AvailabilityCalendar
        serviceId={serviceId}
        serviceName={serviceName}
        serviceType={serviceType}
        onSlotSelected={setSelectedSlot}
      />
    );
  }

  return (
    <BookingForm
      serviceId={serviceId}
      serviceName={serviceName}
      serviceType={serviceType}
      slot={selectedSlot}
      onSuccess={handleSuccess}
      onCancel={() => setSelectedSlot(null)}
    />
  );
}
```

Add `ServiceBookingFlow` to the files you own and include it in your pre-return assertion.

---

## Page 3 — `/booking-confirmation.astro`

### Frontmatter

```typescript
---
import Layout from '../../layouts/Layout.astro';

// Confirmation page reads params from the redirect URL set by ServiceBookingFlow.
// We do NOT re-fetch the booking via SDK here — the booking was created by the
// client island (visitor identity), and re-reading it on the confirmation page
// adds no value over the params we already pass. (A server re-fetch of someone
// else's booking is out of scope for this skill.) Keep it param-driven.
// ServiceBookingFlow redirects with: ?bookingId=...&startDate=...&service=...
const bookingId = Astro.url.searchParams.get('bookingId');
const startDateParam = Astro.url.searchParams.get('startDate');  // ISO string passed from client
const serviceName = Astro.url.searchParams.get('service') ?? 'your service';

const formattedDate = startDateParam
  ? new Date(startDateParam).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  : null;

// If no bookingId at all, the user navigated here directly — show a generic page.
---
```

> **Headless note — two different `elevate`s, don't conflate them:**
> - **`@wix/essentials` `auth.elevate(fn)`** *works* in `@wix/astro` SSR and is the correct way to read data server-side (the listing + detail pages above use it for `services.queryServices`, and the CMS pages use it for `items.query`). It is **not** the thing that's unavailable.
> - **`wixClient.auth.elevate`** — the instance method on a hand-built `createClient({ auth: OAuthStrategy(...) })` — is what's unavailable in headless; that's a Wix-hosted Velo/Blocks API.
>
> This confirmation page deliberately doesn't re-fetch the booking at all: it renders from the URL params `ServiceBookingFlow` passes during the post-`createBooking` redirect (`?bookingId=...&startDate=...&service=...`). A server-side booking retrieval (e.g. for email receipts via a backend route + API key) is outside this skill's scope.

### Template

```astro
<Layout title="Booking Confirmed">
  <main class="py-4xl">
    <!-- `max-w-prose` (a Tailwind built-in literal = 65ch) instead of `max-w-xl`:
         arbitrary `max-w-<size>` keys can fall through to the spacing scale and
         collapse to a ~32px column. `max-w-prose` always resolves. -->
    <div class="mx-auto px-lg max-w-prose text-center">
      <!-- Success icon placeholder -->
      <div class="w-16 h-16 rounded-full bg-[--color-primary] flex items-center justify-center mx-auto mb-xl">
        <span class="text-white text-2xl">✓</span>
      </div>

      <h1 class="font-display text-4xl mb-md">You're booked!</h1>

      {formattedDate ? (
        <p class="text-secondary text-lg mb-xl">
          Your appointment for <strong>{serviceName}</strong> is confirmed
          for <strong>{formattedDate}</strong>. A confirmation email is on its way.
        </p>
      ) : (
        <p class="text-secondary text-lg mb-xl">
          Your booking is confirmed. Check your email for details.
        </p>
      )}

      <div class="flex flex-col gap-md items-center">
        <a href="/services" class="btn btn--primary">Browse More Services</a>
        <a href="/" class="text-secondary text-sm hover:text-primary">Return home</a>
      </div>
    </div>
  </main>
</Layout>
```

---

## Server endpoints + manage-booking page (verified live)

Some bookings operations require **Manage Bookings** scope and so **cannot** run from the browser `OAuthStrategy` client — they must be Astro **API routes** (`output: "server"`) that elevate to app identity. Elevation rule (important): `auth.elevate()` only grants permissions for a real **SDK function**; for raw REST with no SDK wrapper, elevate the authenticated fetch itself.

### `src/pages/api/confirm-booking.ts` — hold the seat (always, for create flows)
`createBooking` returns `CREATED`, which holds nothing. Confirm to occupy the seat + validate availability:
```typescript
import { auth } from "@wix/essentials";
import { bookings } from "@wix/bookings";
// POST { bookingId, revision }
await auth.elevate(bookings.confirmBooking)(bookingId, String(revision), {
  paymentStatus: "NOT_PAID",
  flowControlSettings: { checkAvailabilityValidation: true },
});
```

### `src/pages/api/waitlist.ts` — native waitlist (v1; no v2/v3 exists)
Register on the native waitlist when a session is full. Resolve a `contactId` (Contacts API, by email → create if missing), then `POST /bookings/v1/waitlist/register`. All via the **elevated authenticated fetch** (raw REST, so elevate `fetchWithAuth`, not a closure):
```typescript
import { auth, httpClient } from "@wix/essentials";
const ef = auth.elevate(httpClient.fetchWithAuth as typeof fetch) as typeof fetch;
const api = (url: string, body: unknown) =>
  ef(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// 1. contactId — query then create
let contactId = (await (await api("https://www.wixapis.com/contacts/v4/contacts/query",
  { query: { filter: { "info.emails.email": email } } })).json()).contacts?.[0]?.id;
if (!contactId) contactId = (await (await api("https://www.wixapis.com/contacts/v4/contacts",
  { info: { name: { first }, emails: { items: [{ email, primary: true }] } } })).json()).contact?.id;

// 2. register — waitingResource is the v1 session id from the SESSION_CAPACITY_EXCEEDED message
await api("https://www.wixapis.com/bookings/v1/waitlist/register", {
  waitingResource: sessionId,
  formInfo: {
    paymentSelection: [{ rateLabel: "general", numberOfParticipants: totalParticipants }],
    contactDetails: { contactId, firstName: first, email },
  },
});
```

### `src/pages/manage-booking.astro` + `ManageBooking.tsx` — view/cancel (anonymous-token flow)
A plain visitor token can't list/cancel bookings (`queryExtendedBookings`/`cancelBooking` are APP/MEMBER only). The supported visitor path is the **anonymous action token**: the page (SSR) elevates to **mint** a per-booking token, then the no-auth anonymous methods act on it (the token can safely go to the browser):
```typescript
// manage-booking.astro frontmatter — bookingId from ?bookingId=
const { token } = await auth.elevate(bookings.getAnonymousActionToken)(bookingId);   // APP identity → elevate
const { booking, allowedAnonymousActions } = await bookings.bookingsGetBookingAnonymously(token); // no auth
// Pass token + booking.revision + allowedAnonymousActions.cancel to a <ManageBooking client:only> island.
```
In the island (no-auth, visitor client OK):
```typescript
await wixClient.bookings.bookingsCancelBookingAnonymously(token, revision); // cancel
```
Reschedule-in-place uses `bookingsRescheduleBookingAnonymously(token, slot, { revision })`, but the CLASS `V2Slot` shape isn't fully pinned — prefer **cancel-and-rebook** (link to the service) unless you've verified the class slot shape live.

Link to it from the confirmation page: `/manage-booking?bookingId=<id>&service=<name>`.

---

## Navigation contribution

After writing your three route files, patch `src/layouts/Navigation.astro` to add the Services nav link. Insert at the `<!-- nav:links -->` marker:

```astro
<!-- nav:links -->
<a href="/services">Services</a>
```

Follow the marker discipline rules in `references/shared/IMPLEMENTER.md` — preserve the marker line, insert after it, do not disturb adjacent content.

---

## Home page contribution

Patch `src/pages/index.astro` to add a brief services teaser section. Insert at the `<!-- home:bookings -->` marker (added by the designer when bookings is loaded). The teaser should:
- Show the first 3 seeded services (read from `seeded.bookings.services` in `.wix/site.json`)
- Include a "View All Services" CTA linking to `/services`
- Use `<ServiceCard>` for each service entry

If the `<!-- home:bookings -->` marker is absent from the file, skip the home contribution — do NOT invent a new insertion point.

---

## Pre-return file-existence assertion

Before returning `status: "complete"`, verify all of these files exist on disk:
- `src/pages/services/index.astro`
- `src/pages/services/[slug].astro`
- `src/pages/booking-confirmation.astro`
- `src/components/ServiceBookingFlow.tsx`

Missing file → return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<path>" }]`.

---

## Return contract

```json
{
  "status": "complete",
  "phase": "pages",
  "vertical": "bookings",
  "files": [
    "src/pages/services/index.astro",
    "src/pages/services/[slug].astro",
    "src/pages/booking-confirmation.astro",
    "src/components/ServiceBookingFlow.tsx"
  ],
  "contributions": [
    { "file": "src/layouts/Navigation.astro", "marker": "nav:links" },
    { "file": "src/pages/index.astro", "marker": "home:bookings" }
  ]
}
```
