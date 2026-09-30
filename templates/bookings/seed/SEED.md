# Bookings — seeding

Seed by **running `seed-bookings.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Bookings app if needed, resolves the staff resources (polling — a fresh
install provisions the owner asynchronously; extra staff named in the plan are created), creates
the extra locations and booking policies the plan asks for, and creates everything in the right order.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/bookings/seed/seed-bookings.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3–4 services** (the seed
shows the shape; the owner adds the rest in the dashboard) and make them exercise the UI:
mix APPOINTMENT, CLASS, and COURSE when it fits the business, include one of each price type the
brief allows (a fixed price, a free/pay-in-person one, a "From" price, a quote), and give every
service an image — the default is an `imagePrompt` (AI-generated, ~1 Wix AI credit per image,
account-billed): brand-contextual — subject, aesthetic/mood, palette, lighting — always ending
"no text, no watermarks". At least one image in the set shows the real subject of the business —
the actual product/space/service, not abstract decoration. For an asset the user actually supplied
use `imagePath` (a file on this machine — uploaded to Wix Media) or `imageUrl` (their own hosted
URL; verify it with `curl -sI` → 200) — never a stock-photo or guessed URL. Images resolve in
parallel and never block the seed; a failed image leaves that service text-only.

```json
{
  "staff": ["Maya Lin"],
  "locations": [{ "name": "Downtown studio", "timeZone": "America/New_York",
                  "address": { "formattedAddress": "12 5th Street, New York", "city": "New York", "country": "US" } }],
  "services": [
    { "type": "APPOINTMENT", "name": "Deep Tissue Massage", "tagLine": "60 minutes of relief",
      "description": "…", "price": 85, "duration": 60, "category": "Massage", "deposit": 20, "payInFull": true,
      "staff": "Maya Lin", "imageUrl": "https://…" },
    { "type": "APPOINTMENT", "name": "Intro Consultation", "description": "…", "free": true,
      "duration": 30, "category": "Massage", "requireManualApproval": true, "imageUrl": "https://…" },
    { "type": "APPOINTMENT", "name": "Custom Treatment", "description": "…", "priceText": "Ask for a quote",
      "duration": 90, "category": "Massage", "location": "Downtown studio", "imageUrl": "https://…" },
    { "type": "CLASS", "name": "Morning Yoga", "description": "…", "price": { "from": 20 }, "capacity": 12,
      "waitlist": 4, "maxParticipants": 3, "category": "Classes", "conferencing": true, "imageUrl": "https://…",
      "weekly": { "days": ["MONDAY", "WEDNESDAY"], "time": "09:00", "duration": 60, "start": "2026-10-05", "end": "2026-12-20" },
      "sessions": [{ "start": "2026-10-03T09:00:00", "end": "2026-10-03T10:00:00" }] },
    { "type": "COURSE", "name": "6-Week Pottery Course", "description": "…", "price": 240, "capacity": 8,
      "category": "Courses", "imageUrl": "https://…",
      "weekly": { "days": ["TUESDAY"], "time": "18:00", "duration": 120, "start": "2026-10-06", "end": "2026-11-10" } }
  ]
}
```

- `type` — `APPOINTMENT` (visitor picks a free slot; needs `duration` in minutes), `CLASS` (fixed
  sessions the visitor picks one of), or `COURSE` (the visitor books the whole series; no slot
  picking). Classes and courses get their sessions from `weekly` and/or `sessions`:
  - `weekly` — `{ days: ["MONDAY", …], time: "18:00", duration: 60, start: "YYYY-MM-DD", end: "YYYY-MM-DD" }`
    creates one recurring session per weekday from the first such day on/after `start` until `end`.
    This is what makes a course bookable and what the listing shows as "Mon, Wed". **A course needs
    `weekly`** (its seats and dates come from the recurring sessions).
  - `sessions` — one-off class sessions, **future local wall-clock** `YYYY-MM-DDThh:mm:ss`, no Z.
  - A class with neither shows no bookable times.
- `price` — a number → a fixed price; `{ "from": 30 }` → varied pricing shown as "From €30";
  `priceText: "Ask for a quote"` → a custom price (text, pay in person); omit or `free: true` → a
  no-fee, pay-in-person service (books without checkout). The site currency wins over a per-service
  `currency`. `deposit: 20` makes the service take a deposit (fixed or varied prices only);
  `payInFull: true` also lets the visitor pay everything upfront.
- `currency` — 3-letter ISO code at the top of the plan, set **only when the brief names one**: a
  sentence about currency, or a price written with its unit ("9 dollars", "$9", "€20"). Do **not**
  infer it from a language, a country, or an address. The seed sets the site to it before creating
  anything, because prices are stored in the site currency at create time; a new site starts in the
  currency of the account that created it, not the business's.
- `capacity` — seats per session (classes) or for the whole series (courses); appointments are 1.
  `waitlist: 4` adds a waitlist of that size and `maxParticipants: 3` caps seats per booking — both
  create a booking policy for that service.
- `requireManualApproval: true` — bookings are requests the owner approves (the CTA reads "Request to
  book"). `conferencing: true` — sessions carry a video link (the tile shows "Online").
- `category` — a name; created idempotently. Every service gets one (required for live-site
  visibility) — uncategorized services fall into a default "Services" category.
- `staff` — top-level `["Name", …]` creates staff members (idempotent by name); a service's `staff`
  (a name or names) assigns them to an appointment and puts their sessions on that person. Without
  it, appointments go to the site's default staff resource; the flow books with ANY_RESOURCE when
  the visitor doesn't choose. Staff photos and working hours are dashboard work — say so.
- `locations` — top-level `[{ name, timeZone, address? }]` creates extra business locations
  (idempotent by name; `timeZone` is required by the API); a service's `location` (a name from that
  list) puts it there — the listing then offers a location filter. Without it, services sit at the
  default business location.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For bookings, each service the
user lists is one entry. Its name becomes `name` and its length in minutes becomes `duration`. Its
price becomes `price` ("from €30" → `{ "from": 30 }`; "on request" → `priceText`); a service marked
free, or with no price, gets `"free": true`. A group activity with a capacity or fixed times becomes
a `CLASS` with `capacity` and `weekly` (recurring days) or one `sessions` entry per listed time; a
multi-week series with a start and an end becomes a `COURSE` with `weekly`; everything else is an
`APPOINTMENT`. A category or group becomes `category`; a named practitioner becomes `staff`; a named
branch becomes `location` (+ a `locations` entry with its time zone). Their photo becomes
`imageUrl`. A service with no duration is a question for the user. Opening hours are not seeded —
say so; the owner sets them in the dashboard.

## Escape hatch — individual functions
`setupBookings` composes exported steps — `installBookingsApp`, `queryStaffWithRetry`, `createStaff`,
`createLocations`, `createBookingPolicy`, `createCategories`, `createServices`, `scheduleEvents`
(`weeklyEvents` builds the recurring ones), `importImage`, `attachServiceImage`, plus `makeCtx()` —
import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page.
