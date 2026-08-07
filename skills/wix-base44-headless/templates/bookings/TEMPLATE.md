# Bookings template — wiring

A complete Wix Bookings front end: services list + service detail + slot picker + booking + hosted
checkout, styled entirely from `theme.css` tokens. Covers **APPOINTMENT and CLASS** services (the
slot picker routes by `service.type`); COURSE (whole-course enrollment) is out of scope — see the
`wix-vibe-headless` bookings INSTRUCTIONS "Beyond the snippets".

Copy it in, theme the tokens, wire 3 routes, seed. The hard logic (local-date/timezone handling,
participant cap, re-validate-before-book, create→checkout redirect) ships in the hook.

## Files (copy `templates/bookings/src/*` → the app's `src/`)
```
src/rest/wix-client.js              visitor-token transport (set WIX_CLIENT_ID here)
src/rest/wix-bookings-services.js   queryServices / getService / countServices / slots / mediaUrl
src/rest/wix-bookings-checkout.js   createBooking / checkoutBooking / bookAndCheckout
src/lib/format.js                   price + local-slot formatting
src/hooks/useServices.js            list + count (empty state)
src/hooks/useBookingFlow.js         service + slots + selection + participant cap + book
src/components/ServiceCard.jsx      grid tile
src/components/ServiceGrid.jsx      responsive grid + empty state
src/components/SlotPicker.jsx       slots grouped by day, selectable
src/components/BookingForm.jsx      contact form + participant selector + book button
src/pages/Home.jsx                  hero (rewrite copy) + services strip
src/pages/Services.jsx              catalog
src/pages/ServiceDetail.jsx         detail + booking flow (thin view over the hook)
src/theme.css                       THE styling surface — edit tokens, not components
seed/seed-bookings.js               build-time seed module (call its fns; see below)
```
Imports use the `@/` alias (→ `src/`). No `@/` alias in the app? Add it to
`vite.config.js`/`jsconfig.json` or rewrite imports to relative paths.

## 1. Credentials
In `src/rest/wix-client.js` set `WIX_CLIENT_ID` to the public client id from your prompt.

## 2. Theme (this is the styling step — do ONLY this)
Edit `src/theme.css` tokens to the brand. Every component reads these vars, so this re-skins the
whole site. **Do not restyle the components' JSX.** Rewrite the hero copy in `Home.jsx` — that's the
app-specific part.

## 3. Wire routes (surgical `find_replace` on `src/App.jsx` — never rewrite it)
- `import "@/theme.css";` once at the app entry.
- Add routes: `/` → `Home`, `/services` → `Services`, `/service/:serviceId` → `ServiceDetail`.
- No global provider needed (each service page owns its own booking flow).

```jsx
import "@/theme.css";
import Home from "@/pages/Home";
import Services from "@/pages/Services";
import ServiceDetail from "@/pages/ServiceDetail";

// inside the existing Router (keep platform AuthProvider/useAuth scaffolding intact):
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/services" element={<Services />} />
  <Route path="/service/:serviceId" element={<ServiceDetail />} />
</Routes>
```

## 4. Seed (build-time, via exec_tool — see `seed/seed-bookings.js` header + SEED for exact calls)
Order matters: **staff + category BEFORE services; class sessions AFTER.**
```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const s = require("/app/.agents/skills/wix-base44-headless/templates/bookings/seed/seed-bookings.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

await s.installBookingsApp(ctx);                          // if Wix Bookings isn't installed yet
const staff = await s.queryStaff(ctx);                    // fresh install has a default owner
const resourceId = staff[0].resourceId;                   // NB: resourceId, NOT id
const cats = await s.createCategories(ctx, ["Our Services"]);   // every service needs a category id
const services = await s.createServices(ctx, [
  { type: "APPOINTMENT", name: "…", description: "…", price: 75, duration: 60, categoryId: cats[0].id, staffMemberIds: [resourceId] },
  { type: "CLASS", name: "…", description: "…", price: 20, capacity: 20, categoryId: cats[0].id },
]);
await s.scheduleClassSessions(ctx, services.filter(x => x.type === "CLASS").map(x => ({
  scheduleId: x.scheduleId, resourceId, start: "2026-08-10T09:00:00", end: "2026-08-10T10:00:00", capacity: 20,
})));
// imagery ON only: generate images, then per-service revision-checked patch:
// await s.attachServiceImage(ctx, { serviceId: x.id, revision: x.revision, image: { id, url, width, height } });
```
Seeding is **additive** — never delete/overwrite existing content; if a cleanup seems needed, ask
first. Both bulk calls report per-item `success`/`error` — retry only failed items once. Unexpected
shape or an uncovered operation → the **`wix-docs`** skill; never guess.

## 5. Done
- Point the user to `https://manage.wix.com/dashboard/{metaSiteId}`; slots only appear once **staff
  working hours** are set. Dashboard deep links: services `…/bookings/services`, staff
  `…/bookings/staff`.
- Paid services need the site to accept payments and the app domain allow-listed on the OAuth client
  for checkout to return — separate Wix setup the user completes later; flag if checkout return fails.

## Verify
- `WIX_CLIENT_ID` set (not the placeholder); visitor token persists across reload.
- Services render live (empty state when `countServices()` is 0 — never mock services).
- Slot picker shows real bookable slots; the slot is re-validated with `getAvailableSlot()` right
  before booking; participant selector hidden when the policy max is 1.
- Book → hosted-checkout redirect (never a hand-built URL); confirmation on return.
