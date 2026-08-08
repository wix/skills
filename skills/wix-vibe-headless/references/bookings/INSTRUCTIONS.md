# Wix Bookings — ready-made client

The bookings client is **shipped as real files**, not snippets to regenerate. It's a complete
service catalog + detail page + slot picker + booking flow (create booking → hosted checkout),
styled with your app's design tokens (base44's `src/index.css` — the shadcn palette the design phase
already set). Copy it into the app and wire the routes —
you generate almost none of the booking code (the `{ services }` / `{ slots }` destructuring, the
local wall-clock date args, the null-slot re-validate guard, the participant cap, the eCom
redirect-session all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock
services or slots; never hand-build a `/checkout` URL — the shipped flow creates the booking through
the API and completes it via the eCom redirect-session.

## Prerequisites
- The site's **Wix Bookings** setup is the read/book target. It's installed and seeded separately
  (see **Seeding** below), in parallel with this build — so it may have no services at build time;
  the client renders the shipped empty state until services (and staff/working hours, so slots are
  bookable) land. This client is read-only over services — it does not provision them.
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).
- For **paid** services, the site must accept payments and the deployed app domain must be
  allow-listed on the OAuth client for the hosted checkout to return. Those are separate Wix setup
  flows the user completes later — out of scope here; if checkout return fails before that, it's
  expected, flag it and continue.

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole bookings UI client + REST scaffolds into
`src/` (imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map,
so you don't need to open them:**

| file | what it is |
|---|---|
| `hooks/useServices.js` | services-list data — one page + `loadMore` paging; `total === 0` → empty state |
| `hooks/useServiceDetail.js` | detail + booking flow — load service, list slots, hold slot/contact/participants, re-validate + book + checkout |
| `components/ServiceCard.jsx`, `ServiceGrid.jsx` | service listing UI (grid + card, with empty state) |
| `components/SlotPicker.jsx` | bookable-slot chips + paging (pure UI, driven by `useServiceDetail`) |
| `components/BookingForm.jsx` | contact + participant form (pure UI, driven by `useServiceDetail`) |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `pages/Services.jsx`, `pages/ServiceDetail.jsx` | the two shipped routes (`/services`, `/service/:serviceId`) |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` | REST transport — mints/persists the anonymous visitor token |
| `rest/wix-bookings-services.js` | services + availability: `queryServices`, `getService`, `countServices`, `listSlotsForService`, `listAvailableSlots`, `listEventTimeSlots`, `getAvailableSlot`, `mediaUrl` |
| `rest/wix-bookings-checkout.js` | booking + checkout: `createBooking`, `checkoutBooking`, `bookAndCheckout` |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each
is, and every field shape you need is in the snippets below. Read a shipped file's source **only**
on a real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at
the end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/bookings/app/` → `src/`.)

## STEP 2 — Credentials
Write `src/rest/wix-config.js` with your `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt — the
one place both ids live.

## STEP 3 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens
in `src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`,
`--muted`, `--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`,
`text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`,
`font-display`). Those tokens are **already set to the brand by the design phase**, so the shipped
pages are themed with zero work here. To adjust the palette, edit `index.css` (`:root` **and**
`.dark`) — the base44 way; **never add a parallel theme file (e.g. a `theme.css`) or restyle the
shipped JSX.** Build the Home/Header you add (STEP 4) from the **same** base44 tokens/classes so it
matches automatically. A dark brand is just base44's dark palette in `index.css` — no per-component work.

## STEP 4 — Wire routes (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it. Bookings needs **no cross-page provider** (there's no cart — each booking completes on
its own detail page), so there's nothing to wrap the tree in.
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Services` / `ServiceDetail` — so you **never edit the shipped pages to add
  a header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's **ResizeObserver-measured** height so it clears the chrome and
  self-corrects when the banner is dismissed.
