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

A brought-in frontend connects to Wix with the **browser SDK + anonymous visitor session** — `createClient` + `OAuthStrategy`, no `@wix/astro`, no server runtime, no middleware. This connection model is **framework-blind**: the SDK *calls* are identical whether the brought-in frontend is loose static HTML, a Vite/React/Vue/Svelte SPA, or an already-built astro project. **How `@wix/sdk` physically reaches the page** (a CDN `<script>` vs a bundled `import`) and **how/whether the project builds** before release are *not* this file's concern — they are the **framework-build-class** (`frontendBuild`), resolved in Discovery and owned by the Build layer (`BUILD-own-build.md`). Connect never branches on framework; Build does.

The runtime shape (the static/`none` form shown; an SPA bundles the same calls instead):

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

> **How `@wix/sdk` reaches the page differs per framework-build-class** (CDN `esm.sh` for `none`; bundled `npm import` for `own`) — but that mechanic is the Build layer's concern (§ "The technical spine" above). Either way the `clientId`/`appId` is inlined from `wix.config.json` (no `WIX_CLIENT_ID` env at runtime).

## The flow

The conductor interleaves these; the business track (steps 3–5) runs frontend-blind, concurrent with the connection-plan pass (step 2).

1. **Discovery (already done by the conductor).** `DISCOVERY.md` parsed the site, inferred the **domain**, derived the Wix **capability + apps**, and got approval. The resolved capability list + the site's file/token map arrive here.
2. **Connection plan** — **for `none`, first rename the entry HTML to `index.html`** if it isn't already (Wix serves `index.html` at the site root; any other name publishes but errors at runtime — `BUILD-own-build.md` § "connect × none" owns the rule; do it before this plan so the binding map keys on `index.html`). Then read the site and emit the binding map (existing dynamic regions) + the augmentation spec (the connected component to add). See `references/custom/CONNECTION_PLAN.md`.
3. **Init** — `npm create @wix/new@latest init` <!-- REVIEW: verify this command/subcommand syntax against the current Wix CLI — `npm create @wix/new@latest` may not take an `init` positional. Left unchanged pending check. --> (non-interactive when logged in) writes `wix.config.json` (`Site`, `appId`, `siteId`, `site.outputDirectory`). **Point `outputDirectory` at the dir that holds the deployable** — for `none` that's where the brought-in `index.html` lives; for `own` it's the project's build output (`dist/`), set after the build. (Init defaults it to `./dist`; the framework layer fixes it — `BUILD-own-build.md`.) Source files untouched at this step.
4. **Setup (shared business track, `SETUP.md`)** — install the inferred apps (app-install curl, with `x-wix-request-id` capture per the project policy). **Skip** `env pull` (integration inlines `appId` from `wix.config.json` — no `WIX_CLIENT_ID` needed; the `init` project has no `env` command). The per-pack `npm install` decision is framework-keyed (see § "The technical spine"): `none` skips it (CDN imports); `own` instead `npm install`s `@wix/sdk` + the capability modules so the bundler includes them.
5. **Seed (shared business track, `SEED.md`) — DISPATCH seeders as subagents.** Same per-pack dispatch model as astro: one seeder subagent per capability with a seed recipe, fired as a concurrent background batch. Each creates the backend its capability needs — the **Wix Form definition** (forms), a **CMS collection + items** (cms), sample products/posts (stores/blog) — and returns the IDs / form IDs. **Do not seed inline:** the seeder count scales with the brought-in site's content (unpredictable), so inlining serializes the work and bloats the orchestrator context. Seeded IDs flow into wiring.
6. **Wiring — writer count is a RUNTIME decision keyed on file topology.** Each capability's `references/custom/<capability>/WIRING.md` is the how-to (wire existing regions to `@wix/sdk` reads, and inject the connected component — e.g. an RSVP `<form>` → `@wix/forms createSubmission` — styled from the design's CSS tokens; additive, never restructure). But **how many writers run depends on whether capabilities share a file**: a single brought-in `index.html` carrying several capabilities (a form *and* a feedback list) must be wired by **one writer** (inline or a single subagent handling all of them) — **never parallel agents on the same file**, or they clobber each other and double the SDK bootstrap. Only capabilities mapping to *distinct* files may be wired by parallel subagents. (Contrast with **seeding**, which always dispatches — backend work, no shared file.)
7. **Release** — the **shared release tail** (`BUILD.md` § "Shared release tail"). Whether a build runs first is framework-keyed (see § "The technical spine"): `none` has no build (the static `outputDirectory` is already the deployable — run `npx @wix/cli@latest release` directly); `own` runs the project's own `npm run build` first, then points `outputDirectory` at the build output, then releases. **Never `wix build`** — that is astro-only. Extract the published URL from `Site published on <url>`; retry transient release errors serially (`references/shared/PRODUCTION_SHARP_EDGES.md`). Emit the production + dashboard URLs.

## Always connect: design intent → Wix capability

`DISCOVERY.md` infers the domain and picks the capability; this table is the shared source of truth. **Wix Forms is the universal floor** — when nothing richer fits, a domain-appropriate form is the minimum viable connection.

