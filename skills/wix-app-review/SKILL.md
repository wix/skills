---
name: wix-app-review
description: >
  Review the technical and code-facing portions of a Wix app for App Market
  readiness. Use when auditing decline risk, validating technical requirements,
  or fixing review feedback around billing flows, identity, security, UX,
  performance, responsiveness, permissions, setup surfaces, or webhooks.
compatibility: Best with access to Wix MCP or official Wix docs for citations.
---

# Wix App Market Review Skill

This skill helps you build a Wix app that passes the App Market review process.
This first version intentionally focuses on technically reviewable surfaces:
code, configuration checked from the repo, runtime flows, and implementation
details. Manual App Dashboard, Dev Center, and listing-copy verification is
intentionally out of scope until those surfaces are easier for agents to check
reliably.

## How to use this skill

When helping a developer prepare a Wix app for submission:

1. **Audit the app first** - if the environment offers Plan mode or a staged
   review flow, prefer it for the initial audit. Read `references/taxonomy.md`
   to understand the technical decline reasons covered by this version of the
   skill, then classify the app before assessing gaps. Identify the relevant
   surfaces and features first: billing model, auth/password usage, cookie
   usage, extension types, whether the app has live-site surfaces, and whether
   it uses an external dashboard or setup UI. Start with a report-only pass that
   explains the gaps, why they matter, and links to official Wix docs sourced
   through Wix MCP when possible. Do not infer that the app sells paid app plans
   or has missing app billing configuration just because it uses the Wix Pricing
   Plans SDK/APIs; business-solution Pricing Plans are separate from app billing
   for the app itself. Before flagging secrets, config leakage, or similar security
   issues as blockers, verify the exposure is in a tracked file, the current diff,
   build artifacts, or another review-relevant surface. Do not treat a local-only
   workspace file by itself as repository exposure. Do not mark a requirement
   as missing unless supported by code, config, user statement, or explicit
   absence. Otherwise classify it as `Unknown / Needs confirmation`.

2. **Implement technical requirements** - for any 🔵 Code / Technical item the app
   hasn't addressed yet, consult `references/technical-guide.md` for implementation
   details and links to the official Wix documentation. Do not make code or repo
   changes until the user explicitly asks you to implement them or
   approves the proposed fixes.

3. **Use the checklist as a technical gate** - work through the checklist below
   before submission, but only for the technical scope covered here. Mark each
   line as `Applicable`, `Not applicable`, or `Unknown` before treating it as a
   gap. Flag applicable missing items, explain the impact, and prepare the fix
   plan for approval before implementing changes.

4. **Keep manual dashboard and listing checks out of scope** - this version of
   the skill should not claim compliance for App Dashboard, Dev Center, pricing-page
   setup, or listing-copy requirements. If the user asks about those surfaces,
   call them out as a separate manual follow-up instead of mixing them into the
   technical blocker list.

5. **Produce implementation-grade output, not generic advice** - when you provide
   recommendations, anchor them to Wix-specific requirements and include:
   - taxonomy IDs when relevant (for traceability in review discussions)
   - concrete verification tests with pass criteria
   - official Wix documentation links for every major technical area when an
     authoritative source exists; if you could not verify a claim, say so instead
     of inventing a requirement
   - explicit note when a change is only a partial mitigation or introduces a
     tradeoff instead of fully resolving a requirement

