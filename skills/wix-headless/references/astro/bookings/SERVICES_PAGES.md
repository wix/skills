# Bookings Pages — Phase 4

You are the Phase 4 Pages agent for the bookings vertical. Your scope: write three route files. Read `references/shared/IMPLEMENTER.md` + `references/shared/STYLING.md` first.

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
import { createClient, OAuthStrategy } from '@wix/sdk';

const wixClient = createClient({
  modules: { services },
  auth: OAuthStrategy({ clientId: import.meta.env.PUBLIC_WIX_CLIENT_ID }),
});

let serviceList: any[] = [];
try {
  // Use the object form — @wix/bookings services.queryServices does NOT use a builder chain.
  // Filter out hidden services (hidden: false).
  const result = await wixClient.services.queryServices({
    query: {
      filter: { hidden: false },
      paging: { limit: 100 },
    },
  });
  serviceList = result.items ?? [];
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
import { createClient, OAuthStrategy } from '@wix/sdk';

const { slug } = Astro.params;

const wixClient = createClient({
  modules: { services },
  auth: OAuthStrategy({ clientId: import.meta.env.PUBLIC_WIX_CLIENT_ID }),
});

let service: any = null;
try {
  // Use the object form with filter — NOT the builder chain.
  // services.queryServices() in @wix/bookings takes a query object, not a fluent builder.
  const result = await wixClient.services.queryServices({
    query: {
      filter: { "mainSlug.name": slug },
      paging: { limit: 1 },
    },
  });
  service = result.items?.[0] ?? null;
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
<Layout title={service.name ?? 'Service'}>
  <main class="py-4xl">
    <div class="container mx-auto px-lg max-w-4xl">
      <!-- Back link -->
      <a href="/services" class="text-secondary hover:text-primary text-sm mb-xl block">
        ← All Services
      </a>

      <!-- Service hero -->
      <div class="flex flex-col gap-xl md:flex-row md:gap-2xl mb-3xl">
        {imageUrl && (
          <div class="service-detail-image flex-shrink-0">
            <img src={imageUrl} alt={service.name} class="w-full h-64 object-cover rounded-lg" />
          </div>
        )}
        <div class="flex flex-col gap-md flex-1">
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
      </div>

      <!-- Booking flow — client-side islands -->
      <section class="border-t border-[--color-border] pt-2xl">
        <h2 class="font-display text-2xl mb-xl">Book This Service</h2>
        <ServiceBookingFlow
          serviceId={service._id}
          serviceName={service.name ?? 'this service'}
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
}

export default function ServiceBookingFlow({ serviceId, serviceName }: Props) {
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
        onSlotSelected={setSelectedSlot}
      />
    );
  }

  return (
    <BookingForm
      serviceId={serviceId}
      serviceName={serviceName}
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
// We do NOT re-fetch the booking via SDK here — getBooking() requires elevated
// server-side permissions not available in OAuthStrategy (headless).
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

> **Headless note**: `wixClient.auth.elevate` is not available with `OAuthStrategy` in a self-hosted headless project. To show booking details on the confirmation page, pass them as URL query params from the client during redirect. If you need server-side booking retrieval (e.g. for email receipts), use a dedicated backend route with a Wix API key — that pattern is outside the scope of this skill.

### Template

```astro
<Layout title="Booking Confirmed">
  <main class="py-4xl">
    <div class="container mx-auto px-lg max-w-xl text-center">
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
