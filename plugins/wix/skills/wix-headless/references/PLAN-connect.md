# Plan — connect operation (custom)

The pre-approval funnel when `operation === "connect"` (the user brought a finished site to connect; today `frontend: custom`, `frontendBuild: none`). Shared funnel rules — concurrency vocabulary, the two-track model, the Plan→Build contract, user-facing output, batching discipline — live in `PLAN.md`; this file is the connect funnel only. Domain (parse + infer + plan content) is owned by `DISCOVERY-connect.md`.

**Input = the brought-in site**, processed by parse + infer (`DISCOVERY-connect.md` §§ 1–2). **Plan shape = a light plan** (detected-site summary + what to wire/add + apps, `DISCOVERY-connect.md` § 3) — not the astro Design-Direction card. The plan also resolves the **connection plan** that fills the contract's operation section (binding-map / augmentation), consumed downstream only at the wiring cell.

## Wave 0 — Connect discovery → plan → approval (Path B)

**The funnel dispatches nothing.** Its only job is to parse the site, present the plan, and get approval. Same three-step shape as the create funnel, planning content aside:

1. **Parse + infer** — apply `DISCOVERY-connect.md` §§ 1–2: read the brought-in site (markup, copy, tokens; opportunistically a Claude-Design bundle), infer the domain → Wix capability (the universal floor is a Wix Forms contact/lead form), and infer the brand.
2. **Compose and PRESENT the light plan — as a standalone assistant message.** Render the connect plan (`DISCOVERY-connect.md` § 3): *what I found* (site type + detected regions) and *what I'll connect* (regions to **wire** + the component to **add** + apps to install). The user sees the plan before being asked to approve — do not fold the plan into the approval question.
3. **Approval gate** — *only after* the plan message has been sent, ask the approval question (`AskUserQuestion`).

**On approval** — `init-site-json.mjs --frontend custom` writes `.wix/site.json` (frontend + inferred capabilities + brand), then **open `BUILD.md`** — it routes Build on `frontendBuild` (`none` here) to `BUILD-own-build.md`, whose `none`-tenant flow runs: bootstrap cell (`npm create @wix/new@latest init` + connection plan) → shared Setup (app installs only; **no `env pull`, no per-pack `npm install`**) → shared Seed (dispatched seeders — entities + the Form definition / CMS schema the connection targets) → wiring cell (`references/custom/CONNECTION_PLAN.md` + `references/custom/<capability>/WIRING.md`) → **inline no-build release** (`npx @wix/cli@latest release` directly — no `wix build`).

> **Always connect.** The connect operation must end with the site reading from or writing to Wix; `init`+`release` of a static page with no connection is not acceptable (`references/custom/INSTRUCTIONS.md` § "Two locked principles"). The per-capability `custom/<cap>/WIRING.md` guides own the wiring step.