> **Source of truth**: All implementation guidance links back to official
> [Wix Developer Docs](https://dev.wix.com/docs/build-apps) via Wix MCP.

---

## Expected output from this skill

When this skill is used well, the user should get:

1. A clear report of confirmed gaps and `Needs confirmation` items grouped by
   priority, with explanations and Wix doc links where available:
   - Technical blockers (likely decline reasons)
   - Should-fix items (high review risk)
   - Nice-to-have hardening items
2. A concrete implementation plan for all relevant 🔵 Code / Technical requirements,
   with links to official Wix docs, before any changes are made.
3. Explicit verification tests, plus a short note listing any manual App Dashboard
   or marketing checks that were intentionally left out of scope.

## Response quality rules

Use these rules whenever this skill is triggered:

1. **Prioritize specificity over generic best practices**
   - Prefer Wix-specific guidance over platform-neutral security/auth wording.
   - Include taxonomy IDs if the recommendation maps to known decline reasons.

2. **Always include required Wix constraints when relevant**
   - OAuth/Auth flows
   - Billing/Security flows

3. **Prefer report-first, approval-gated workflow**
   - If Plan mode or a staged review flow is available, use it for the initial audit.
   - Deliver findings and recommended fixes before editing files.
   - Only implement changes after explicit user approval or a direct request to fix them.

4. **Use official sources and avoid invented claims**
   - Use Wix MCP and official Wix docs as the primary source of truth when possible.
   - If a claim could not be verified, say that clearly instead of presenting it as fact.

5. **Calibrate claims to evidence**
   - For each finding, include `Applicability`, `Evidence`, and `Confidence`.
   - Only place `Confirmed` findings in `Blockers` or `Should-fix`.
   - Preserve qualifiers from the taxonomy and docs. Do not upgrade `recommended`,
     `if applicable`, or surface-specific guidance into a universal blocker.
   - If a change is only a partial mitigation or adds a tradeoff, say that
     explicitly instead of calling it complete compliance.

6. **Include verification steps**
   - For each major fix area, add test cases with pass/fail criteria.
   - End with a concise pre-submission checklist.

7. **Keep structure predictable**
   - Use clear sections and separate `Confirmed`, `Needs confirmation`, and
     `Out-of-scope manual follow-up` items.

## Reference files

| File | What's in it | When to read it |
|---|---|---|
| `references/taxonomy.md` | Technical and process decline reasons covered by this phased version of the skill | When auditing an app or identifying technically reviewable gaps |
| `references/technical-guide.md` | Deep-dive on technically reviewable requirements with implementation notes and Wix doc links | When implementing a specific requirement |

---

## Pre-Submission Checklist

Work through this before submitting. First mark each line as `Applicable`,
`Not applicable`, or `Unknown`. Only applicable unchecked items are potential
decline reasons. Unknown items require confirmation before they are treated as
gaps.

### Billing & Payments
- [ ] All in-app purchases routed through Wix Billing unless Wix explicitly approved the app as Partner Billed; approved Partner Billed apps report charges via External Billing Events
- [ ] No external purchase buttons, links, or license key mechanisms in the UI
- [ ] Full checkout flow tested for every plan
- [ ] If the app has premium features, there is a clear in-product upgrade link or CTA
- [ ] Credits do not expire

### Setup & Access
- [ ] No localhost URLs in app configuration
- [ ] A usable setup/settings UI exists (dashboard page, widget, or other relevant surface; Embedded Script apps need a dashboard page)

### Instance & Identity
- [ ] `instanceId` used for all user identification — not cookies or sessions
- [ ] Separate billing enforced per `instanceId` (one plan per site)
- [ ] Auto-login via `instanceId` works when user reopens app from Manage Apps
- [ ] Site duplication (`originInstanceId`) handled — treat it as a new install linked to the original instance and copy over applicable settings/content where possible
- [ ] Required Wix apps (e.g. Stores, Bookings) checked via Get App Instance API
- [ ] If the app supports Wix Catalog, both Catalog V1 and Catalog V3 are supported

### Webhooks
- [ ] Any implemented webhook returns HTTP 200 on successful receipt

### Permissions
- [ ] Only minimum required permissions requested — no unused scopes
- [ ] No redundant/overlapping permissions

### Security
- [ ] Server-side signed instance verification (HMAC signature check)
- [ ] For signed-instance-backed edit/save actions, `signDate` is validated and stale signatures require a refresh before continuing
- [ ] All endpoints served over HTTPS, no HTTP fallback
- [ ] No `alert()` or `confirm()` dialogs — use Wix modal components
- [ ] XSS sanitization on all input fields
- [ ] Passwords hashed with bcrypt/SHA-256 + unique salt per password
- [ ] Password reset sends expiring email link — no plaintext passwords

### UX & Display
- [ ] In-product flows use Wix popup/modal instead of browser-native popups; documented exceptions such as OAuth and Wix pricing-page upgrade CTAs are handled appropriately
- [ ] Demo data shown on first install, not Lorem Ipsum
- [ ] No ads shown to site visitors
- [ ] Review modal, if present, is non-blocking and does not force or incentivize reviews

### Performance & Quality
- [ ] App loads within 400ms
- [ ] No known bugs or console errors
- [ ] Full supported-browser matrix tested; add mobile/tablet coverage for live site extensions
- [ ] Live site extensions are responsive on all screen sizes; dashboards support the required desktop layout (min-width 1200px)

### SEO & Accessibility
- [ ] No `<h1>` tags inside widget components
- [ ] Alt-text customization input in settings panel
- [ ] App UTF-8 encoded

### Cookie Consent
- [ ] Cookie consent workflow activates/deactivates cookies per visitor preferences

---

*Last updated: April 2026*
