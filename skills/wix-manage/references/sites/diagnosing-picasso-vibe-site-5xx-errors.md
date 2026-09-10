---
name: "Diagnosing Picasso/Vibe Site 5xx Errors"
description: What to check (and what not to bother checking) when a published Wix Vibe/Picasso site (Astro SSR, editorType Picasso, URLs on wix-vibe-site.com or a connected custom domain) reports intermittent HTTP 500s under parallel load or right after a publish.
---
# Diagnosing Picasso/Vibe Site 5xx Errors

A published **Wix Vibe / Picasso** site (`GetSiteContext` shows `Editor Type: Picasso`) is server-rendered Astro on `@astrojs/cloudflare`, served through a Cloudflare Workers-for-Platforms dispatcher (`wix-hosting-dispatcher`, repo `wix-private/cloud-runtime:packages/generic-hosting/hosting-dispatcher`) — **not** the classic Editor/Velo hosting stack. If a report matches this signature, don't spend tool calls chasing it as an application bug:

- Serial requests after a short warm-up are all `200`.
- The same URLs under **parallel** requests, or **immediately after a publish**, intermittently return `500` with a bare `Internal Server Error` body.
- It self-heals within seconds without a republish.
- Wix real-time/app logs show **no application-level entry** for the failing requests — because when this happens, the failure is happening in the dispatcher's own Cloudflare Worker layer (or in the dispatched isolate being killed by Cloudflare), before/outside the site's own Astro/Velo code ever runs. There is nothing in the user's own app to log.

## Why this happens (confirmed root causes)

1. **Two unguarded await calls in the dispatcher could throw uncaught** (`DOMAINS_KV.get()` for URL→worker routing, `CF_RATE_LIMITER.limit()`), which skips every one of the dispatcher's own logging/BI calls too — not just the site's app log. Fixed in `wix-private/cloud-runtime#7753`.
2. **Every dispatched request is capped at `cpuMs: 1000, subRequests: 40`** (`hosting-dispatcher/src/index.ts`, unchanged since the dispatcher's original introduction in April 2025). Cloudflare throws an uncaught exception in the calling worker the instant a dispatched worker exceeds either limit — no graceful degradation. A cold Astro SSR isolate has to compile the whole SSR bundle before serving its first request, which eats into that same 1000ms CPU budget; a burst of parallel requests (or the first traffic right after a publish, when every isolate is cold) means more isolates paying that cold-compile tax concurrently, raising the odds any one of them trips the limit. This is a plausible explanation for higher steady-state error rates on data-heavier pages specifically (more subrequests fetching CMS/Bookings data per render). **Not fixed** — retuning these numbers is a reliability/cost tradeoff for the owning team (`ot-velo-runtime`), not a mechanical fix; flag it to them rather than trying to "solve" it yourself.

## What you can actually check via the MCP

- `Site Monitoring` (aggregate error-rate/backend-requests dashboards) is the **only** user-facing signal for this class of failure today — there is no live/per-request API to correlate a specific failed request with its cause at this hosting layer.
- Don't bother pulling Velo-specific diagnostics (e.g. sitemap/page-registration checks) for a Picasso/Vibe site's 5xx — the whole `list-sitemap-pages` / classic-Editor-runtime toolkit targets a different hosting stack and won't show anything relevant here.
- If asked to reproduce: hit the same URL serially first to warm isolates, then fire concurrent requests with distinct querystrings (to avoid any edge cache) — a handful of `500`s in the first parallel burst, clearing up within seconds, confirms this signature rather than a real app defect.

## Related

- `wix-private/cloud-runtime#7753` — fixes the uncaught-KV/rate-limiter-error half of this.
