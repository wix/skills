# Bookings Pages — the SSR routes (astro)

The `pages` scope of the bookings vertical. You write the route files. The
**logic** is in `../../bookings/FLOW.md` (read it first); this doc is the astro
wiring + the gotchas. Read `references/shared/IMPLEMENTER.md` +
`references/shared/STYLING.md` first.

> **Start from the templates — don't re-author the SSR data access.** Examples at
> `<SKILL_ROOT>/references/astro/templates/bookings/`: `ServiceCard.astro`,
> `services/index.astro`, `services/[slug].astro`, `booking-confirmation.astro`.
> Read and adapt (copy, headings, styling); keep the SDK query shapes.

## Pages you write

| File | From template | Role |
|------|---------------|------|
| `src/pages/services/index.astro` | `…/services/index.astro` | SSR catalog grid (SEO). `queryServices` via ambient `@wix/essentials`. |
| `src/components/ServiceCard.astro` | `…/ServiceCard.astro` | static service card for the grid. |
| `src/pages/services/[slug].astro` | `…/services/[slug].astro` | SSR detail (SEO) + mounts `<ServiceBookingFlow client:only="react">` (APPOINTMENT/CLASS) **or `<CourseEnrollFlow>`** when `service.type === "COURSE"`. Also fetches the **booking-form schema** and passes `fields` to the island; for a course it also SSR-reads the session schedule + capacity (see rule 2b). |
| `src/pages/booking-confirmation.astro` | `…/booking-confirmation.astro` | confirmation — renders from the `service`/`startDate` query params (no re-fetch). |

Plus the nav/home links (shell chain — see below).

## astro-specific rules

1. **SSR reads use the ambient `@wix/essentials` client — never `OAuthStrategy`.**
   `const result = await auth.elevate(services.queryServices)({ query: { filter: { appId: BOOKING_APP_ID }, paging: { limit: 100 } }, conditionalFields: ["STAFF_MEMBER_DETAILS"] }).find();`
   Building `createClient({ auth: OAuthStrategy({ clientId: import.meta.env.* }) })`
   in frontmatter 500s in the deployed runtime (the env var is client-only).
   Always include **`appId`** in the filter. Single service by slug: the
   `.eq("mainSlug.name", slug).eq("appId", BOOKING_APP_ID).limit(1).find()` chain.
   The same elevation works for `services.queryLocations` and
   `categoriesV2.queryCategories` (used by the optional catalog filters, below).
1b. **Optional catalog filters (location + category) — auto-skip; see `../../bookings/FLOW.md` §7.**
   The catalog page reads `?locationId`/`?category` from the request URL and merges
   them into the **same** `queryServices` filter (location → `locations.business.id`
   $hasSome, or the synthetic `locations.type` mapping; category → `category.id` $eq).
   It SSRs `queryLocations()` (show the selector only when business+custom+customer
   count > 1) and `queryCategories().find()` (non-fatal — render without the bar on
   failure; show only when > 1 category). The chosen location is carried into the
   detail link (`ServiceCard` `locationId`/`locationType` props) so availability is
   scoped to it. Reference: `…/templates/bookings/services/index.astro`.
2. **The detail page fetches the booking-form schema server-side.** Read
   `service.form._id`'s form via `@wix/forms` (`auth.elevate(forms.getForm)(formId)`),
   read its **`form.formFields`** (the documented field array — `form.fields` is an
   internal runtime field, don't use it), run the `normalizeFormField` mapping from
   `…/services/[slug].astro` (it derives each field's render type **and** submission value
   type — including the multi-line address nested object, choice groups, number/date/file —
   so **render every field type; do not skip complex fields**), order by `steps[].layout`,
   and pass the array as `fields` into `<ServiceBookingFlow>`. Pass the full `service` too —
   the booking step reads its payment/policy.
   Also pass, through to `<ServiceBookingFlow>`: `service.staffMemberDetails?.staffMembers`
   (the staff picker — the service was queried with `STAFF_MEMBER_DETAILS`); the
   service's **business `locations`** — sourced from `auth.elevate(services.queryLocations)()`
   (the site's real business locations) intersected with the service's own location ids,
   NOT from `service.locations` alone (its ids can be ones the availability engine doesn't
   recognize → 0 slots) — so the calendar scopes availability to one location and avoids
   duplicate per-location slots (FLOW.md §7); and the `?locationId` read from the request
   URL (the picker's default).
2b. **COURSE detail branches — no calendar.** When `service.type === "COURSE"`, mount
   **`<CourseEnrollFlow>`** instead of `<ServiceBookingFlow>` (a course is enrolled as a
   whole series; there's no availability calendar). SSR-read the course's sessions +
   capacity in ONE elevated call — `auth.elevate(events.queryEvents)({ filter: { scheduleId:
   service.schedule._id }, cursorPaging: { limit: 100 } })` (`@wix/calendar`; **`_id`**, not
   `.id`) — derive capacity from the events' `remainingCapacity`/`totalCapacity`, the upcoming
   session list (⚠️ event `utcDate` is a **Date object** — `toISOString()` before comparing),
   staff (resources of type `1cd44cf8-…`), and location; pass them + the same `fields` into
   `<CourseEnrollFlow>`. `listEventTimeSlots` returns nothing for a course. Full recipe:
   `../../bookings/FLOW.md` §10; reference `…/templates/bookings/services/[slug].astro`.
3. **Only the read pages are SSR.** The detail page SSRs the service info for SEO,
   then the booking UI runs in the `client:only` island. Do not SSR availability.
4. **Confirmation renders from query params.** The booking step redirects with
   `?service=…&startDate=…`; render those. Do not re-fetch a stranger's booking
   from this public page.
5. **Two dirs deep** (`services/[slug].astro`) → import with `../../`, not `../../../`.

## Shell chain — nav + home (this scope patches shared files)

- **Navigation** — at `<!-- nav:links -->` in `src/components/Navigation.astro`,
  append a link to **`/services`** (label fitting the brand: "Book", "Services", "Appointments").
- **Home** — at `<!-- home:bookings -->` in `src/pages/index.astro`, add a short,
  brand-voiced CTA linking to **`/services`** (heading + a line + a button-styled
  link). Use the site's primary-action token (`--color-accent`). Do not list
  specific services or hardcode slugs — the catalog renders them live.
- Append at the markers; keep the markers; never replace other packs' insertions.

## Return
`{ status, phase, scope: "pages", summary, data, files, errors }`. Run the pre-return file-existence assertion (`../../bookings/INSTRUCTIONS.md`). If `index.astro`/`Navigation.astro` lacks its marker, return `status: "partial"` with the coded error.
