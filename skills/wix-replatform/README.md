# wix-replatform

`wix-replatform` moves business data from another platform into Wix: products and
categories, blog posts, customers, orders, and more, depending on the source. You give your
coding agent a source site (or export files); the skill discovers what is there, maps it to
Wix, and imports it into a Wix site you approve.

It works in Claude Code, Cursor, and other agents that support skills. Migration progress is
saved to disk, so a run that stops can be resumed instead of restarted.

## Install

```bash
npx skills add wix/skills/skills/wix-replatform
```

Or install it globally, for every project:

```bash
npx skills add wix/skills/skills/wix-replatform -g
```

You need a Wix account and Node.js. The skill and the `replatform` command need Node.js
22.12 or newer. The Wix CLI, which creates the new site and signs you in, currently needs
Node.js 24.18 or newer, so use that to be safe. Log the Wix CLI into the account that should
own the new site (`wix login`).

> Also want the migrated store to get a website? Install the storefront skill too:
> `npx skills add wix/skills/skills/wix-headless-replatform`. It is only needed for the
> `website` and `management_and_website` delivery modes below.

## Try it: two prompts to copy

Open your agent in an empty folder (migration files are written to `migrations/<project>/`
there), paste a prompt, replace the URL, and send it.

### 1. Fastest path: one-click quick import of a public store

Works for a public **Shopify** or **WooCommerce** store. It reads only public data, needs no
credentials, and runs end to end without routine pauses. It imports products, categories,
and (WooCommerce) blog posts, categories and tags.

```text
Use wix-replatform in 1-click mode to migrate https://YOUR-STORE.example.com into a new
Wix site. Use quick import mode (public data only, no credentials). Backend data only, no
website. Ask me once, up front, for anything you still need.
```

You will be asked once, in one grouped question, only for what your prompt did not already
say. The one choice that is never defaulted is the type of the new site (Headless, Wix Studio
or Wix Harmony), plus the business type if you pick Harmony. After that the run continues on its own and finishes with a Migration review of what was imported and what
needs your attention.

### 2. Full migration with review before anything is imported

Works for any supported source: Shopify, WordPress/WooCommerce, Salesforce Commerce Cloud
(public storefront), or CSV files. It asks for the new site's type first, creates the empty
site, then runs a read-only discovery and shows you the proposed mapping. Nothing is imported
until you approve the execution plan.

```text
Use wix-replatform to migrate https://YOUR-STORE.example.com into a new Wix site. Backend
data only. Start with read-only discovery and show me what you found and how it will map to
Wix. Do not import any data into Wix until I approve the execution plan.
```

For files instead of a URL, say so and attach the paths: `Use wix-replatform to import
./products.csv and ./customers.csv into a new Wix site...`.

If a run stops for any reason, send `Use wix-replatform to resume the migration` in the same
folder. It continues from the saved state.

---

## How it works (for the curious)

Everything below is reference: what the skill does, the choices it offers, and how to control
a run from a terminal.

### The flow

Invoke `wix-replatform` in your agent and it routes you through these stages, one module at a
time, based on the saved state of the project:

```text
intake → destination → source inputs → preflight → discovery → mapping → code generation
→ setup discovery → website handoff (continuation only for website modes) → review and approval → setup → import
→ storefront (website modes only) → completion → Migration review
```

1. **Intake.** Picks the project and records the delivery mode, source mode and import mode.
   It asks only for what is missing, one question at a time.
2. **Destination.** Creates a new Wix site, or adopts an existing one you name. A migration
   never creates a second site.
3. **Source inputs.** Detects the source platform from the URL and asks for credentials only
   if the chosen source mode needs them. Secrets are never printed.
4. **Preflight.** Checks the source and destination configuration before any work starts.
5. **Discovery and mapping.** Reads the source schema and maps each source entity to its Wix
   equivalent. You review the mapping and any data that cannot be moved. Quick mode skips
   this step.
6. **Setup discovery.** Works out which Wix apps and settings the import needs.
   `website/handoff.json` is written here even for backend-only runs, so a storefront can be
   added later without repeating discovery.
7. **Approval.** You approve the execution plan. This is the only gate before migrated data
   is written. Between the destination step, which creates the empty site, and this gate,
   everything is read-only.
8. **Setup and import.** Installs required apps, then imports idempotently, deduplicating by
   source identity.
9. **Completion and Migration review.** Completion is decided from validated artifacts, not
   from the agent saying "done". The review then lists what moved, and what is left for you:
   unresolved data, manual setup, missing apps and changed plugin behavior.

### Backend data and website

A migration has two parts, and you can run either one or both:

- **Backend data** is the business records behind the site: products, categories, orders,
  contacts, data from third-party plugins and apps, and more. What is available depends on
  the source platform.
- **Website** is the storefront itself: your existing site's design, recreated in a new Wix
  site. This is done by the `wix-headless-replatform` skill and is built automatically as a
  Wix Headless site. If you chose a Wix Studio or Harmony (editor) site, the skill does not
  copy the design into the editor automatically; it asks whether you want backend data only
  or a separate website handoff.

### Choices you can make

