---
name: rp-website-continuation
description: >-
  Continues a website-mode migration from the validated backend handoff through frontend
  build, post-build gap analysis/fixing, release, and a durable frontend completion receipt.
---

# rp-website-continuation

Use this resource only when the orchestration router returns
`nextResource: resources/rp-website-continuation/`.

## Contract

For `deliveryMode=website`, this is a frontend-only run — but it still needs a destination,
and that destination is still `rp-destination`'s job, not this skill's or
`wix-headless-replatform`'s. Do not let `wix-headless-replatform` scaffold its own site here:
its only safeguard against a duplicate is "does a local folder already have a
`package.json`," which is not the same account-confirmation gate, `WIX_SITE_ID`
persistence, and dashboard-URL report that every other delivery mode gets.

1. Resolve the destination via `rp-destination` first, scaffolding into
   `<projectDir>/frontend` with `--site-template blank` (there is no backend catalog to
   provision for, and this matches `wix-headless-replatform`'s own default template choice
   for the home-scope clone this invocation performs). Persist `WIX_SITE_ID` in
   `config/wix.env` and report the dashboard URL, same as any other mode.
2. Then invoke `wix-headless-replatform` with the source URL and
   `--out <projectDir>/frontend`; do not run backend discovery, mapping, setup, or import.
   Because `<projectDir>/frontend` already contains a valid scaffold from step 1,
   `wix-headless-replatform`'s own standalone reuse check finds it and continues from
   there instead of scaffolding a second site.

Finish its build and gap loop. Only when the user explicitly requested facelift at intake,
run the separate post-clone UI/UX Pro Max facelift and acceptance review; otherwise do not
load that stage. Then release and write `website/completion.json` with
`finalize-migration-website.mjs --project-dir <projectDir> --out <projectDir>/frontend
--release-url <public-url>`.

`execution/completion-report.json` means backend import accounting. It is not the terminal
result of a `deliveryMode=management_and_website` migration.

When the route reason is `missing_website_handoff` or `stale_website_handoff`, first run
`node skills/wix-replatform/scripts/website-handoff-generate.js <projectDir>` and route
again. Otherwise load the current `website/handoff.json`, then invoke
`wix-headless-replatform` in migration mode via its `--handoff` flag:

```bash
node scripts/site-clone.mjs <source-url> --handoff <projectDir>/website/handoff.json
```

**`--handoff` is required here, not optional.** It is the only thing that puts
`wix-headless-replatform` into migration-phase mode; without it the skill falls back to
standalone mode and unconditionally scaffolds and executes a new `@wix/new headless` call —
a second, orphaned site, which is exactly the failure "never create a second destination
site" (see `rp-destination`) exists to prevent. Continue its actual build, post-build gap
analysis, bounded fix loop, and release sequence. Do not stop after implementation or a
successful build.

The frontend skill must atomically write `website/completion.json` before this resource can
finish. A successful receipt has the current `handoffFingerprint`, completed screenshot
review, zero unresolved critical/high gaps, and a released (or explicitly not-applicable)
release state.

If a genuine blocker remains after required 1-click recovery/escalation retries, persist a
`status: "blocked"` receipt with the blocker code, evidence, attempted recovery, owner,
and exact unblock action. Then route again. Do not describe a pending storefront as a
completed migration.

After the gap loop has passed and the storefront is released, write the receipt with:

```bash
node skills/wix-headless-replatform/scripts/finalize-migration-website.mjs \
  --handoff <projectDir>/website/handoff.json --release-url <public-url>
```
