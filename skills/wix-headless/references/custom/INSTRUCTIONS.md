---
name: custom-frontend
description: "Frontend-track playbook for integration mode (frontend = custom). The user brings a finished, working frontend (HTML+CSS/JS from Claude Design or any tool) and asks to connect it to Wix. This track connects the site to a live Wix backend — wiring existing dynamic regions to @wix/sdk and, when the design has none, augmenting it with the connected feature its purpose implies — then publishes via a no-build wix release. Input-general: the site itself is the primary signal, never any one tool's bundle format."
---

# Custom frontend — integration mode

The user already built a working website **outside** this skill (Claude Design, v0, Lovable, a static-site generator, or hand-coding) and wants it connected to Wix. The skill does **not** design or scaffold anything here — it **connects the brought-in site to a live Wix backend** and publishes it.

This is the frontend-track entry doc for `frontend = "custom"`. The **business track is unchanged** — Setup (`SETUP.md`) and Seed (`SEED.md`) run their normal frontend-blind path; only this frontend track differs from astro.

## Two locked principles

1. **Always connect.** Every integration run must end with the site reading from or writing to Wix. `init` + `release` of a static page with **no** backend connection is **not** an acceptable outcome — that is just hosting static HTML, which is not the point. If the design has no dynamic region to wire, **add** the connected feature its purpose implies (see § "Always connect").
2. **Input-general.** The skill connects *whatever* the user brings — it is **not** a Claude-Design integration. The **primary signal is always the site itself** (markup, copy, CSS tokens, file/route layout), which every input has. A Claude-Design handoff bundle (`README.md` + `chats/` transcript + `project/*.html`), when present, is **opportunistic enrichment** — read it to sharpen intent inference, but never require it.

## The technical spine (read before wiring)

A brought-in static site connects to Wix with the **browser SDK + visitor session** — no `@wix/astro`, no server runtime, no middleware:

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk";
  import { submissions } from "https://esm.sh/@wix/forms";   // or @wix/stores, @wix/blog, @wix/data
  const wix = createClient({
    modules: { submissions },
    // clientId === appId from wix.config.json (init sets WIX_CLIENT_ID = appId)
    auth: OAuthStrategy({ clientId: "<appId from wix.config.json>" }),
  });
  // OAuthStrategy mints + caches visitor tokens in the browser — no cookie plumbing of our own.
  // …read (queryProducts / queryPosts / query items) or write (createSubmission) against Wix.