| Inferred domain | Connected feature (wire and/or add) | App(s) | Wiring guide |
|---|---|---|---|
| Wedding / event invitation / party | **RSVP** via Wix Events (built-in name+email registration → attendee list + confirmation email); a plain Forms RSVP is the lighter fallback for a purely static one-pager with no attendee management | Wix Events (or Wix Forms) | `custom/events/WIRING.md` (or `custom/forms/WIRING.md`) |
| Event / concert / conference / meetup / festival / fundraiser (sell tickets or collect RSVPs) | events listing + per-event detail; **ticketed** → reserve + redirect to Wix's hosted checkout (PDF/QR ticket email), **free** → RSVP registration | Wix Events | `custom/events/WIRING.md` |
| Store / product mock | product catalog (wire existing grid) | Wix Stores + eCom | `custom/stores/WIRING.md` |
| Blog / publication | post list + detail (wire existing) | Wix Blog | `custom/blog/WIRING.md` |
| Salon / spa / studio / coach landing | services list + availability + book (Wix-hosted bookings checkout) | Wix Bookings | `custom/bookings/WIRING.md` |
| Restaurant / venue landing | reservation / contact form; optional menu CMS | Wix Forms (+ CMS) | `custom/forms/WIRING.md` |
| SaaS / product landing | lead / waitlist signup form | Wix Forms | `custom/forms/WIRING.md` |
| Portfolio / agency | contact form; optional projects CMS | Wix Forms (+ CMS) | `custom/forms/WIRING.md` |
| **App with client/local state** (todo, notes, tracker, planner, kanban — typically a framework SPA persisting to `localStorage`/in-memory) | **persist its state to a Wix CMS collection** (`@wix/data`); the collection schema mirrors the app's in-memory data shape. **The anonymous visitor token gives no per-user identity ⇒ the collection is shared/public** (every visitor reads/writes the same data, not per-user, not cross-device-isolated); tell the user plainly. True per-user storage needs member auth, which is **deferred** (§ "Scope — deferred"). | Wix CMS (Wix Data) | `custom/cms/WIRING.md` § "Framework SPA — persistence swap" |
| Anything else | contact form (the floor) | Wix Forms | `custom/forms/WIRING.md` |

> **Reconciling "connect, don't design."** Augmentation injects the **one connected component** the backend connection requires (an RSVP/lead/contact `<form>`), styled from the design's tokens so it reads as native. It does **not** redesign or re-lay-out the site. "Connecting the dots" includes adding the one dot the design omitted.

> **Three connection kinds, not two** (this is a connection-*model* distinction — what to connect — not a framework fork). Beyond **wire an existing region** (swap the data source behind dynamic markup) and **augment with a component** (inject the one connected feature a static design omits), an **app with client/local state** needs a third: **persistence swap.** Such an app already *has* a working data layer (e.g. `localStorage` or in-memory state); the connection **replaces that layer with `@wix/data`** — the UI, component tree, and styling are untouched; only the load/save functions change. A todo app is not "anything else → contact form" (nonsense) — it is a persistence swap onto a CMS collection. The connection planner emits this as a `persistenceSwap` structure (`CONNECTION_PLAN.md` § "(c) Persistence swap"); the cms wiring agent executes it (`custom/cms/WIRING.md` § "Framework SPA — persistence swap"). *How* the swap is mechanically applied (CDN `<script>` vs bundled source) is the Build layer's concern (§ "The technical spine"). The resulting collection is **shared/public** — see the client-state row in the table above for the per-user caveat to surface to the user.

## Wiring discipline (applies to every `custom/<cap>/WIRING.md`)

- **Additive only.** Never restructure the user's layout or CSS. Swap the *data source* behind a region; inject new components self-contained. For a persistence swap, change only the load/save functions — leave the component tree and styling untouched.
- **Style from the design's tokens.** Read the site's CSS custom properties (`:root { --… }`) and reuse them verbatim in any injected component so it looks designed-in.
- **Inline `appId` literally** from `wix.config.json` as the `OAuthStrategy` `clientId`. No env vars at runtime.
- **The wiring *mechanic* is framework-keyed** (CDN `<script>` for `none`, bundled `import` + source edit for `own`) — the Build layer's concern, not fixed here (see § "The technical spine"). The per-capability guides describe the SDK *call shapes* (framework-blind); the Build cell decides the injection form. (For `none`: one `<script type="module">` per capability, or a shared client bootstrap + per-region render calls.)
- **Guard every SDK call** in try/catch. On a read error, leave the original sample markup visible; the injected component degrades gracefully if the backend is unreachable.

## Scope — deferred (tell the user plainly when relevant)

- **Member authentication** (login/logout, member-gated content, **per-user data isolation**) — needs the server OAuth callback routes `@wix/astro` provides; not possible on a pure static/SPA client. Consequence for client-state apps: the persistence-swap collection is shared/public (per-user is the deferred member-auth follow-on) — see the client-state row in the "Always connect" table for the caveat to surface.
- **SSR cart/session persistence across reload** — client-side cart works via `@wix/ecom` + checkout redirect; cookie-backed persistence needs the server runtime.
- **`auth.elevate` CMS queries** — elevation needs the app secret (server-only). CMS integration is **public-read + visitor-write collections only**.
- **Full re-design / re-layout** — out of scope; augmentation adds one connected component, never a redesign.
- **SSR frameworks the user hand-wrote** (Next.js / Nuxt / Remix and other server-rendered frameworks) — deferred; `wix release` uploads a static `outputDirectory`, and SSR needs a runtime host this track doesn't provide. **Pure client-build SPAs (Vite + React/Vue/Svelte and similar — `frontendBuild: own`) ARE supported** — bundled `@wix/sdk`, source-edit wiring, and the project's own `npm run build` before release, all the Build layer's concern (see § "The technical spine"). Connect stays framework-blind; the framework-build-class is what differs.
- **Custom domains** — out of scope; the skill releases to the default `*.wix-site-host.com` origin (which `init` already allow-lists). Attaching a custom domain later requires registering the new origin on the OAuth app separately — the skill does not do this.
