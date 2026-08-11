# Wix Events — ready-made client

The events client is **shipped as real files**, not snippets to regenerate. It's a complete events
listing + detail page + RSVP + ticketing (reserve → hosted checkout, plus in-app free-ticket
checkout), styled with your app's design tokens (base44's `src/index.css` — the shadcn palette the
design phase already set). Copy it into the app and wire the routes — you generate almost none of the
events code (offset paging, category filtering, the RSVP `WAITLIST` case, the ticket
reservation/checkout shapes all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock events;
never hand-build a registration/ticket/checkout URL — RSVP completes client-side and paid tickets go
through the Wix-hosted ticket form via the shipped reserve → redirect path.

## Prerequisites
- The site's **Wix Events & Tickets** app is the read/registration target. It's installed and seeded separately (see **Seeding** below), in parallel with this build — so it may have no events at build time; the client renders the shipped empty state until events are published. This client is read-only over events (it does not create them).
- The public headless **`WIX_CLIENT_ID`** from your prompt (visitor-facing, safe to hardcode/commit).
- Selling **paid** tickets also needs a Wix premium plan + a configured payment method on the site; **free** events and RSVP events work without. For paid tickets the buyer completes payment on the Wix-hosted ticket form; the deployed app domain may need to be allow-listed on the OAuth client for the return to land cleanly — a separate Wix setup the user completes later, out of scope here.

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole events UI client + REST scaffolds into `src/`
(imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map, so you
don't need to open them:**

| file | what it is |
|---|---|
| `hooks/useEventsList.js` | listing logic — categories, active filter, offset "load more", empty count |
| `hooks/useEventDetail.js` | detail data for a slug — event + derived `type`/`open` registration state |
| `hooks/useRsvpForm.js` | RSVP submit logic (`YES`/`NO`, additional guests, `WAITLIST` result) |
| `hooks/useTicketing.js` | ticket selection + reserve → paid redirect / free in-app checkout |
| `components/EventCard.jsx`, `EventGrid.jsx` | event listing UI (grid + card, with empty state) |
| `components/CategoryFilter.jsx` | category menu (renders `label` + `assignedEventsCount`) |
| `components/EventRegistration.jsx` | branches on `registration.type` (RSVP / TICKETING / EXTERNAL / NONE) |
| `components/RsvpForm.jsx` | RSVP form UI over `useRsvpForm` |
| `components/TicketPicker.jsx` | ticket list + quantity + checkout UI over `useTicketing` |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `pages/Events.jsx`, `pages/EventDetail.jsx` | the two shipped routes (`/events`, `/events/:slug`) |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` | visitor-token mint/refresh + REST transport (reads `wix-config.js`) |
| `rest/wix-events-browse.js` | browse/discovery helpers (`queryEvents`, `getEventBySlug`, categories, count) |
| `rest/wix-events-registration.js` | RSVP + ticketing helpers (`createRsvp`, `reserveTickets`, `getTicketCheckoutUrl`, `checkoutTickets`) |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each is
and every field shape you need is in the snippets below. Read a shipped file's source **only** on a
real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/events/app/` → `src/`.)

## STEP 2 — Credentials
Write `src/rest/wix-config.js` with your `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt — the
one place both ids live. The visitor refresh token minted from this id is persisted to localStorage
and **is** the identity of the visitor's ticket reservation — don't re-mint anonymously per load.

## STEP 3 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens in
`src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`, `--muted`,
`--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`, `text-foreground`,
`bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`, `font-display`). Those tokens
are **already set to the brand by the design phase**, so the shipped pages are themed with zero work
here. To adjust the palette, edit `index.css` (`:root` **and** `.dark`) — the base44 way; **never add
a parallel theme file (e.g. a `theme.css`) or restyle the shipped JSX.** Build the Home/Header you add
(STEP 4) from the **same** base44 tokens/classes so it matches automatically. A dark brand is just
base44's dark palette in `index.css` — no per-component work.

## STEP 4 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it. (Events needs no cross-page provider — there's no cart; the RSVP/ticketing state is local
to the detail page.)
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Events` / `EventDetail` — so you **never edit the shipped pages to add a
  header/footer** (they render inside `<Outlet/>` as-is).
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's **ResizeObserver-measured** height so it clears the chrome and
  self-corrects when the banner is dismissed.
- Routes under the Layout: `/events` → `Events`, `/events/:slug` → `EventDetail` (both shipped, as-is).
  **You add `/` → your own Home** page.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only · default export, no props
import Events from "@/pages/Events";                   // shipped · default export, no props
import EventDetail from "@/pages/EventDetail";         // shipped · default export, no props
import Home from "@/pages/Home";       // YOU build
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
      <Outlet />                             {/* shipped Events/EventDetail render here, untouched */}
      <Footer />
    </div>
  </>);
}

<Routes>
  <Route element={<Layout />}>                                {/* chrome wraps all */}
    <Route path="/" element={<Home />} />                     {/* yours */}
    <Route path="/events" element={<Events />} />             {/* shipped, as-is */}
    <Route path="/events/:slug" element={<EventDetail />} />  {/* shipped, as-is */}
  </Route>
</Routes>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** and a **`Footer`** — the two you drop into the `Layout`
(STEP 4) so they wrap every route — plus the overall brand story, styled with the same base44
tokens/classes. **Compose the shipped pieces** — a "featured events" strip is just `queryEvents` + the
shipped `EventGrid`; the nav is a link to `/events`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryEvents } from "@/rest/wix-events-browse";
import EventGrid from "@/components/EventGrid";

