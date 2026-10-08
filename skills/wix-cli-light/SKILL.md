---
name: wix-cli-light
description: "The Wix CLI's headless-project operations as plain Node scripts, no install: device-code login that completes across two short calls, whoami, account and site tokens, env pull, site and app provisioning (init, create), and release of a static or Astro build. For hosts where a long-running or detached process cannot finish, or where installing @wix/cli is slow or blocked. Node 18 or later, network, a file system."
---

# Wix CLI light

The commands a headless project asks of the Wix CLI, as scripts that each finish inside one call.
Same endpoints, same request bodies, same files: a session saved here is the CLI's own session
file, a project made here is a project the CLI releases, and the other way round.

```
node scripts/wix-light.mjs <command> [flags]
```

Every command prints one JSON object per line and exits with 0, or with 1 after a line whose
`ok` is false. Event names follow the Wix CLI's agent mode where it has one: `awaiting_user`,
`logged_in`, `login_required`, `<command>_failed`.

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

`logged_in` with the account's email, or `login_required`.

## token

```
node scripts/wix-light.mjs token                 # account access token
node scripts/wix-light.mjs token --site <siteId> # site-scoped access token
```

Prints the bare token; `--json` prints a `token` event instead. Tokens are refreshed when stale
and site tokens are cached in the CLI's per-site file.

## env pull

```
node scripts/wix-light.mjs env pull [--dir <project>]
```

Writes the app's `prod` environment variables into the project's `.env.local`, merged over the
existing file (`WIX_CLIENT_ID`, `WIX_CLIENT_SECRET`, `WIX_CLIENT_PUBLIC_KEY`,
`WIX_CLIENT_INSTANCE_ID`, and whatever else the environment holds). `env_pulled` lists the keys.

## init

```
node scripts/wix-light.mjs init [--business-name <name>] [--astro] [--output <dir>] [--dir <folder>]
```

The folder becomes a Wix project: a new headless site, its app (the public OAuth client), the app
installed on the site, a hosting project, the OAuth app pointed at it, the environment variables
set. Writes `wix.config.json` and `.env.local`. Events: `site_created`, `app_created`,
`project_ready` with `siteId`, `appId`, `baseUrl`.

Static by default: `wix.config.json` names `site.outputDirectory` (`./dist`, or `--output`), and
`release` uploads that folder as-is. `--astro` leaves the output directory out, for a project with
a Wix Astro build. The business name defaults to the folder's name; it must not contain "wix".

## create

```
node scripts/wix-light.mjs create --business-name <name> --folder <name> \
  [--template-dir <path> | --template-repo <git url> [--template-path <subfolder>] [--template-ref <ref>]] \
  [--static] [--output <dir>] [--site-template <id>]
```

A new folder with the template's files (a local folder, or a shallow git clone when `git` is on
the machine), then `init` in it. Astro by default, `--static` or `--output` for a static site. No
dependency install: `project_ready.next` says what to run. Template files are copied as they are,
so an Astro template must already carry its Wix setup (`@wix/astro`, `@wix/astro-pages` and the
`@wix/astro-wix-hosting-adapter` in `astro.config`), the way the `wix-headless-templates` skill's
`<vertical>/project` folders do. The Wix CLI adds that setup to a bare template; this skill does not.

## release

```
node scripts/wix-light.mjs release [--minor] [--comment <text>] [--dir <project>]
```

Uploads the build and makes it the live version. A static project uploads `site.outputDirectory`
(dotfiles, lockfiles, `package.json`, `wix.config.json`, logs, and any `build*`, `dist*`,
`node_modules*`, `coverage*` folder inside it are left out). An Astro project reads
`.wix/build-metadata.json` from the project's own build (`npx astro build` with the Wix adapter)
and uploads its client and server output with the app manifest. Events: `uploading`, `uploaded`
with the deployment URL, `released` with `url` (the custom domain when one is connected, else the
site's hosting URL).

## Files

| file | holds |
|---|---|
| `~/.wix/auth/account.json` | the session, the Wix CLI's own file and shape |
| `~/.wix/auth/<siteId>.json` | a site token, the CLI's own cache |
| `~/.wix/auth/pending-login.json` | a device code waiting for the owner, deleted on login |
| `<project>/wix.config.json` | `appId`, `siteId`, and for a static site `site.outputDirectory` |
| `<project>/.env.local` | the app's environment variables, `KEY="value"` per line |

`WIX_CLI_LIGHT_AUTH_DIR` moves the three auth files.
