# Plan — integration mode (custom)

The pre-approval funnel when `frontend === "custom"` (the user brought a finished site to connect). Shared funnel rules — concurrency vocabulary, the two-track model, user-facing output, batching discipline — live in `PLAN.md`; this file is the integration funnel only. Domain (parse + infer + plan content) is owned by `DISCOVERY-integration.md`.

**Input = the brought-in site**, processed by parse + infer (`DISCOVERY-integration.md` §§ 1–2). **Plan shape = a light plan** (detected-site summary + what to wire/add + apps, `DISCOVERY-integration.md` § 3) — not the astro Design-Direction card.

## Wave 0 — Integration discovery → plan → approval (Path B)

**The funnel dispatches nothing.** Its only job is to parse the site, present the plan, and get approval. Same three-step shape as the astro funnel, planning content aside:

1. **Parse + infer** — apply `DISCOVERY-integration.md` §§ 1–2: read the brought-in site (markup, copy, tokens; opportunistically a Claude-Design bundle), infer the domain → Wix capability (the universal floor is a Wix Forms contact/lead form), and infer the brand.
2. **Compose and PRESENT the light plan — as a standalone assistant message.** Render the integration plan (`DISCOVERY-integration.md` § 3): *what I found* (site type + detected regions) and *what I'll connect* (regions to **wire** + the component to **add** + apps to install). The user sees the plan before being asked to approve — do not fold the plan into the approval question.
3. **Approval gate** — *only after* the plan message has been sent, ask the approval question (`AskUserQuestion`).

**On approval** — `init-site-json.mjs --frontend custom` writes `.wix/site.json` (frontend + inferred capabilities + brand), then **open `BUILD-integration.md`** and run its flow: `npm create @wix/new@latest init` → shared Setup (app installs only; **no `env pull`, no per-pack `npm install`**) → shared Seed (dispatched seeders — entities + the Form definition / CMS schema the connection targets) → connection-plan + wiring (`references/custom/CONNECTION_PLAN.md` + `references/custom/<capability>/WIRING.md`) → **inline no-build release** (`npx @wix/cli@latest release` directly — no `wix build`).

> **Always connect.** Integration mode must end with the site reading from or writing to Wix; `init`+`release` of a static page with no connection is not acceptable (`references/custom/INSTRUCTIONS.md` § "Two locked principles"). The per-capability `custom/<cap>/WIRING.md` guides own the wiring step.
