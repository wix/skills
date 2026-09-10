# Authentication — managed (Wix CLI)

For a **managed** project (hosted on Wix infrastructure), every Wix call uses a token minted by the **Wix CLI** — `@wix/cli` + `curl`, no MCP, no SDK. This file is the authority for how `managed` obtains `$TOKEN`, `$SITE_ID`, and the public `clientId`; the flow files (`SETUP.md`, `SEED.md`, `SDK_HANDOFF.md`) defer here.

## 1 · Ensure an authenticated CLI session

### Secret boundary — mandatory

Never read authentication material or tokens into agent context.
Never emit them to stdout, stderr, logs, prompts, or tool results.

```bash
npx @wix/cli@latest whoami   # exits 0 when logged in; non-zero when logged out
```

If it's non-zero, **log in yourself** — don't punt to the user and stop:

1. Run `npx @wix/cli@latest login` with **`run_in_background: true`** (no shell `&`, no redirect of your own — the harness captures stdout to its task-output file and returns the path).
2. Poll that file for the first JSON event: `{"event":"awaiting_user","userCode":"…","verificationUri":"…","expiresInSeconds":…}`.
3. Surface it to the user in plain prose: *"Open `<verificationUri>` and enter the code `<userCode>` — I'll continue once you've logged in."* **Send the message; do not re-invoke login.**
4. Wait for completion. **If your harness pushes an explicit background-task-completed notification, wait for that; otherwise re-read the same output file on a bounded interval (a few seconds, with backoff) for the terminal `{"event":"logged_in"}` / `{"event":"success"}` line** — don't assume a push notification exists, and don't sleep-loop tightly. The device code stays valid for `expiresInSeconds` (typically ~900s), so a quiet file while the user is still in the browser is expected, not a stall. Once you see the terminal event (or the process exits 0), run `whoami` once to confirm, then proceed.

**⚠️ Never kill and re-run `login` because the first attempt "looks stuck."** The device code from step 1 belongs to that one process; killing it abandons the poll even if the user is mid-flow (or already done) in the browser, forcing a brand-new device code and making the user redo step 3. Only start a new `login` if the process actually exited non-zero, emitted `login_failed`, or the full `expiresInSeconds` window elapsed.

## 2 · Mint the token

```bash
SITE_ID="<siteId>"   # from wix.config.json
TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID")
```

- Mints a **site-scoped REST token**. **Mint once per run and never re-mint** — the CLI returns a **byte-identical** token on every call within a run (it caches internally), so re-minting only costs ~1.25 s of startup. Cache `$TOKEN` and `$SITE_ID` in scratch.
- Use `npx @wix/cli@latest token …` (not bare `wix token`) so `npx` resolves the project-local CLI.
- The first `--site "$SITE_ID"` call is the source of truth for `SITE_ID`; bind it in scratch, don't re-derive mid-run.

## 3 · `clientId` for the frontend

The frontend's public `clientId` **is the `appId` field in `wix.config.json`** — for a managed headless project the OAuth **app id and the client id are the same value** (app-id === client-id). It's the same file you already read for `siteId` (§2), so **read `appId` straight from there** — do **not** query the OAuth-apps API, search the docs, or mint anything to obtain it. (It's the public OAuth id, not a secret.)

## REST call shape

```bash
curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "https://www.wixapis.com/<endpoint>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "wix-site-id: $SITE_ID" \
  -H "Content-Type: application/json" \
  -d '<body>'
```

- **`Authorization: Bearer $TOKEN`** — the `Bearer` prefix is required.
- **`wix-site-id: $SITE_ID`** — required by every site-scoped family; include it always.
- **`Content-Type: application/json`** — on every POST/PATCH body.
- **Parsing the response:** `-w` appends a `HTTP_STATUS:<code>` line *after* the JSON body. `grep` that line for the status, but parse the **body separately** — piping the combined output to a JSON parser (`python3 -m json.tool`, `json.load`, `jq`) chokes on the trailing status line (`Extra data: line 2 …`). Capture the body to a file with `-o body.json` (status still comes from `-w`), or drop the last line, before parsing.

## Recovery ladder

Re-mint is **not** a recovery step (the token is byte-identical) — retry the *same* call with the cached token.

| Symptom | First response | If it still fails |
|---|---|---|
| `401 Unauthorized` | Retry once with the cached token. | CLI session expired — run `npx @wix/cli@latest login` (a new session), then re-mint. |
| `403 Forbidden` | Retry once with the cached token. | App not installed yet (re-check the apps-installer returned 200), or the caller lacks permission — surface the response; don't loop. |
| `404` on a documented URL | Re-read the recipe — a path typo. | Recipe bug; surface and stop. |