| Choice | Options | Notes |
| --- | --- | --- |
| Delivery mode | `management` (default), `website`, `management_and_website` (also accepted as `both`) | `management` is backend data only. `website` is the website only. `management_and_website` (`both`) is backend data and website together. |
| Source mode | `public_content`, `authenticated_api`, `private_data`, `files_only` | Public pages only; the source's normal API; protected credentials; or supplied files. |
| Import mode | `standard` (default), `quick` | Quick is a bounded public import for supported platforms (currently Shopify and WooCommerce). It never asks for source credentials. If no adapter qualifies it stops and offers standard mode. It never switches silently. |
| Destination | `new`, or an existing site ID | A new site is always created with notifications muted. |
| New site type | `headless`, `studio`, `harmony` | Headless is a website developed in code. Studio and Harmony are designed in a Wix editor. No default, and it cannot be changed later. For Harmony you also say whether the business is a store, bookings or other. |
| Notifications | mute `on` or `off` | Asked only for an existing site, before the first write. `on` mutes all site notifications, including customer emails, until someone unmutes; the live business may miss real notifications meanwhile. `off` leaves them on, so customers and the owner may get emails for imported records. |
| Facelift | off (default) | Optional post-clone UI refresh, only when you ask for it. Applies only when a website is built. |

Source credentials: Shopify private data uses your Shopify CLI session (no token is ever
requested). WordPress and WooCommerce use an application password for an administrator or shop
manager. CSV runs ask for the store's currency, time zone, language and country because a
file does not carry them; any you cannot answer is recorded as unknown, never guessed.

### 1-click mode

Say `1-click mode` explicitly and the skill collects every missing intake value in one
grouped question, records routine mapping and execution approvals as approved by the agent,
and continues through to completion, including the frontend when you chose `both`. It still
never defaults the new site's type, and a rejection or a data-loss risk still stops the run.
For CSV, a passing sample preview is accepted by the agent; uploading a file alone never
implies 1-click.

### Notes and expectations

Say `add to expectations: <note>` at any point and the skill appends it to
`migrations/<project>/EXPECTATIONS.md`, with safe context about the current stage. It is your
free-form record of how you expected the run to behave; the skill never overwrites it.

Migration artifacts live in `migrations/<project>/` (or the folder in
`REPLATFORM_MIGRATIONS_DIR`). Nothing is written back into the skill package.

To pull in records that arrived after an import ("the source kept selling"), ask the skill
to re-run the import for the same project. It reuses the destination and mapping instead of
starting over.

---

## The `replatform` command line (optional)

`replatform` runs the same migration from a terminal without a chat window. It starts an
installed coding agent, watches the migration's saved state, and lets you answer questions
and control the run from another terminal. It does not replace the skill: the skill still
chooses each stage and performs the work. It never prompts for input, opens an editor, or
starts a login flow. Anything that needs a person becomes a saved request.

It needs only Node.js 22.12 or newer; its one dependency is bundled. It starts **Codex** or
**Claude Code** (`--agent codex|claude`, default `auto`). In auto mode it follows the agent
that invoked the runner; when that environment is unknown, it selects an installed and
authenticated adapter. For Cursor, use the chat prompts above.

```bash
node <skill>/scripts/replatform.js doctor                 # check agents and prerequisites
node <skill>/scripts/replatform.js run migrations/shop \
  --agent claude \
  --source-url https://YOUR-STORE.example.com \
  --management-import-mode quick --destination new --site-type headless --one-click
```

`<skill>` is the folder the skill was installed into: `.agents/skills/wix-replatform` for a
project install (Claude Code sees it through `.claude/skills/wix-replatform`) or
`~/.agents/skills/wix-replatform` for a global one. `replatform` in the examples below is
shorthand for `node <skill>/scripts/replatform.js`; there is no separate install.

| Command | What it does |
| --- | --- |
| `run [project]` | Start a supervised run. Streams events as JSON lines by default. |
| `resume [project]` | Continue an unfinished project, including one stopped on a blocker. |
| `status`, `tail --follow`, `tasks` | Watch a live or finished run from another terminal. |
| `requests`, `show`, `answer` | List, read and answer a pending human decision. |
| `cancel` | Stop a live run gracefully. Recovery artifacts are kept. |
| `projects`, `doctor`, `account` | List projects, check prerequisites, show the Wix CLI identity. |
| `completion <shell>`, `help` | Print bash, zsh or fish completion; show help for a command. |

Useful `run` flags: `--source-mode`, `--file <path>` (repeatable, for `files_only`),
`--delivery-mode`, `--destination new|existing:<site-id>`, `--notification-mute on|off`,
`--dry-run`, `--detach`, `--format text|json|jsonl`, and the limits `--wall-timeout`
(at least 60s), `--idle-timeout`, `--worker-startup-timeout` and `--max-agent-turns`. The
runner records raw adapter events under `state/runner/vendor-events.ndjson` and retries once
only when a structured sub-worker has no session output, terminal event, or newly written
handoff. Run `replatform run --help` for the full list.

When a run needs you, answer it and continue:

```bash
replatform requests <project>
replatform answer --project <project> --request-id <id> --choice approved --continue
```

Exit codes: `0` completed, `1` failed, `2` invalid input, `3` waiting for you, `4` blocked,
`5` canceled, `6` timeout. An unknown flag or a bad option value rejected by the command
parser exits `1`.

There is also an optional local browser console (`node <skill>/scripts/replatform-console.js`)
that shows the same state and pending decisions on a private `127.0.0.1` address.

See [CLI.md](./CLI.md) for the complete guide, including blockers, recovery and output formats.