- Routes under the Layout: `/services` → `Services`, `/service/:serviceId` → `ServiceDetail` (both
  shipped, as-is). **You add `/` → your own Home** page.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only · default export, no props
import Services from "@/pages/Services";               // shipped · default export, no props
import ServiceDetail from "@/pages/ServiceDetail";     // shipped · default export, no props
import Home from "@/pages/Home";           // YOU build
import Header from "@/components/Header";   // YOU build — plain in-flow markup, NOT position:fixed
import Footer from "@/components/Footer";   // YOU build

function Layout() {
  const topRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {                                  // measure the fixed region → pad content below it
    const ro = new ResizeObserver(() => setOffset(topRef.current?.offsetHeight ?? 0));
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);
  return (<>
    <div ref={topRef} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <WixManageBanner />                    {/* null in prod / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped Services/ServiceDetail render here, untouched */}
      <Footer />
    </div>
  </>);
}

<Routes>
  <Route element={<Layout />}>                                       {/* chrome wraps all */}
    <Route path="/" element={<Home />} />                            {/* yours */}
    <Route path="/services" element={<Services />} />                {/* shipped, as-is */}
    <Route path="/service/:serviceId" element={<ServiceDetail />} /> {/* shipped, as-is */}
  </Route>
</Routes>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** and a **`Footer`** — the two you drop into the
`Layout` (STEP 4) so they wrap every route — plus the overall brand story, styled with the same
base44 tokens/classes. **Compose the shipped pieces** — a "featured services" strip is just
`queryServices` + the shipped `ServiceGrid`; the nav is a link to `/services`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryServices } from "@/rest/wix-bookings-services";
import ServiceGrid from "@/components/ServiceGrid";

