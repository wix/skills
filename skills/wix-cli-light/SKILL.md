---
name: wix-cli-light
description: "The Wix CLI's account and site operations as plain Node scripts, no install: device-code login that completes across two short calls, whoami, account and site-scoped tokens. For hosts where a long-running or detached process cannot finish a login, or where installing @wix/cli is slow or blocked. Node 18 or later, network, a file system."
---

# Wix CLI light

The commands a headless project asks of the Wix CLI, as scripts that each finish inside one call.
A session saved here is the CLI's own session file, so a real Wix CLI beside these scripts sees the
same login, and these scripts see a CLI login.

```
node scripts/wix-light.mjs <command> [flags]
```

Every command prints one JSON object per line and exits. Events use the Wix CLI's agent-mode
names: `awaiting_user`, `logged_in`, `login_required`, `<command>_failed`.

## login

```
node scripts/wix-light.mjs login
```

The first run requests a device code, saves it, prints `awaiting_user` with `verificationUri` and
`userCode`, and exits. Show the owner the URL and the code. After the owner approves, run the same
command again: it exchanges the saved code, saves the session, and prints `logged_in`. A run before
the owner has approved prints `awaiting_user` again with the same code.

`--wait <seconds>` polls inside the call instead of exiting, for a host that keeps a call open while
the owner acts. `--force` discards a pending code and requests a new one.

## whoami

Prints `logged_in` with the account's email, or `login_required`.

## token

```
node scripts/wix-light.mjs token                 # account access token
node scripts/wix-light.mjs token --site <siteId> # site-scoped access token
```

Prints the bare token; `--json` prints a `token` event instead. The access token is refreshed
when stale.

## Files

| file | holds |
|---|---|
| `~/.wix/auth/account.json` | the session, the Wix CLI's own file and shape |
| `~/.wix/auth/pending-login.json` | a device code waiting for the owner, deleted on login |

`WIX_CLI_LIGHT_AUTH_DIR` moves both.
