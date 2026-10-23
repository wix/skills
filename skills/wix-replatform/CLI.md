# RePlatform CLI

`replatform` is the non-interactive process supervisor for a RePlatform migration. It starts
an installed coding agent, gives it the active migration project, observes durable migration
artifacts, and exposes run control from another terminal.

It is **not** a second migration engine. The installed `wix-replatform` skill still chooses
the next stage and performs migration work; existing receipts remain the only proof of
completion. The CLI provides the outer lifecycle: start, observe, answer human checkpoints,
cancel, and resume.

## Start here

From the repository during development:

```bash
yarn replatform --help
yarn replatform run <project> --agent codex
```

From an installed bundle:

```bash
node <bundle>/scripts/replatform.js --help
```

The CLI never prompts for stdin, opens an editor or pager, or begins a vendor login flow.
Required human work becomes a durable request that can be inspected and continued later.

## Common lifecycle

```bash
# Start and receive normalized JSONL events (the default).
replatform run migrations/example --agent codex

# Check a live or completed run from another terminal.
replatform status <project-or-run-id>
replatform tail <project-or-run-id> --follow

# Read the persisted work plan, active task, and agent topology.
replatform tasks <project-or-run-id> --format json

# Read the identity currently authenticated in the local Wix CLI before a destination action.
replatform account

# Read a required human action, then provide the permitted response.
replatform requests <project-or-run-id>
replatform show <project-or-run-id> <request-id>
replatform answer --project <project> --request-id <request-id> --choice approved --continue

# A manual action has no approval choice. Complete the stated prerequisite first, then
# acknowledge it; the resumed stage verifies the prerequisite itself.
replatform answer --project <project> --request-id <request-id> --acknowledge --continue

# Stop only a supervisor that owns an active run, preserving migration recovery artifacts.
replatform cancel <project-or-run-id>
```

## Output and liveness

`run`, `resume`, and `answer --continue` default to `--format jsonl`. The first event carries
the run ID and the final event has `type: "result"`. Use `--format json` for exactly one final
result object, or `--format text` for a concise human result. `--format event-stream` is an
alias for `jsonl`.

When a run needs a person, its `user_action_requested` event carries the full safe action
summary: why it is needed (`message` and `userAction.prompt`), response mode, permitted choices,
and reviewable artifacts. A JSONL consumer can therefore render the decision without reading a
project file; `show` remains available for the complete durable request or artifact contents.

Foreground runs emit a truthful liveness heartbeat every `60s` when no newer observable
progress exists. Detached runs default to no heartbeat. Set `--status-interval off` to disable
foreground heartbeats, or choose a value from `10s` to `5m`. `--events-file <path>` mirrors
normalized JSONL events to a file.

## Human checkpoints

`requests` lists every pending action with its response mode and a copyable next command.

- `choice` accepts only one declared `--choice` value.
- `choice` and a manual `--acknowledge` also accept an optional `--note` to record the
  operator's context without changing the selected decision or acknowledgement.
- `text` accepts `--text` or `--text-file`.
- `none` is a manual prerequisite. Run the stated external action, then use
  `--acknowledge`; this records the operator statement but does not replace deterministic
  verification by the resumed migration stage.

Some declared choices carry a narrowly scoped durable effect. For example, choosing
`switch_to_standard` after a quick-import preflight changes `managementImportMode` to `standard`
before `--continue` resumes. The event and result include that request's choices; the CLI never
infers an effect from a label alone.

`show` can display the action itself or an explicitly reviewable artifact. It never exposes
arbitrary project files. If it truncates a large artifact, it prints the exact emitted and total
byte counts.

## Source and delivery choices

`run --help` describes every supported value. In brief:

- `--source-mode public_content` reads public pages and content.
- `authenticated_api` uses standard source API access.
- `private_data` requires protected source credentials.
- `files_only` imports supplied `--file` paths.
- `--delivery-mode management` migrates backend data; `website` migrates the frontend only;
  `management_and_website` performs both.
- `--management-import-mode standard` uses the full discovery and mapping flow; `quick` uses a
  bounded public adapter and plan.
- `--site-type headless|studio|harmony` chooses the type of a new destination site (with
  `--destination new`). Headless is a website developed in code; Studio and Harmony are
  websites designed in a Wix editor. There is no default: without it, a new-site run raises a
  durable site-type request before anything is created. The type cannot be changed later.
- `--site-business-type store|bookings|other` is valid only with `--site-type harmony` and
  selects Harmony site generation; without it Harmony starts from the blank template.
- Before the first Studio or Harmony site is created, a request shows the account the Wix CLI
  is logged into and the site name; nothing is created until that account is confirmed.
- Destination recovery requests (uncertain creation, editor or publication checks) are
  answered like any other request; an answer only triggers one new bounded check, never a
  second site. RePlatform never publishes or unpublishes an Editor site.

## Safety and recovery

Every run writes a run ID before it launches an agent. A run is not complete because an agent
said so: aggregate completion receipts must validate. Cancellation is a durable state change;
it requests graceful shutdown before forced termination, never labels a partial import as
completed, and preserves recovery artifacts for a later `replatform resume`.

Run `replatform doctor` to check available adapters and local prerequisites without printing
credentials.

`replatform account` reports the identity returned by the local `wix whoami` command. It is a
live check, not a migration artifact: confirm that identity is authorized before acknowledging a
destination-creation action.

## Local browser console

`replatform-console` is an optional loopback-only browser control surface for this CLI:

```bash
node <bundle>/scripts/replatform-console.js
```

It prints a tokenized `127.0.0.1` URL. Keep that URL private: its token authorizes local
control requests. The console starts the same non-interactive CLI commands, renders the
persisted work state alongside the normalized event stream, presents durable human actions, and reads only artifacts that `show`
already permits. It never accepts credentials or exposes vendor diagnostics. `--port <port>`
chooses a port; the server refuses any non-loopback host.

The Work panel reads `state/runner/task-state.json` through `replatform tasks`, so it survives
console reloads and restarts. It records router work and direct agent processes; extra workers
appear only when an adapter reports their structured topology. The observed activity feed remains
diagnostic evidence and never marks work complete by itself.

For destination-creation acknowledgements, the console also displays the identity reported by
the local Wix CLI and requires that check to succeed before it enables acknowledgement. The
identity is shown only in the token-protected dialog and is never saved to migration artifacts.

For reconnectable consumers, `tail --since <event-id>` replays events strictly after that
event. `tail --since <duration>` uses an inclusive time window. `show --format json` returns
the declared artifact media type plus `cursor`/`nextCursor` byte offsets for bounded reads, and
`projects --format json` lists valid migration projects under the configured migrations root.