// Responsive header: choose ONE branch with a state flag (copy this pattern). Do NOT render a
// desktop nav AND a mobile nav toggled by Tailwind `hidden md:*` — these navs are inline-styled and
// an inline `display` beats a Tailwind class, so `hidden` never applies and BOTH branches render.
export function Header() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);             // keep it reactive to viewport changes
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* brand/logo */}
      {mobile ? <YourMenu /> : <Link to="/events">Events</Link>}
    </nav>
  );
}

export function Featured() {                                 // on your home page
  const [events, setEvents] = useState([]);
  // NB: queryEvents returns { events, total, offset, nextOffset } — destructure the array.
  useEffect(() => { queryEvents({ limit: 6 }).then(({ events }) => setEvents(events)); }, []);
  return <EventGrid events={events} empty="Events coming soon." />;
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages automatically.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI

```jsx
// Every browse list helper returns an OBJECT { events, total, offset, nextOffset } — not a bare
// array. Destructure `events`; nextOffset is null when there are no more pages.
import { queryEvents, getEventBySlug, queryEventCategories, listEventsByCategory, countUpcomingEvents } from "@/rest/wix-events-browse";

const { events, nextOffset } = await queryEvents({ limit: 24 });          // live UPCOMING/STARTED, soonest first
const { categories } = await queryEventCategories();                       // render category.label (NOT name)
const { events: inCat } = await listEventsByCategory(categories[0].id);    // same shape + paging as queryEvents
const total = await countUpcomingEvents();                                 // 0 → shipped empty state

// Detail by slug — returns null on miss (the shipped EventDetail shows a not-found state):
const event = await getEventBySlug(slug);

// Image urls live at event.mainImage.url. shortDescription is a PLAIN string (safe to render).
// event.description is Ricos rich content { nodes: [...] } — NOT a string; render with @wix/ricos or
// walk nodes; NEVER call string methods (.slice/.split) on it — that crashes the page.
```

The registration flows are already wired in the shipped `EventRegistration` (branches on
`registration.type`, respects `registration.status` — only `OPEN_*` accepts registrations), so your
pages just render `<EventRegistration .../>` as the shipped `EventDetail` does. Doing a flow yourself:

```jsx
import { createRsvp, reserveTickets, getTicketCheckoutUrl, checkoutTickets } from "@/rest/wix-events-registration";

// RSVP (client-side): status "NO" only when registration.rsvp.responseType === "YES_AND_NO".
const rsvp = await createRsvp(event.id, { firstName, lastName, email });   // rsvp.status may be "WAITLIST"

// PAID tickets: reserve, then redirect to the Wix-hosted ticket form — NEVER a hand-built URL.
const reservation = await reserveTickets([{ ticketDefinitionId, quantity: 1 }]);
window.location.href = getTicketCheckoutUrl(event, reservation.id);

// FREE tickets only: finish in-app instead of redirecting (throws if payment is owed).
const order = await checkoutTickets(event.id, { reservationId: reservation.id, buyer, guests: [buyer] });
```

## Extending the client
Building something beyond the shipped pages (a "my registrations" account view, coupons, seating
maps, a schedule/agenda, canceling a reservation)? The helpers cover the common RSVP + ticketing
paths; for a gap, make the call with `wixApiRequest` — but look up the exact endpoint/body in the
official Wix Events API reference first, never guess:
- Events API reference: https://dev.wix.com/docs/api-reference/business-solutions/events.md
- Registration (RSVP + ticketing): https://dev.wix.com/docs/api-reference/business-solutions/events/registration/introduction.md
- Member login + "my registrations" → the **members** vertical (`references/members/INSTRUCTIONS.md`).

Fallback only — when you hit an error or need something not shown here: read the relevant shipped file
under `src/`, or look it up via the **`wix-docs`** skill.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped `Events`/`EventDetail` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your `Header` is plain in-flow markup (not `position:fixed`).
- Paid ticket checkout goes through the shipped reserve → `getTicketCheckoutUrl` redirect (the Wix-hosted ticket form) — never a hand-built registration/ticket/payment URL.
- Render live Wix data or the shipped empty/closed/not-found state — never mock events, tickets, guest counts, or "X spots left".

## Point the user to their dashboard
Provide deep links so the owner can edit content (substitute the site's `metaSiteId`):
- **Events** — `https://manage.wix.com/dashboard/{metaSiteId}/events` (`Dashboard → Events` → **+ Add Event**; create the event, then set it up as **Ticketed** or **RSVP**; only published events appear in the app)

## Seeding
Seed events per `seed/SEED.md` (the build-time setup module) — separate from this client build; run in
parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] Opened the vertical's data route(s) (not just the home page) and confirmed the shipped components render themed (surface, text, brand) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all routes; shipped `Events`/`EventDetail` untouched; content clears the fixed chrome.
- [ ] Event grid renders live events; clicking a card opens the detail page by `slug`; visitor token persists across reload.
- [ ] Detail page branches correctly on `registration.type` (RSVP form vs. ticket picker vs. external link vs. none); closed registration / sold-out tickets show a clear state.
- [ ] RSVP submit creates a real RSVP (and surfaces a `WAITLIST` result when full); paid ticket purchase reserves then redirects via `getTicketCheckoutUrl`.
- [ ] Empty catalog shows the shipped empty state (`countUpcomingEvents()` is 0); no mock events anywhere.
