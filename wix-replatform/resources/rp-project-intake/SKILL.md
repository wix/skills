---
name: rp-project-intake
description: Resolves the active migration project and the minimum intake decisions needed to route it.
---

# rp-project-intake

Use when the router reports unresolved project, delivery mode, destination strategy, or
source mode.

Resolve project precedence: explicit user project, current project context, the sole
project under the migrations root, otherwise ask the user to choose. Never infer from a
sibling project.

Resolve delivery mode before destination creation: default to `management`; choose
`website` for frontend only; choose `management_and_website` when the user wants both a
backend migration and a customer-facing storefront. Accept `both` as an input alias for
`management_and_website`, then record the canonical value in `orchestration/decisions.json`.

For delivery modes that include management, also record `managementImportMode`. Default to
`standard`; accept an explicit user choice of `quick` at intake even before the source URL is
probed. The later source-inputs/probe result validates whether a matching quick adapter exists;
never promise quick support merely from the user's choice.

Record `faceliftMode=requested` only when the user explicitly asks for a post-clone UI/UX
facelift. It is optional, defaults to off, and is not a substitute for normal clone fidelity.
In explicit user-requested 1-click mode include this choice in the initial grouped intake so the later, separate
facelift stage is authorized without another routine approval.

In normal mode ask only the current missing decision. In explicit user-requested 1-click mode
record `automationMode=one_click` with `source=user`, collect every still missing intake value
together, record the answers, and continue. Never infer one-click from an uploaded file or
execution surface. Delegate all destination,
source-file, and credential procedures to their dedicated modules.