// Responsive header: choose ONE branch with a state flag (copy this pattern). Do NOT render a
// desktop nav AND a mobile nav toggled by Tailwind `hidden md:flex` / `md:hidden`: these navs are
// inline-styled, and an inline `display` beats a Tailwind class, so `hidden` never applies — BOTH
// branches render. One branch = one nav.
export function Header() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);            // keep it reactive to viewport changes
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* brand/logo */}
      {mobile ? <YourMenu /> : <Link to="/services">Services</Link>}
    </nav>
  );
}
export function Featured() {                                // on your home page
  const [services, setServices] = useState([]);
  // NB: queryServices returns { services, total, nextOffset } — destructure the array.
  useEffect(() => { queryServices({ limit: 6 }).then(({ services }) => setServices(services)); }, []);
  return <ServiceGrid services={services} empty="Services coming soon." />;
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev
preview can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a
fresh full navigate/reload of the preview and re-check — don't keep rewriting correct code against a
stale render.

## Using the client from your own UI
The two shipped hooks are the whole flow. If you build a custom surface, drive it the same way:

```jsx
// LIST — every list helper returns an OBJECT, not a bare array. Destructure it:
const { services, total, nextOffset } = await queryServices({ limit: 24 });   // total 0 → empty state
if ((await countServices()) === 0) { /* show the empty state — never invent services */ }

// DETAIL — getService(id) is keyed off the route param; returns null on a miss (not-found, never invent):
const service = await getService(serviceId);

// PRICE — payment.fixed.price.formattedValue is OPTIONAL; build from value+currency when missing:
const p = service.payment?.fixed?.price;
const price = p && (p.formattedValue
  || new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(Number(p.value)));

// IMAGE — the primary image is media.mainMedia; resolve through mediaUrl (Wix media can be a bare
// handle, not a full URL). Fall back to the gallery/cover:
const img = mediaUrl(service.media?.mainMedia?.image ?? service.media?.items?.[0]?.image ?? service.media?.coverMedia?.image);

// SLOTS — listSlotsForService routes by service.type and returns { slots, nextCursor }; iterate .slots.
// Dates are LOCAL wall-clock "YYYY-MM-DDThh:mm:ss" (NO zone / Z). The LIST call takes
// fromLocalDate/toLocalDate — the single-slot re-validate (getAvailableSlot) takes
// localStartDate/localEndDate. They are NOT interchangeable.
const { slots, nextCursor } = await listSlotsForService(service, { fromLocalDate, toLocalDate });

// BOOK — re-validate the picked slot (getAvailableSlot returns the slot or NULL — guard it), then
// book + check out and redirect. Participants: cap at
// service.bookingPolicy.participantsPolicy.maxParticipantsPerBooking (commonly 1 → no selector);
// never use slot.remainingCapacity as the per-buyer limit.
const fresh = await getAvailableSlot(service.id, { localStartDate, localEndDate });
if (!fresh) { /* "that time was just taken — pick another" */ }
const { checkoutUrl } = await bookAndCheckout(fresh, { email, firstName, lastName, phone }, { totalParticipants });
window.location.href = checkoutUrl;   // hosted checkout; on return the booking is CONFIRMED/PENDING
```

## Extending the client
The shipped flow covers **APPOINTMENT and CLASS** services (`listSlotsForService` routes by
`service.type`). For anything beyond that, add a helper on `wixApiRequest`, looking the endpoint up
in the **`wix-docs`** skill first (never guess):
- **COURSE** enrollment — a course is enrolled as a *whole*, not per session; `listEventTimeSlots`
  returns no slots for it, so the slot-picker flow doesn't apply (course-specific flow).
- **Service variants / participants** (duration- or person-based pricing), **add-ons**, and
  **custom booking form fields** (render `service.form.id`).
- **Member login + a "my bookings" view** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`): booking works anonymously, but signing a member in lets
  them see their own appointments.

Fallback only — when you hit an error or need something not shown here: read the relevant shipped
file under `src/`, or look it up via the **`wix-docs`** skill.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped
  `Services`/`ServiceDetail` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your
  `Header` is plain in-flow markup (not `position:fixed`).
- Send availability/booking dates as **local** `"YYYY-MM-DDThh:mm:ss"` strings + a `timeZone` — never
  UTC `Z` timestamps to the slot APIs.
- Re-validate the slot with `getAvailableSlot()` before booking; guard the `null` — slots get taken.
- Cap participants at `maxParticipantsPerBooking` (no selector when 1); never offer a fixed range and
  never use slot capacity as the per-buyer limit.
- Book only through the shipped flow (`bookAndCheckout` / `createBooking`→`checkoutBooking`) and
  redirect to the returned URL — never a hand-built `/checkout` or calendar URL.
- Render live Wix data or the shipped empty state — never mock services, slots, or availability, and
  never invent reviews, ratings, staff, or testimonials.

## Point the user to their dashboard
Provide deep links so the owner can manage bookings content (substitute the site's `metaSiteId`):
- **Booking Services** — `https://manage.wix.com/dashboard/{metaSiteId}/bookings/services` (add
  services and service categories)
- **Staff** — `https://manage.wix.com/dashboard/{metaSiteId}/bookings/staff` (add staff and set
  working hours, so slots are actually bookable)

## Seeding
Seed the services per `seed/SEED.md` (the build-time setup module) — separate from this client
build; run in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] **Opened `/services` and a service detail page** (not just the home page) and confirmed the shipped cards render themed (surface, text, brand color) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all
      routes; shipped `Services`/`ServiceDetail` untouched; content clears the fixed chrome.
- [ ] Visitor token persists across reload (same visitor identity across reloads).
- [ ] `queryServices()` renders live services; empty catalog shows the shipped empty state (no mock services).
- [ ] Slot picker shows real bookable slots; the slot is re-validated with `getAvailableSlot()` right before booking.
- [ ] Participant selector capped by `maxParticipantsPerBooking` (hidden when 1).
- [ ] Booking redirects to the hosted checkout URL the client returns; on return the booking is CONFIRMED/PENDING.
- [ ] No mock services, slots, or availability anywhere.
