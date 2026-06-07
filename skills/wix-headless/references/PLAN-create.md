# Plan — create operation

The pre-approval funnel when `operation === "create"` (the skill writes the site). Shared funnel rules — concurrency vocabulary, the two-track model, the Plan→Build contract, user-facing output, batching discipline — live in `PLAN.md`; this file is the create funnel only. Domain (the questions, the plan content) is owned by `DISCOVERY-create.md`. The funnel **dispatches nothing** in either framework branch; it differs only in plan shape and where it hands off (Build routes on `frontendBuild`):
- **`frontendBuild: wix` (astro — default):** the full interview + decision card below.
- **`frontendBuild: own` (framework SPA — named-framework create):** the **light** plan from `DISCOVERY-create.md` § "Framework-SPA branch" (no astro decision card, but it **does** run the vibe question + the Designer — the brand tokens are framework-agnostic and the SPA imports them); on approval, hold the contract in scratch (`frontend: custom`, `frontendBuild: own`), then `BUILD.md` routes `own` → `BUILD-own-build.md` (create × own cells). The astro funnel below does not apply.

**Input = the user's prompt** (astro branch), processed by the interview (`DISCOVERY-create.md` Steps 0–2.5). **Plan shape = the full decision card** (Design Direction + Features + Pages, `DISCOVERY-create.md` § "Step 3").

## Wave 0 — Discovery → plan → approval (Path A)

**The funnel dispatches nothing — scaffold + Designer dispatch post-approval in `BUILD-astro.md`.** Its only job is to talk to the user, present the plan, and get approval. So the funnel is exactly three things:

1. **The interview** — Wave-0 field resolution (operation/frontend/frontendBuild) + CLI auth already ran in `DISCOVERY.md` (shared). Now apply `DISCOVERY-create.md` (Q0 vertical inference, Q1 brand, Q2 vibe, Q2.5 imagery). **Read only what the next question needs** — do not pre-read `BUILD-astro.md`; read the vertical packs for plan composition (not before the vibe question).
2. **Compose and PRESENT the plan — as a standalone assistant message.** The moment Q&A ends and the aesthetic-direction craft is done, **render the full plan** (Design Direction from the Q2 craft + the Pages/Features tables, per `DISCOVERY-create.md` § "Step 3") as a normal message the user reads. **The user MUST SEE the rendered plan before being asked to approve.** Do **not** fold the plan into the approval question, do **not** replace it with a one-line "here's the plan" + dispatch, and do **not** do any other work (no scaffold, no Designer, no scaffold-output reads) between the craft and the plan — there is nothing to dispatch here, so present the plan immediately.
3. **Approval gate** — *only after* the plan message has been sent, ask the approval question (`AskUserQuestion`).

**On approval** — hold the contract in scratch (`frontend: astro`, `frontendBuild: wix`), then **open `BUILD.md`** — it routes Build on `frontendBuild` (`wix` here) to `BUILD-astro.md`; continue from its run-step 0 (which dispatches the scaffold + Designer, then runs Setup).
