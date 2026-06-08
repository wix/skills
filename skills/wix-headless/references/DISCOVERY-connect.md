# Discovery — connect operation (custom)

Reached when `operation === "connect"` — the user brought a finished, working site (Claude Design or any tool) and wants it connected to Wix (today this implies `frontend: custom`, `frontendBuild: none`). The shared Wave-0 field resolution + CLI-auth pre-flight live in `DISCOVERY.md`; this file is the connect discovery (parse → infer → light plan → approval). Run FLOW (when/order/gate) is owned by `PLAN-connect.md`.

**Input processing:** the brought-in site — parsed, not interviewed. **Plan shape:** a light plan (detected-site summary + what to wire/add + apps), not the astro Design-Direction card.

Discovery here **parses the site instead of interviewing**, then hands off to the connect flow (`references/custom/INSTRUCTIONS.md`). Do **not** run brand suggestions, vibe, imagery, the Designer, or the scaffold.

After the Pre-flight auth check (`DISCOVERY.md` § "Pre-flight"), run connect discovery:

## 1 · Read the site (primary signal)

Read the entry HTML (and other pages) — markup, copy, headings/`<title>`, `<form>`s, repeated structures, and the CSS custom-property token block (`:root { --… }`). **Opportunistic enrichment:** if a Claude-Design handoff bundle is present (`README.md`, `chats/` transcript), read it to sharpen intent — but never require it; the inference must stand on markup alone.

## 1.5 · Resolve the framework-build-class (`frontendBuild`)

`connect` is framework-blind, but the **Build** layer routes on `frontendBuild` — so resolve it here from the brought-in project (durable disk signal) and hold it in scratch as part of the Plan→Build contract core. **`frontend` stays `custom`** for every non-astro brought-in frontend; only `frontendBuild` distinguishes how Build installs/builds/wires:

| Signal on disk | `frontendBuild` | What Build does |
|---|---|---|
| Loose `index.html` + CSS/JS, **no `package.json` build script** | `none` | CDN `@wix/sdk`, no build, release the HTML as-is (the original static path) |
| `package.json` with a `scripts.build` **AND** a client bundler/framework dep (`vite`, `@vitejs/*`, `react`/`react-dom`, `vue`, `svelte`/`@sveltejs/*`, `webpack`, `parcel`, `rollup`, `esbuild`) **AND** an entry HTML that loads **un-built source** (e.g. `<script type="module" src="/src/main.jsx">`) | `own` | bundled `npm install @wix/sdk`, source-edit wiring, the project's own `npm run build` → `dist/`, then release |
| `@astrojs/*`/`astro` dep with an astro build *(a brought-in astro project)* | `wix` | *out of SPA-plan scope — not yet exercised; the framework-blind connect flow does not forbid it, but Build's astro tenant assumes a scaffold. Treat as `own` (run its own build) unless/until a dedicated path lands.* |

- Read `package.json` once (if present) + the entry HTML. The **un-built-source entry** is the decisive signal: a built `dist/index.html` referencing hashed bundles is *not* `own` to re-build blindly — but a brought-in SPA repo with `src/` + a build script is.
- Record `frontendBuild` in orchestrator scratch (contract core, `PLAN.md` § "The Plan→Build contract"). It is **not** persisted to disk — on scratch loss it is recovered by re-reading `package.json` (this same signal).
- Pass the resolved `frontendBuild` into the connection-plan dispatch (it tells the planner to read rendered markup for `none` vs un-built `src/**` for `own` — `CONNECTION_PLAN.md` § "What to read").

## 2 · Infer the domain → capability

Map the site's purpose to the Wix capability + apps using the table in `references/custom/INSTRUCTIONS.md` § "Always connect" (wedding invite → RSVP/Wix Forms; store mock → Wix Stores; **app with client/local state — todo, notes, tracker, planner — → CMS persistence swap (`@wix/data`)**; etc.). **Always connect:** if the site has no dynamic region, pick the connected feature its purpose implies; the universal floor is a Wix Forms contact/lead form — **but a client-state app maps to a CMS persistence swap, not the contact-form floor** (the connection planner detects this from source; see `CONNECTION_PLAN.md` § "(c) Persistence swap"). Also infer the **brand** (from `<title>`/copy) for scratch and any seeded-content naming.

## 3 · Present a light plan, then approval

Same discipline as the create path (`DISCOVERY-create.md` § "Step 3" / `PLAN-create.md`): **present the plan as its own message first, then ask for approval as a separate step.** The connect plan is *light* (no Design Direction — the user already designed it), but it still shows the user what will happen before they commit. Structure:

- **What I found** — one line: the site's type/purpose + the pages/regions detected (e.g. *"A static wedding invitation — hero, date, venue, closing. No RSVP, no dynamic content."*).
- **What I'll connect** — what you'll **wire** (existing dynamic regions → a Wix entity), what you'll **add** (the connected component the purpose implies), or what you'll **persist** (a client-state app's data layer → a Wix CMS collection), plus the **apps** to install. (e.g. *"I'll install Wix Forms and add an RSVP form styled to match the invitation."*; or *"I'll move your to-do storage into a Wix CMS collection so it persists on Wix — note it'll be shared across everyone who visits, not per-user."*)

> **Persistence-swap honesty.** When the connection is a persistence swap (a client-state app), the plan must state plainly that the data is **shared/public across all visitors**, not per-user — the visitor token has no per-user identity (`INSTRUCTIONS.md` § "Scope — deferred"). Say it in the plan, before approval.

Then, as a separate step, ask for approval (`AskUserQuestion`): *"Ready to connect it?"* — Options: **Yes, connect it** / **Adjust something**. If the user adjusts (different capability, skip the augmentation, etc.), handle it conversationally and re-present.

> Example combined shape — present this as the plan message, then ask the approval question:
> *"This is a wedding invitation with no RSVP. I'll install Wix Forms, add an RSVP form styled to match, and publish it live."*

## 4 · After approval — hold the contract in scratch

Hold the captured contract in orchestrator scratch — nothing is written to disk:

- `frontend: custom`. The **`frontendBuild`** that drives Build was resolved in § 1.5 (`none` for static HTML, `own` for a framework SPA) and lives in **scratch** alongside `operation` (the in-agent contract, `PLAN.md` § "The Plan→Build contract"). `none` makes the conductor skip the build at release; `own` makes it run the project's own `npm run build` first.
- `verticals` = the inferred capability set (e.g. `"forms"`, `"stores,ecom"`, or `"cms"` for a client-state persistence swap).
- `brand` (from § 2) + the one-line site summary, for seeded-content naming and the end-of-run `AGENTS.md`.

Then hand to `BUILD.md` — it routes Build on `frontendBuild` (`none` or `own`, from § 1.5) to `BUILD-own-build.md`. The frontend-track playbook is `references/custom/INSTRUCTIONS.md`; `PLAN-connect.md` owns the pre-approval routing.
