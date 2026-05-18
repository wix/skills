# Authentication

`wix login` (and `npx @wix/cli login`) are **safe to run from a non-interactive AI-agent
environment**. When the CLI detects an AI agent it skips the interactive UI and emits
JSON events on stdout, one per line:

- `{"event":"awaiting_user","verificationUri":"...","userCode":"...","expiresInSeconds":...}`
  — surface the URL and code to the user; wait for them to complete login in their browser.
- `{"event":"success","email":"...","userId":"..."}` — login complete; resume the
  step that failed.
- `{"event":"logged_in","email":"...","userId":"..."}` — there was already a valid
  session, nothing to do.

## How to run it

Run `wix login` (or `npx @wix/cli login`) with `run_in_background: true` since it
blocks until the human finishes the browser step. Tail the output file to read the
`awaiting_user` event as soon as it appears; you'll be notified when the process
exits with the terminal event.
