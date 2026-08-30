# wix-replatform

`wix-replatform` is a migration skill for moving business data from another platform into
Wix.

Its public entrypoint is `wix-replatform`. The bundled internal resources handle the workflow
stages behind that entrypoint.

## Quick start

Install the skill:

```bash
npx skills add wix/skills/wix-replatform
```

Or install it globally:

```bash
npx skills add wix/skills/wix-replatform -g
```

Then, in your agent:

1. Invoke `wix-replatform`.
2. If you want the migration to run end to end with grouped intake and no routine
   checkpoint pauses, invoke it as `wix-replatform in 1-click mode`.
3. Provide the source site URL and any required destination/source-access details.
4. Follow the routed workflow through discovery, mapping, setup, code generation, and import.
5. Choose whether the run is backend-only (`management`) or backend + storefront
   (`website`).
6. After setup discovery, the skill writes `website/handoff.json` even for backend-only
   runs. In `website` mode it also asks for a late `websiteScope` decision so the
   storefront skill can start with suggested scopes based on the discovered content. In
   `1-click mode`, it picks the deterministic default instead of pausing.
7. If the delivery mode is `website`, continue into the frontend phase through the
   migration project's `website/handoff.json` package.

If the user explicitly asks for `1-click mode`, the skill should gather any missing
required inputs up front once, record `automationMode=one_click` with `source: "user"`, record routine
mapping/execution approvals as `approved` with `decidedBy: "agent"`, create a demo
member for blog import when needed, and continue through the frontend phase as well when
`deliveryMode=management_and_website` (or user input `both`). `deliveryMode=website` is
frontend-only.

For CSV, explicit user-requested 1-click also accepts a passing sample preview as the agent
and continues without routine questions. Without that explicit user-authored decision, CSV
keeps its normal mapping review, sample-preview validation, and execution-plan approval
pauses. File upload alone never implies 1-click.

Migration artifacts are written to a local project directory such as `migrations/<project>/`.
They are not written back into the skill package.
