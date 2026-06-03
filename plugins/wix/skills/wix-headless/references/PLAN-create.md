# Plan — create operation (astro)

The pre-approval funnel when `operation === "create"` (the skill writes the site; today `frontend: astro`, `frontendBuild: wix`). Shared funnel rules — concurrency vocabulary, the two-track model, the Plan→Build contract, user-facing output, batching discipline — live in `PLAN.md`; this file is the create funnel only. Domain (the questions, the plan content) is owned by `DISCOVERY-create.md`.

**Input = the user's prompt**, processed by the interview (`DISCOVERY-create.md` Steps 0–2.5). **Plan shape = the full decision card** (Design Direction + Features + Pages, `DISCOVERY-create.md` § "Step 3").

## Wave 0 — Discovery → plan → approval (Path A)

**The funnel dispatches nothing.** Its only job is to talk to the user, present the plan, and get approval. (The scaffold and Designer used to be dispatched here to hide their wall behind Q&A think-time — but the Designer is now ~10–15 s and the scaffold ~23 s, so the hiding isn't worth it, and those dispatches were what distracted the agent from actually showing the plan. **Both now dispatch in `BUILD-astro.md`, post-approval.**) So the funnel is exactly three things:

1. **The interview** — Wave-0 field resolution (operation/frontend/frontendBuild) + CLI auth already ran in `DISCOVERY.md` (shared). Now apply `DISCOVERY-create.md` (Q0 vertical inference, Q1 brand, Q2 vibe, Q2.5 imagery). **Read only what the next question needs** — do not pre-read `BUILD-astro.md`; read the vertical packs for plan composition (not before the vibe question).
2. **Compose and PRESENT the plan — as a standalone assistant message.** The moment Q&A ends and the aesthetic-direction craft is done, **render the full plan** (Design Direction from the Q2 craft + the Pages/Features tables, per `DISCOVERY-create.md` § "Step 3") as a normal message the user reads. **The user MUST SEE the rendered plan before being asked to approve.** Do **not** fold the plan into the approval question, do **not** replace it with a one-line "here's the plan" + dispatch, and do **not** do any other work (no scaffold, no Designer, no scaffold-output reads) between the craft and the plan — there is nothing to dispatch here, so present the plan immediately.
3. **Approval gate** — *only after* the plan message has been sent, ask the approval question (`AskUserQuestion`).

**On approval** — `init-site-json.mjs --frontend astro` writes the slim `.wix/site.json`, then **open `BUILD.md`** — it routes Build on `frontendBuild` (`wix` here) to `BUILD-astro.md`; continue from its run-step 0 (which dispatches the scaffold + Designer, then runs Setup).