</script>
```

This covers reads (products, posts, CMS items) **and** writes (form submissions) and cart-via-redirect. The published origin is already allow-listed on the OAuth app by `init`, so the visitor flow works from the deployed URL with no extra call.

> **`@wix/sdk` is loaded from a CDN (`esm.sh`), pinned by version in the import URL.** No `npm install`, no bundler — the HTML *is* the deployable. Setup's per-pack `npm install` step does **not** run for custom.

## The flow

The conductor interleaves these; the business track (steps 3–5) runs frontend-blind, concurrent with the connection-plan pass (step 2).

1. **Discovery (already done by the conductor).** `DISCOVERY.md` parsed the site, inferred the **domain**, derived the Wix **capability + apps**, and got approval. The resolved capability list + the site's file/token map arrive here.
2. **Connection plan** — read the site and emit the binding map (existing dynamic regions) + the augmentation spec (the connected component to add). See `references/custom/CONNECTION_PLAN.md`.
3. **Init** — `npm create @wix/new@latest init` (non-interactive when logged in) writes `wix.config.json` (`Site`, `appId`, `siteId`, `site.outputDirectory`). **Point `outputDirectory` at the dir holding the entry HTML** (init defaults it to `./dist`; fix it to where the brought-in `index.html` actually lives). Source files untouched.
4. **Setup (shared business track, `SETUP.md`)** — install the inferred apps (app-install curl, with `x-wix-request-id` capture per the project policy), `env pull`. **Skip** the per-pack `npm install` (CDN imports).
5. **Seed (shared business track, `SEED.md`) — DISPATCH seeders as subagents.** Same per-pack dispatch model as astro: one seeder subagent per capability with a seed recipe, fired as a concurrent background batch. Each creates the backend its capability needs — the **Wix Form definition** (forms), a **CMS collection + items** (cms), sample products/posts (stores/blog) — and returns the IDs / form IDs. **Do not seed inline:** the seeder count scales with the brought-in site's content (unpredictable), so inlining serializes the work and bloats the orchestrator context. Seeded IDs flow into wiring.
6. **Wiring — writer count is a RUNTIME decision keyed on file topology.** Each capability's `references/custom/<capability>/WIRING.md` is the how-to (wire existing regions to `@wix/sdk` reads, and inject the connected component — e.g. an RSVP `<form>` → `@wix/forms createSubmission` — styled from the design's CSS tokens; additive, never restructure). But **how many writers run depends on whether capabilities share a file**: a single brought-in `index.html` carrying several capabilities (a form *and* a feedback list) must be wired by **one writer** (inline or a single subagent handling all of them) — **never parallel agents on the same file**, or they clobber each other and double the SDK bootstrap. Only capabilities mapping to *distinct* files may be wired by parallel subagents. (Contrast with **seeding**, which always dispatches — backend work, no shared file.)
7. **Release (inline, NO build)** — run `npx @wix/cli@latest release` directly from the project dir. **Do not run `wix build`** — there's nothing to build (it's astro-only) and the static `outputDirectory` is already the deployable. Extract the published URL from `Site published on <url>`; retry transient release errors serially (`references/shared/PRODUCTION_SHARP_EDGES.md`). Emit the production + dashboard URLs. (`BUILD.md` § "Integration mode" step 5 owns the exact run-flow.)

## Always connect: design intent → Wix capability

`DISCOVERY.md` infers the domain and picks the capability; this table is the shared source of truth. **Wix Forms is the universal floor** — when nothing richer fits, a domain-appropriate form is the minimum viable connection.

| Inferred domain | Connected feature (wire and/or add) | App(s) | Wiring guide |
|---|---|---|---|
| Wedding / event invitation | **RSVP form** (+ optional responses CMS) | Wix Forms (+ CMS) | `custom/forms/WIRING.md` |
| Store / product mock | product catalog (wire existing grid) | Wix Stores + eCom | `custom/stores/WIRING.md` |
| Blog / publication | post list + detail (wire existing) | Wix Blog | `custom/blog/WIRING.md` |
| Restaurant / venue landing | reservation / contact form; optional menu CMS | Wix Forms (+ CMS) | `custom/forms/WIRING.md` |
| SaaS / product landing | lead / waitlist signup form | Wix Forms | `custom/forms/WIRING.md` |
| Portfolio / agency | contact form; optional projects CMS | Wix Forms (+ CMS) | `custom/forms/WIRING.md` |
| Anything else | contact form (the floor) | Wix Forms | `custom/forms/WIRING.md` |

> **Reconciling "connect, don't design."** Augmentation injects the **one connected component** the backend connection requires (an RSVP/lead/contact `<form>`), styled from the design's tokens so it reads as native. It does **not** redesign or re-lay-out the site. "Connecting the dots" includes adding the one dot the design omitted.

## Wiring discipline (applies to every `custom/<cap>/WIRING.md`)

- **Additive only.** Never restructure the user's layout or CSS. Swap the *data source* behind a region; inject new components self-contained.
- **Style from the design's tokens.** Read the site's CSS custom properties (`:root { --… }`) and reuse them verbatim in any injected component so it looks designed-in.
- **Inline `appId` literally** from `wix.config.json` as the `OAuthStrategy` `clientId`. No env vars at runtime.
- **One `<script type="module">` per capability** (or a shared client bootstrap + per-region render calls).
- **Guard every SDK call** in try/catch. On a read error, leave the original sample markup visible; the injected component degrades gracefully if the backend is unreachable.

## Scope — deferred (tell the user plainly when relevant)

- **Member authentication** (login/logout, member-gated content) — needs the server OAuth callback routes `@wix/astro` provides; not possible on a pure static site.
- **SSR cart/session persistence across reload** — client-side cart works via `@wix/ecom` + checkout redirect; cookie-backed persistence needs the server runtime.
- **`auth.elevate` CMS queries** — elevation needs the app secret (server-only). CMS integration is **public-read + visitor-write collections only**.
- **Full re-design / re-layout** — out of scope; augmentation adds one connected component, never a redesign.
- **Non-static frameworks the user hand-wrote** (Vue/Svelte/React with their own build) — deferred; this track targets static HTML+CSS/JS.
- **Custom domains** — out of scope; the skill releases to the default `*.wix-site-host.com` origin (which `init` already allow-lists). Attaching a custom domain later requires registering the new origin on the OAuth app separately — the skill does not do this.

> **Historical reference.** The retired Integrate (Path B) flow in `SETUP.md` § "Existing project flow" E1–E6 — especially the E4 SDK-wiring recipe — is the closest prior art for the wiring step. The per-`custom/<cap>/WIRING.md` guides supersede it.
