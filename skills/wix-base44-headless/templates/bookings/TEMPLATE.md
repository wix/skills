# Bookings template — wiring

A working Wix Bookings core: services list + service detail + slot picker + booking + hosted
checkout, styled entirely from `theme.css` tokens. Covers **APPOINTMENT and CLASS** services (the
slot picker routes by `service.type`); COURSE (whole-course enrollment) is out of scope — see the
`wix-vibe-headless` bookings INSTRUCTIONS "Beyond the snippets".

Install + copy it in, theme the tokens, wire routes, seed. The hard logic (local-date/timezone
handling, participant cap, re-validate-before-book, create→checkout redirect) ships in the hook —
you build the **home/landing page, header/nav, and overall layout** yourself.

## Files the template ships (copied into `src/` by the install step below)
```
src/wix.config.json                 WIX_CLIENT_ID + WIX_METASITE_ID — the ONE file you fill
src/rest/wix-client.js              visitor-token transport (imports wix.config.json)
src/rest/wix-bookings-services.js   queryServices / getService / countServices / slots / mediaUrl
src/rest/wix-bookings-checkout.js   createBooking / checkoutBooking / bookAndCheckout
src/lib/format.js                   price + local-slot formatting
src/hooks/useServices.js            list + count (empty state)
src/hooks/useBookingFlow.js         service + slots + selection + participant cap + book
src/components/ServiceCard.jsx      grid tile
src/components/ServiceGrid.jsx      responsive grid + empty state
src/components/SlotPicker.jsx       slots grouped by day, selectable
src/components/BookingForm.jsx      contact form + participant selector + book button
src/pages/Services.jsx              catalog
src/pages/ServiceDetail.jsx         detail + booking flow (thin view over the hook)
src/theme.css                       THE styling surface — edit tokens, not components
```
(`seed/seed-bookings.js` stays in the skill — required at build time, step 4, not copied into the app.)
Imports use the `@/` alias (→ `src/`). No `@/` alias in the app? Add it to
`vite.config.js`/`jsconfig.json` or rewrite imports to relative paths.

**You build (not shipped):** the home/landing page (`/`), the header/nav, and the overall layout —
styled from the same `theme.css` tokens so it matches.

## 1. Install the skill + copy the template in (one exec_tool call — run as-is)
```js
const { execSync } = require('child_process');
const { cpSync, existsSync, readdirSync } = require('fs');

const out = execSync('CI=1 npx -y skills add wix/skills/skills/wix-base44-headless --yes 2>&1',
  { cwd: '/app', timeout: 60000, shell: '/bin/bash' }).toString();

const TPL = '/app/.agents/skills/wix-base44-headless/templates/bookings/src';
if (!existsSync(TPL)) throw new Error('bookings template missing');
cpSync(TPL, '/app/src', { recursive: true });   // overlays folders, leaves App.jsx alone

return { installed: /installed|found/i.test(out), src: readdirSync('/app/src') };
```

## 2. Credentials (one file)
Fill `src/wix.config.json` with `WIX_CLIENT_ID` and `WIX_METASITE_ID` from your prompt. The client
imports it (`wix-client.js`) and the seed step reads it — don't hardcode ids anywhere else.

## 3. Theme (this is the styling step — do ONLY this to the template components)
Edit `src/theme.css` tokens to the brand. Every component reads these vars, so this re-skins the
whole site. **Do not restyle the template components' JSX.** Style the home page / header you build
from the same tokens.

## 4. Wire routes (surgical `find_replace` on `src/App.jsx` — never rewrite it)
- `import "@/theme.css";` once at the app entry.
- Add the template routes `/services` → `Services`, `/service/:serviceId` → `ServiceDetail`. **You
  add `/` → your own Home** page and the header/nav.
- No global provider needed (each service page owns its own booking flow).

```jsx
import "@/theme.css";
import Services from "@/pages/Services";
import ServiceDetail from "@/pages/ServiceDetail";
import Home from "@/pages/Home";   // <- the home page YOU build

// inside the existing Router (keep platform AuthProvider/useAuth scaffolding intact):
<Routes>
  <Route path="/" element={<Home />} />                          {/* yours */}
  <Route path="/services" element={<Services />} />              {/* template */}
  <Route path="/service/:serviceId" element={<ServiceDetail />} />  {/* template */}
</Routes>
```

## 5. Seed (build-time, via exec_tool — see `seed/seed-bookings.js` header + SEED for exact calls)
```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const { WIX_METASITE_ID } = require("/app/src/wix.config.json");   // the file you filled in step 2
// Load the seed module (build-time; not shipped). exec_tool's plain `require` can return EMPTY
// exports for this file, so load it via a module wrapper:
const fs = require("fs");
const s = (() => { const m = { exports: {} };
  new Function("module", "exports", "require",
    fs.readFileSync("/app/.agents/skills/wix-base44-headless/templates/bookings/seed/seed-bookings.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// ONE call: install → resolve staff → categories → services → CLASS sessions → images, in the
// right order, ids kept in memory. `category` is a NAME. Free service: free:true, omit price.
await s.setupBookings(ctx, {
  services: [
    { type: "APPOINTMENT", name: "…", description: "…", price: 75, duration: 60, category: "Our Services" },
    { type: "CLASS", name: "…", description: "…", price: 20, capacity: 20, category: "Our Services",
      sessions: [{ start: "2026-08-10T09:00:00", end: "2026-08-10T10:00:00" }] },
  ],
});
```
Seeding is **additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, just add. Both bulk calls report per-item `success`/`error` — retry only failed items
once. Unexpected shape or an uncovered operation → the **`wix-docs`** skill; never guess.

## 6. Done
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
