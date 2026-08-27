# Bookings — seeding

Seed by **running `seed-bookings.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Bookings app if needed, resolves a staff resource (polling — a fresh
install provisions the owner asynchronously), and creates everything in the right order.

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/bookings/seed/seed-bookings.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3 services** (the seed
shows the shape; the owner adds the rest in the dashboard) and make them exercise the UI:
mix APPOINTMENT and CLASS when it fits the business, include ≥1 free/pay-in-person service,
and give every service an image — the default is an `imagePrompt` (AI-generated, ~1 Wix AI
credit per image, account-billed): brand-contextual — subject, aesthetic/mood, palette,
lighting — always ending "no text, no watermarks". For an asset the user actually supplied use `imagePath` (a file on this
machine — uploaded to Wix Media) or `imageUrl` (their own hosted URL; verify it with
`curl -sI` → 200) — never a stock-photo or guessed URL. Images resolve in parallel and never block the seed; a failed
image leaves that service text-only.

```json
{
  "services": [
    { "type": "APPOINTMENT", "name": "Deep Tissue Massage", "tagLine": "60 minutes of relief",
      "description": "…", "price": 85, "duration": 60, "category": "Massage",
      "imageUrl": "https://…" },
    { "type": "APPOINTMENT", "name": "Intro Consultation", "description": "…", "free": true,
      "duration": 30, "category": "Massage", "imageUrl": "https://…" },
    { "type": "CLASS", "name": "Morning Yoga", "description": "…", "price": 20, "capacity": 12,
      "category": "Classes", "imageUrl": "https://…",
      "sessions": [
        { "start": "2026-09-01T09:00:00", "end": "2026-09-01T10:00:00" },
        { "start": "2026-09-03T09:00:00", "end": "2026-09-03T10:00:00" }
      ] }
  ]
}
```

- `type` — `APPOINTMENT` (visitor picks a free slot; needs `duration` in minutes) or `CLASS`
  (fixed `sessions` you schedule here — **future local wall-clock** `YYYY-MM-DDThh:mm:ss`, no Z;
  a CLASS without sessions shows no bookable times).
- `price` — a number; omit or `free: true` → a no-fee, pay-in-person service (books without
  checkout). The site currency wins over `currency`.
- `category` — a name; created idempotently. Every service gets one (required for live-site
  visibility) — uncategorized services fall into a default "Services" category.
- Staff: appointments are auto-assigned to the site's default staff resource; the flow books
  with ANY_RESOURCE when the visitor doesn't choose.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Escape hatch — individual functions
`setupBookings` composes exported steps — `installBookingsApp`, `queryStaffWithRetry`,
`createCategories`, `createServices`, `scheduleClassSessions`, `importImage`,
`attachServiceImage`, plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipe is `wix-headless/references/inline-recipes/setup-bookings.md`.
